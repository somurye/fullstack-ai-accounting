import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type {
  ConsumptionTaxReturnCreateInput,
  ConsumptionTaxReturnListQuery,
} from './dto/consumption-tax-return.schemas';
import {
  mapConsumptionTaxReturnLineRow,
  mapConsumptionTaxReturnRow,
  SQL_COLUMNS,
  type ConsumptionTaxReturnDto,
  type ConsumptionTaxReturnLineRow,
  type ConsumptionTaxReturnRow,
} from './consumption-tax-return.mapper';

export interface ConsumptionTaxReturnListResult {
  returns: ConsumptionTaxReturnDto[];
  pagination: PaginationMeta;
}

/**
 * 簡易課税の「みなし仕入率」。本来は事業区分(第1種〜第6種)ごとに90%〜40%で異なるが、
 * このMVPでは業種区分マスタが存在しないため、代表値としてサービス業相当(第五種, 50%)を
 * 一律適用する(実運用では取引明細ごとの事業区分設定が必要)。
 */
const SIMPLIFIED_DEEMED_PURCHASE_RATE = 0.5;

interface CalculationResult {
  taxableSalesAmount: number;
  taxablePurchaseAmount: number;
  taxDueAmount: number;
  lines: { category: string; amount: number }[];
}

function floor100(value: number): number {
  return Math.floor(value / 100) * 100;
}

@Injectable()
export class ConsumptionTaxReturnsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async list(
    tenantId: string,
    userId: string | null,
    query: ConsumptionTaxReturnListQuery,
  ): Promise<ConsumptionTaxReturnListResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM consumption_tax_returns WHERE tenant_id = $1`,
        [tenantId],
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const returnsResult = await client.query<ConsumptionTaxReturnRow>(
        `SELECT ${SQL_COLUMNS.consumptionTaxReturn} FROM consumption_tax_returns
         WHERE tenant_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [tenantId, query.page_size, (query.page - 1) * query.page_size],
      );

      const returns = returnsResult.rows.map((row) => mapConsumptionTaxReturnRow(row, []));
      return { returns, pagination: buildPagination(query.page, query.page_size, totalCount) };
    });
  }

  async findById(tenantId: string, userId: string | null, id: string): Promise<ConsumptionTaxReturnDto> {
    return this.db.transaction(tenantId, userId, (client) => this.fetchDetail(client, tenantId, id));
  }

  async create(
    tenantId: string,
    userId: string,
    dto: ConsumptionTaxReturnCreateInput,
  ): Promise<ConsumptionTaxReturnDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const fiscalYearResult = await client.query(
        `SELECT id FROM fiscal_years WHERE tenant_id = $1 AND id = $2`,
        [tenantId, dto.fiscal_year_id],
      );
      if (fiscalYearResult.rowCount === 0) {
        throw AppException.badRequest(`指定された会計年度(id: ${dto.fiscal_year_id})が見つかりません`);
      }

      const calculation = await this.calculateForFiscalYear(
        client,
        tenantId,
        dto.fiscal_year_id,
        dto.filing_method,
      );

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO consumption_tax_returns
           (tenant_id, fiscal_year_id, filing_method, taxable_sales_amount, taxable_purchase_amount, tax_due_amount, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft')
         RETURNING id`,
        [
          tenantId,
          dto.fiscal_year_id,
          dto.filing_method,
          calculation.taxableSalesAmount,
          calculation.taxablePurchaseAmount,
          calculation.taxDueAmount,
        ],
      );
      const returnId = inserted.rows[0].id;
      await this.insertLines(client, tenantId, returnId, calculation.lines);

      return this.fetchDetail(client, tenantId, returnId);
    });
  }

  /**
   * 最新の仕訳データに基づき税額を再計算する(draft状態のみ)。
   *
   * `consumption_tax_return_lines` は追記専用(UPDATE/DELETE物理禁止)のため、既存行は
   * 一切変更せず、再計算のたびに区分別内訳を**新しい1バッチとして追記**する。
   * ヘッダー(`consumption_tax_returns`)側の集計値は追記専用ではないため直接更新する。
   * 詳細取得時は「同一トランザクションで挿入された行群」をPostgreSQLのシステム列`xmin`
   * (行を挿入したトランザクションID)でグルーピングし、最新のバッチのみを返す
   * (これらの行は決して更新されないため、`xmin`は挿入時点のトランザクションIDのまま不変であり、
   * 「最新バッチの判定」に安全に使用できる)。
   */
  async calculate(tenantId: string, userId: string, id: string): Promise<ConsumptionTaxReturnDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const current = await client.query<{ status: string; fiscal_year_id: string; filing_method: string }>(
        `SELECT status, fiscal_year_id, filing_method FROM consumption_tax_returns WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (current.rowCount === 0) {
        throw AppException.notFound('指定された消費税申告データが見つかりません');
      }
      if (current.rows[0].status !== 'draft') {
        throw AppException.conflict('INVALID_STATE_TRANSITION', 'draft状態の申告データのみ再計算できます');
      }

      const calculation = await this.calculateForFiscalYear(
        client,
        tenantId,
        current.rows[0].fiscal_year_id,
        current.rows[0].filing_method as ConsumptionTaxReturnCreateInput['filing_method'],
      );

      await client.query(
        `UPDATE consumption_tax_returns
         SET taxable_sales_amount = $3, taxable_purchase_amount = $4, tax_due_amount = $5
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id, calculation.taxableSalesAmount, calculation.taxablePurchaseAmount, calculation.taxDueAmount],
      );
      await this.insertLines(client, tenantId, id, calculation.lines);

      return this.fetchDetail(client, tenantId, id);
    });
  }

  async finalize(tenantId: string, userId: string, id: string): Promise<ConsumptionTaxReturnDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const current = await client.query<{ status: string }>(
        `SELECT status FROM consumption_tax_returns WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (current.rowCount === 0) {
        throw AppException.notFound('指定された消費税申告データが見つかりません');
      }
      if (current.rows[0].status !== 'draft') {
        throw AppException.conflict('INVALID_STATE_TRANSITION', 'draft状態の申告データのみ確定できます');
      }
      await client.query(
        `UPDATE consumption_tax_returns SET status = 'finalized', finalized_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'consumption_tax_return.finalized',
        targetType: 'consumption_tax_return',
        targetId: id,
        afterData: { status: 'finalized' },
      });

      return this.fetchDetail(client, tenantId, id);
    });
  }

  // --------------------------------------------------------------------------
  // 内部ヘルパー
  // --------------------------------------------------------------------------

  /**
   * 確定済み仕訳(`journal_entries.status = 'posted'`)のうち、`journal_entry_lines.tax_category_id`が
   * 設定されている明細を対象に、当該会計年度の期間内で税区分ごとに集計する。
   * 課税売上 = 貸方・収益科目(account_type='revenue')、課税仕入 = 借方・費用/資産科目。
   * 消費税額は`invoices`/`vendor-bills`モジュールと同じ「区分ごとに1回だけ切り捨て」方針で算出する。
   */
  private async calculateForFiscalYear(
    client: PoolClient,
    tenantId: string,
    fiscalYearId: string,
    filingMethod: ConsumptionTaxReturnCreateInput['filing_method'],
  ): Promise<CalculationResult> {
    const fiscalYearResult = await client.query<{ start_date: string; end_date: string }>(
      `SELECT TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date, TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date
       FROM fiscal_years WHERE tenant_id = $1 AND id = $2`,
      [tenantId, fiscalYearId],
    );
    if (fiscalYearResult.rowCount === 0) {
      throw AppException.badRequest(`指定された会計年度(id: ${fiscalYearId})が見つかりません`);
    }
    const { start_date: startDate, end_date: endDate } = fiscalYearResult.rows[0];

    const salesResult = await client.query<{
      tax_category_id: string;
      tax_rate: string;
      is_reduced_rate: boolean;
      base_amount: string;
    }>(
      `SELECT jel.tax_category_id, tc.tax_rate, tc.is_reduced_rate, SUM(jel.amount)::text AS base_amount
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.tenant_id = jel.tenant_id
       JOIN accounts a ON a.id = jel.account_id AND a.tenant_id = jel.tenant_id
       JOIN tax_categories tc ON tc.id = jel.tax_category_id AND tc.tenant_id = jel.tenant_id
       WHERE jel.tenant_id = $1 AND je.status = 'posted' AND je.entry_date BETWEEN $2 AND $3
         AND jel.tax_category_id IS NOT NULL AND jel.debit_credit = 'credit' AND a.account_type = 'revenue'
       GROUP BY jel.tax_category_id, tc.tax_rate, tc.is_reduced_rate`,
      [tenantId, startDate, endDate],
    );

    const purchaseResult = await client.query<{
      tax_category_id: string;
      tax_rate: string;
      is_reduced_rate: boolean;
      base_amount: string;
    }>(
      `SELECT jel.tax_category_id, tc.tax_rate, tc.is_reduced_rate, SUM(jel.amount)::text AS base_amount
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.tenant_id = jel.tenant_id
       JOIN accounts a ON a.id = jel.account_id AND a.tenant_id = jel.tenant_id
       JOIN tax_categories tc ON tc.id = jel.tax_category_id AND tc.tenant_id = jel.tenant_id
       WHERE jel.tenant_id = $1 AND je.status = 'posted' AND je.entry_date BETWEEN $2 AND $3
         AND jel.tax_category_id IS NOT NULL AND jel.debit_credit = 'debit' AND a.account_type IN ('expense', 'asset')
       GROUP BY jel.tax_category_id, tc.tax_rate, tc.is_reduced_rate`,
      [tenantId, startDate, endDate],
    );

    const lines: { category: string; amount: number }[] = [];
    let taxableSalesAmount = 0;
    let outputTax = 0;
    for (const row of salesResult.rows) {
      const base = Number(row.base_amount);
      const rate = Number(row.tax_rate);
      taxableSalesAmount += base;
      outputTax += Math.floor((base * rate) / 100);
      lines.push({ category: `課税売上${rate}%${row.is_reduced_rate ? '軽減' : ''}`, amount: base });
    }

    let taxablePurchaseAmount = 0;
    let inputTax = 0;
    for (const row of purchaseResult.rows) {
      const base = Number(row.base_amount);
      const rate = Number(row.tax_rate);
      taxablePurchaseAmount += base;
      inputTax += Math.floor((base * rate) / 100);
      lines.push({ category: `課税仕入${rate}%${row.is_reduced_rate ? '軽減' : ''}`, amount: base });
    }

    let taxDueAmount: number;
    if (filingMethod === 'twenty_percent_special') {
      // 2割特例: 売上税額の2割を納税額とする(仕入税額控除の実額計算は行わない)。
      taxDueAmount = floor100(outputTax * 0.2);
    } else if (filingMethod === 'simplified') {
      // 簡易課税: みなし仕入率による控除(実際の課税仕入額は集計するが計算には使用しない)。
      taxDueAmount = floor100(outputTax * (1 - SIMPLIFIED_DEEMED_PURCHASE_RATE));
    } else {
      // 本則課税: 実額の仕入税額控除。
      taxDueAmount = floor100(Math.max(outputTax - inputTax, 0));
    }

    return { taxableSalesAmount, taxablePurchaseAmount, taxDueAmount, lines };
  }

  private async insertLines(
    client: PoolClient,
    tenantId: string,
    returnId: string,
    lines: { category: string; amount: number }[],
  ): Promise<void> {
    for (const line of lines) {
      await client.query(
        `INSERT INTO consumption_tax_return_lines (tenant_id, consumption_tax_return_id, category, amount)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, returnId, line.category, line.amount],
      );
    }
  }

  private async fetchDetail(
    client: PoolClient,
    tenantId: string,
    id: string,
  ): Promise<ConsumptionTaxReturnDto> {
    const returnResult = await client.query<ConsumptionTaxReturnRow>(
      `SELECT ${SQL_COLUMNS.consumptionTaxReturn} FROM consumption_tax_returns WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const returnRow = returnResult.rows[0];
    if (!returnRow) {
      throw AppException.notFound('指定された消費税申告データが見つかりません');
    }

    // 最新バッチ(=同一トランザクションで挿入された行群のうち、最も新しいxminを持つもの)のみ取得する。
    const linesResult = await client.query<ConsumptionTaxReturnLineRow>(
      `SELECT ${SQL_COLUMNS.consumptionTaxReturnLine} FROM consumption_tax_return_lines
       WHERE tenant_id = $1 AND consumption_tax_return_id = $2
         AND xmin = (
           SELECT xmin FROM consumption_tax_return_lines
           WHERE tenant_id = $1 AND consumption_tax_return_id = $2
           ORDER BY xmin::text::bigint DESC LIMIT 1
         )
       ORDER BY category ASC`,
      [tenantId, id],
    );

    return mapConsumptionTaxReturnRow(returnRow, linesResult.rows.map(mapConsumptionTaxReturnLineRow));
  }
}
