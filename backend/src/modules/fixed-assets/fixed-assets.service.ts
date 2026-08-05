import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { generateJournalEntryNo } from '../../common/journal/generate-entry-no';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type {
  DepreciationRunInput,
  FixedAssetCreateInput,
  FixedAssetDisposeInput,
  FixedAssetListQuery,
} from './dto/fixed-asset.schemas';
import {
  mapDepreciationScheduleRow,
  mapFixedAssetRow,
  SQL_COLUMNS,
  type DepreciationScheduleDto,
  type DepreciationScheduleRow,
  type FixedAssetDto,
  type FixedAssetRow,
} from './fixed-assets.mapper';

export interface FixedAssetListResult {
  fixedAssets: FixedAssetDto[];
  pagination: PaginationMeta;
}

export interface DepreciationRunResult {
  processedCount: number;
  journalEntryIds: string[];
}

/**
 * 勘定科目コード規約(MVP実装)。他モジュールと同様、テナットごとの科目設定を
 * 保持する場所がスキーマに存在しないため固定code規約とする。
 */
const ACCUMULATED_DEPRECIATION_CODE = '1600'; // 減価償却累計額(間接法・資産のコントラ科目)
const DISPOSAL_LOSS_CODE = '9100'; // 固定資産除却損/売却損
const DISPOSAL_GAIN_CODE = '9000'; // 固定資産売却益
const BANK_DEPOSIT_CODE = '1100'; // 普通預金(売却代金の受取)

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

@Injectable()
export class FixedAssetsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async list(
    tenantId: string,
    userId: string | null,
    query: FixedAssetListQuery,
  ): Promise<FixedAssetListResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const conditions: string[] = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];
      if (query.status) {
        params.push(query.status);
        conditions.push(`status = $${params.length}`);
      }
      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM fixed_assets WHERE ${whereClause}`,
        params,
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const listParams = [...params, query.page_size, (query.page - 1) * query.page_size];
      const assetsResult = await client.query<FixedAssetRow>(
        `SELECT ${SQL_COLUMNS.fixedAsset}
         FROM fixed_assets
         WHERE ${whereClause}
         ORDER BY acquisition_date DESC, asset_no DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      const assetIds = assetsResult.rows.map((row) => row.id);
      const schedulesByAssetId = await this.fetchSchedulesForAssets(client, tenantId, assetIds);

      const fixedAssets = assetsResult.rows.map((row) =>
        mapFixedAssetRow(row, schedulesByAssetId.get(row.id) ?? []),
      );

      return { fixedAssets, pagination: buildPagination(query.page, query.page_size, totalCount) };
    });
  }

  async findById(tenantId: string, userId: string | null, id: string): Promise<FixedAssetDto> {
    return this.db.transaction(tenantId, userId, (client) => this.fetchDetail(client, tenantId, id));
  }

  async create(
    tenantId: string,
    userId: string,
    dto: FixedAssetCreateInput,
  ): Promise<FixedAssetDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const assetNo = await this.generateAssetNo(client, tenantId, dto.acquisition_date);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO fixed_assets
           (tenant_id, asset_no, name, category, acquisition_date, acquisition_cost, useful_life_years,
            depreciation_method, salvage_value, status, department_id, asset_account_id, depreciation_expense_account_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10, $11, $12)
         RETURNING id`,
        [
          tenantId,
          assetNo,
          dto.name,
          dto.category ?? null,
          dto.acquisition_date,
          dto.acquisition_cost,
          dto.useful_life_years,
          dto.depreciation_method,
          dto.salvage_value,
          dto.department_id ?? null,
          dto.asset_account_id,
          dto.depreciation_expense_account_id,
        ],
      );
      return this.fetchDetail(client, tenantId, inserted.rows[0].id);
    });
  }

  /**
   * 除却(disposed)・売却(sold)処理。除却損/売却損益を1本の仕訳で自動起票し即座にpostedとする
   * (月次償却バッチとは異なり単発の確定アクションのため、他モジュールの発行/消込系アクションと
   * 同様にdraft→posted遷移を1トランザクション内で完結させる)。
   *
   * 貸借バランスの内訳(常に一致する):
   *   借方 = 減価償却累計額 + 売却代金(proceeds_amount) + 除却/売却損(あれば)
   *   貸方 = 取得価額 + 売却益(あれば)
   *   (簿価 = 取得価額 - 減価償却累計額、損益 = 売却代金 - 簿価 という会計恒等式から導出)
   */
  async dispose(
    tenantId: string,
    userId: string,
    id: string,
    dto: FixedAssetDisposeInput,
  ): Promise<FixedAssetDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const assetResult = await client.query<{
        status: string;
        name: string;
        acquisition_cost: string;
        accumulated_depreciation: string;
        asset_account_id: string;
      }>(
        `SELECT status, name, acquisition_cost, accumulated_depreciation, asset_account_id
         FROM fixed_assets WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (assetResult.rowCount === 0) {
        throw AppException.notFound('指定された固定資産が見つかりません');
      }
      const asset = assetResult.rows[0];
      if (asset.status !== 'active') {
        throw AppException.conflict('INVALID_STATE_TRANSITION', '稼働中(active)の資産のみ除却・売却できます');
      }

      const acquisitionCost = Number(asset.acquisition_cost);
      const accumulatedDepreciation = Number(asset.accumulated_depreciation);
      const bookValue = round2(acquisitionCost - accumulatedDepreciation);
      const gainLoss = round2(dto.proceeds_amount - bookValue);

      const entryNo = await generateJournalEntryNo(client, tenantId, dto.disposal_date);
      const jeInsert = await client.query<{ id: string }>(
        `INSERT INTO journal_entries
           (tenant_id, entry_no, entry_date, description, status, source_type, source_id, created_by)
         VALUES ($1, $2, $3, $4, 'draft', 'manual', $5, $6)
         RETURNING id`,
        [
          tenantId,
          entryNo,
          dto.disposal_date,
          `固定資産${dto.disposal_type === 'sold' ? '売却' : '除却'}: ${asset.name}`,
          id,
          userId,
        ],
      );
      const journalEntryId = jeInsert.rows[0].id;

      let lineNo = 1;
      if (accumulatedDepreciation > 0) {
        const accDeprAccountId = await this.resolveAccountByCode(
          client,
          tenantId,
          ACCUMULATED_DEPRECIATION_CODE,
          '減価償却累計額',
        );
        await client.query(
          `INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount)
           VALUES ($1, $2, $3, $4, 'debit', $5)`,
          [tenantId, journalEntryId, lineNo++, accDeprAccountId, accumulatedDepreciation],
        );
      }
      if (dto.proceeds_amount > 0) {
        const bankAccountId = await this.resolveAccountByCode(client, tenantId, BANK_DEPOSIT_CODE, '普通預金');
        await client.query(
          `INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount)
           VALUES ($1, $2, $3, $4, 'debit', $5)`,
          [tenantId, journalEntryId, lineNo++, bankAccountId, dto.proceeds_amount],
        );
      }
      if (gainLoss < 0) {
        const lossAccountId = await this.resolveAccountByCode(
          client,
          tenantId,
          DISPOSAL_LOSS_CODE,
          '固定資産除却損/売却損',
        );
        await client.query(
          `INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount)
           VALUES ($1, $2, $3, $4, 'debit', $5)`,
          [tenantId, journalEntryId, lineNo++, lossAccountId, round2(-gainLoss)],
        );
      }
      // 貸方: 取得価額(資産科目を帳簿から除去)
      await client.query(
        `INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount)
         VALUES ($1, $2, $3, $4, 'credit', $5)`,
        [tenantId, journalEntryId, lineNo++, asset.asset_account_id, acquisitionCost],
      );
      if (gainLoss > 0) {
        const gainAccountId = await this.resolveAccountByCode(
          client,
          tenantId,
          DISPOSAL_GAIN_CODE,
          '固定資産売却益',
        );
        await client.query(
          `INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount)
           VALUES ($1, $2, $3, $4, 'credit', $5)`,
          [tenantId, journalEntryId, lineNo++, gainAccountId, gainLoss],
        );
      }

      await client.query(
        `UPDATE journal_entries SET status = 'posted', posted_by = $3 WHERE tenant_id = $1 AND id = $2`,
        [tenantId, journalEntryId, userId],
      );

      await client.query(
        `INSERT INTO fixed_asset_disposals
           (tenant_id, fixed_asset_id, disposal_date, disposal_type, proceeds_amount, gain_loss_amount, journal_entry_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          tenantId,
          id,
          dto.disposal_date,
          dto.disposal_type,
          dto.proceeds_amount,
          gainLoss,
          journalEntryId,
          userId,
        ],
      );

      await client.query(
        `UPDATE fixed_assets SET status = $3 WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id, dto.disposal_type],
      );

      return this.fetchDetail(client, tenantId, id);
    });
  }

  /**
   * 月次減価償却バッチ。指定会計期間に対し、稼働中(active)の対象資産の当月償却額を計算し、
   * `depreciation_schedules` を更新した上で、全対象資産分をまとめた**単一のdraft仕訳**を起票する
   * (要件どおり、ここでは`posted`へは遷移させない。確定は既存の仕訳モジュールの
   * `POST /journal-entries/:id/post` にレビュー後委ねる)。
   *
   * `depreciation_schedules` は (fixed_asset_id, fiscal_period_id) にUNIQUE制約があるため、
   * 同一期間への再実行は UPSERT で安全に冪等処理される(status='posted'の既存スケジュールはスキップし、
   * 二重計上を防ぐ)。
   */
  async runDepreciation(
    tenantId: string,
    userId: string,
    dto: DepreciationRunInput,
  ): Promise<DepreciationRunResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const periodResult = await client.query<{ start_date: string; end_date: string }>(
        `SELECT TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date, TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date
         FROM fiscal_periods WHERE tenant_id = $1 AND id = $2`,
        [tenantId, dto.fiscal_period_id],
      );
      if (periodResult.rowCount === 0) {
        throw AppException.badRequest(`指定された会計期間(id: ${dto.fiscal_period_id})が見つかりません`);
      }
      const period = periodResult.rows[0];

      const assetConditions: string[] = ['tenant_id = $1', `status = 'active'`];
      const assetParams: unknown[] = [tenantId];
      if (dto.asset_ids && dto.asset_ids.length > 0) {
        assetParams.push(dto.asset_ids);
        assetConditions.push(`id = ANY($${assetParams.length}::uuid[])`);
      }
      const assetsResult = await client.query<{
        id: string;
        acquisition_cost: string;
        useful_life_years: number;
        depreciation_method: string;
        salvage_value: string;
        accumulated_depreciation: string;
        depreciation_expense_account_id: string;
      }>(
        `SELECT id, acquisition_cost, useful_life_years, depreciation_method, salvage_value,
                accumulated_depreciation, depreciation_expense_account_id
         FROM fixed_assets WHERE ${assetConditions.join(' AND ')}`,
        assetParams,
      );

      // 既にこの期間のスケジュールが存在する資産(status不問)は、再実行による二重計上
      // (仕訳の再起票・accumulated_depreciationの二重加算)を防ぐため除外する。
      // 同一期間への再実行は完全な冪等操作(no-op)とする。
      const alreadyProcessedResult = await client.query<{ fixed_asset_id: string }>(
        `SELECT fixed_asset_id FROM depreciation_schedules
         WHERE tenant_id = $1 AND fiscal_period_id = $2`,
        [tenantId, dto.fiscal_period_id],
      );
      const alreadyProcessed = new Set(alreadyProcessedResult.rows.map((r) => r.fixed_asset_id));

      const accDeprAccountId = await this.resolveAccountByCode(
        client,
        tenantId,
        ACCUMULATED_DEPRECIATION_CODE,
        '減価償却累計額',
      );

      const targets: { assetId: string; amount: number; expenseAccountId: string }[] = [];
      for (const asset of assetsResult.rows) {
        if (alreadyProcessed.has(asset.id)) continue;
        const amount = this.computeMonthlyDepreciation(asset);
        if (amount <= 0) continue;
        targets.push({ assetId: asset.id, amount, expenseAccountId: asset.depreciation_expense_account_id });
      }

      if (targets.length === 0) {
        return { processedCount: 0, journalEntryIds: [] };
      }

      const entryNo = await generateJournalEntryNo(client, tenantId, period.start_date);
      const jeInsert = await client.query<{ id: string }>(
        `INSERT INTO journal_entries
           (tenant_id, entry_no, entry_date, description, status, source_type, created_by)
         VALUES ($1, $2, $3, $4, 'draft', 'depreciation_batch', $5)
         RETURNING id`,
        [tenantId, entryNo, period.end_date, `月次減価償却(${period.start_date}〜${period.end_date})`, userId],
      );
      const journalEntryId = jeInsert.rows[0].id;

      let lineNo = 1;
      for (const target of targets) {
        await client.query(
          `INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount)
           VALUES ($1, $2, $3, $4, 'debit', $5)`,
          [tenantId, journalEntryId, lineNo++, target.expenseAccountId, target.amount],
        );
      }
      const totalAmount = round2(targets.reduce((sum, t) => sum + t.amount, 0));
      await client.query(
        `INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount)
         VALUES ($1, $2, $3, $4, 'credit', $5)`,
        [tenantId, journalEntryId, lineNo++, accDeprAccountId, totalAmount],
      );

      // `fixed_assets.accumulated_depreciation` をバッチ実行時点で即時加算するため、
      // この仕訳をdraftのまま残さず直ちにpostedへ確定する(`fn_check_journal_balance`で
      // 貸借一致を再検証)。draftのまま残すと、`journal_entry_lines`のDELETEは
      // draft状態に限りDBトリガーで許容されるため、加算済みのaccumulated_depreciationが
      // GL側の反映(posted仕訳)を伴わずに残る「キャッシュ値のドリフト」が発生しうる
      // (`dispose()`が起票直後にpostedへ確定するのと同じ方針)。
      await client.query(
        `UPDATE journal_entries SET status = 'posted', posted_by = $3 WHERE tenant_id = $1 AND id = $2`,
        [tenantId, journalEntryId, userId],
      );

      for (const target of targets) {
        await client.query(
          `INSERT INTO depreciation_schedules
             (tenant_id, fixed_asset_id, fiscal_period_id, scheduled_amount, actual_amount, journal_entry_id, status)
           VALUES ($1, $2, $3, $4, $4, $5, 'scheduled')
           ON CONFLICT (fixed_asset_id, fiscal_period_id) DO UPDATE
             SET scheduled_amount = EXCLUDED.scheduled_amount,
                 actual_amount = EXCLUDED.actual_amount,
                 journal_entry_id = EXCLUDED.journal_entry_id,
                 status = 'scheduled'`,
          [tenantId, target.assetId, dto.fiscal_period_id, target.amount, journalEntryId],
        );
        // 上でこのバッチの仕訳を直ちにpostedへ確定しているため、accumulated_depreciationの
        // 加算は必ずGLへの実際の反映を伴う(draftのまま放置されドリフトすることはない)。
        await client.query(
          `UPDATE fixed_assets SET accumulated_depreciation = accumulated_depreciation + $3
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, target.assetId, target.amount],
        );
      }

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'fixed_asset.depreciation_run',
        targetType: 'journal_entry',
        targetId: journalEntryId,
        afterData: {
          fiscal_period_id: dto.fiscal_period_id,
          processed_count: targets.length,
          total_amount: totalAmount,
        },
      });

      return {
        processedCount: targets.length,
        journalEntryIds: [journalEntryId],
      };
    });
  }

  // --------------------------------------------------------------------------
  // 内部ヘルパー
  // --------------------------------------------------------------------------

  /**
   * 当月の減価償却額を計算する。
   * - 定額法: (取得価額 - 残存価額) / 耐用年数 / 12
   * - 定率法: 期首帳簿価額 × (2 / 耐用年数)(200%定率法の償却率) / 12
   *   (保証率/改定償却率による定額転換等の税法上の特例はMVPスコープ外)
   * いずれも残存価額を下回らないようクリップする。
   */
  private computeMonthlyDepreciation(asset: {
    acquisition_cost: string;
    useful_life_years: number;
    depreciation_method: string;
    salvage_value: string;
    accumulated_depreciation: string;
  }): number {
    const acquisitionCost = Number(asset.acquisition_cost);
    const salvageValue = Number(asset.salvage_value);
    const accumulatedDepreciation = Number(asset.accumulated_depreciation);
    const depreciableBase = acquisitionCost - salvageValue;
    const remaining = round2(depreciableBase - accumulatedDepreciation);
    if (remaining <= 0) return 0;

    let monthlyAmount: number;
    if (asset.depreciation_method === 'straight_line') {
      monthlyAmount = round2(depreciableBase / asset.useful_life_years / 12);
    } else {
      const bookValue = acquisitionCost - accumulatedDepreciation;
      const rate = 2 / asset.useful_life_years;
      monthlyAmount = round2((bookValue * rate) / 12);
    }
    return Math.min(monthlyAmount, remaining);
  }

  private async fetchDetail(client: PoolClient, tenantId: string, id: string): Promise<FixedAssetDto> {
    const assetResult = await client.query<FixedAssetRow>(
      `SELECT ${SQL_COLUMNS.fixedAsset} FROM fixed_assets WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const assetRow = assetResult.rows[0];
    if (!assetRow) {
      throw AppException.notFound('指定された固定資産が見つかりません');
    }
    const schedulesResult = await client.query<DepreciationScheduleRow>(
      `SELECT ${SQL_COLUMNS.depreciationSchedule} FROM depreciation_schedules
       WHERE tenant_id = $1 AND fixed_asset_id = $2 ORDER BY created_at ASC`,
      [tenantId, id],
    );
    return mapFixedAssetRow(assetRow, schedulesResult.rows.map(mapDepreciationScheduleRow));
  }

  private async fetchSchedulesForAssets(
    client: PoolClient,
    tenantId: string,
    assetIds: string[],
  ): Promise<Map<string, DepreciationScheduleDto[]>> {
    const byAssetId = new Map<string, DepreciationScheduleDto[]>();
    if (assetIds.length === 0) return byAssetId;

    const result = await client.query<DepreciationScheduleRow & { fixed_asset_id: string }>(
      `SELECT fixed_asset_id, ${SQL_COLUMNS.depreciationSchedule} FROM depreciation_schedules
       WHERE tenant_id = $1 AND fixed_asset_id = ANY($2::uuid[]) ORDER BY fixed_asset_id, created_at ASC`,
      [tenantId, assetIds],
    );
    for (const row of result.rows) {
      const list = byAssetId.get(row.fixed_asset_id) ?? [];
      list.push(mapDepreciationScheduleRow(row));
      byAssetId.set(row.fixed_asset_id, list);
    }
    return byAssetId;
  }

  private async resolveAccountByCode(
    client: PoolClient,
    tenantId: string,
    code: string,
    label: string,
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM accounts WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );
    const account = result.rows[0];
    if (!account) {
      throw AppException.badRequest(
        `${label}科目(code: ${code})が勘定科目マスタに存在しません。管理者に登録を依頼してください`,
      );
    }
    return account.id;
  }

  private async generateAssetNo(
    client: PoolClient,
    tenantId: string,
    acquisitionDate: string,
  ): Promise<string> {
    const datePart = acquisitionDate.replace(/-/g, '');
    const { rows } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM fixed_assets WHERE tenant_id = $1 AND asset_no LIKE $2`,
      [tenantId, `FA-${datePart}-%`],
    );
    const seq = Number(rows[0]?.count ?? 0) + 1;
    return `FA-${datePart}-${String(seq).padStart(4, '0')}`;
  }
}
