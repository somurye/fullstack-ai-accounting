import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { generateJournalEntryNo } from '../../common/journal/generate-entry-no';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type {
  VendorBillCreateInput,
  VendorBillListQuery,
  VendorBillLineCreateInput,
  VendorBillPaymentCreateInput,
} from './dto/vendor-bill.schemas';
import {
  mapApprovalHistoryRow,
  mapVendorBillLineRow,
  mapVendorBillPaymentRow,
  mapVendorBillRow,
  SQL_COLUMNS,
  type ApprovalHistoryRow,
  type VendorBillDetailDto,
  type VendorBillDto,
  type VendorBillLineDto,
  type VendorBillLineRow,
  type VendorBillPaymentDto,
  type VendorBillPaymentRow,
  type VendorBillRow,
} from './vendor-bills.mapper';

export interface VendorBillListResult {
  vendorBills: VendorBillDto[];
  pagination: PaginationMeta;
}

/**
 * 勘定科目コード規約(MVP実装)。`invoices`/`expense-reports`モジュールと同様、
 * テナントごとの科目設定を保持する場所がスキーマに存在しないため固定code規約とする。
 */
const ACCOUNTS_PAYABLE_CODE = '2100'; // 買掛金
const INPUT_TAX_CODE = '2210'; // 仮払消費税
const BANK_DEPOSIT_CODE = '1100'; // 普通預金(invoicesモジュールと同一の預金口座科目)

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

@Injectable()
export class VendorBillsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async list(
    tenantId: string,
    userId: string | null,
    query: VendorBillListQuery,
  ): Promise<VendorBillListResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const conditions: string[] = ['vb.tenant_id = $1'];
      const params: unknown[] = [tenantId];

      if (query.status) {
        params.push(query.status);
        conditions.push(`vb.status = $${params.length}`);
      }
      if (query.vendor_id) {
        params.push(query.vendor_id);
        conditions.push(`vb.vendor_id = $${params.length}`);
      }
      if (query.due_date_from) {
        params.push(query.due_date_from);
        conditions.push(`vb.due_date >= $${params.length}`);
      }
      if (query.due_date_to) {
        params.push(query.due_date_to);
        conditions.push(`vb.due_date <= $${params.length}`);
      }

      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM vendor_bills vb WHERE ${whereClause}`,
        params,
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const listParams = [...params, query.page_size, (query.page - 1) * query.page_size];
      const billsResult = await client.query<VendorBillRow>(
        `SELECT ${SQL_COLUMNS.vendorBill}
         FROM vendor_bills vb
         WHERE ${whereClause}
         ORDER BY vb.due_date ASC, vb.bill_no DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      const billIds = billsResult.rows.map((row) => row.id);
      const linesByBillId = await this.fetchLinesForBills(client, tenantId, billIds);

      const vendorBills = billsResult.rows.map((row) =>
        mapVendorBillRow(row, linesByBillId.get(row.id) ?? []),
      );

      return { vendorBills, pagination: buildPagination(query.page, query.page_size, totalCount) };
    });
  }

  async findById(tenantId: string, userId: string | null, id: string): Promise<VendorBillDetailDto> {
    return this.db.transaction(tenantId, userId, (client) => this.fetchDetail(client, tenantId, id));
  }

  async listPayments(
    tenantId: string,
    userId: string | null,
    vendorBillId: string,
  ): Promise<VendorBillPaymentDto[]> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const billResult = await client.query(
        `SELECT id FROM vendor_bills WHERE tenant_id = $1 AND id = $2`,
        [tenantId, vendorBillId],
      );
      if (billResult.rowCount === 0) {
        throw AppException.notFound('指定された仕入請求書が見つかりません');
      }
      const paymentsResult = await client.query<VendorBillPaymentRow>(
        `SELECT ${SQL_COLUMNS.vendorBillPayment} FROM vendor_bill_payments
         WHERE tenant_id = $1 AND vendor_bill_id = $2 ORDER BY payment_date ASC, created_at ASC`,
        [tenantId, vendorBillId],
      );
      return paymentsResult.rows.map(mapVendorBillPaymentRow);
    });
  }

  async create(
    tenantId: string,
    userId: string,
    dto: VendorBillCreateInput,
  ): Promise<VendorBillDetailDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const vendorResult = await client.query(`SELECT id FROM vendors WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        dto.vendor_id,
      ]);
      if (vendorResult.rowCount === 0) {
        throw AppException.badRequest(`指定された仕入先(id: ${dto.vendor_id})が見つかりません`);
      }

      const { lineAmounts, subtotalAmount, taxAmount } = await this.computeLineAmountsAndTax(
        client,
        tenantId,
        dto.lines,
      );

      const billNo = await this.generateBillNo(client, tenantId, dto.bill_date);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO vendor_bills
           (tenant_id, bill_no, vendor_id, bill_date, due_date, status, subtotal_amount, tax_amount, payment_method, created_by)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9)
         RETURNING id`,
        [
          tenantId,
          billNo,
          dto.vendor_id,
          dto.bill_date,
          dto.due_date,
          subtotalAmount,
          taxAmount,
          dto.payment_method,
          userId,
        ],
      );
      const billId = inserted.rows[0].id;

      await this.insertLines(client, tenantId, billId, lineAmounts);

      return this.fetchDetail(client, tenantId, billId);
    });
  }

  /**
   * 支払申請を提出する。`approval_rules`(target_type='vendor_bill')の有効ルールを参照し、
   * 1件も存在しない場合は「承認不要」として即時approvedへ遷移させる
   * (`docs/openapi.yaml` の応答仕様「または承認不要な場合はapproved」に対応)。
   * ルールが存在する場合は単一の承認依頼(approval_requests)を作成しpending_approvalとする
   * (`expense-reports`モジュールと同様、条件式(condition)の評価自体は本MVPのスコープ外とし、
   * 有効ルールの段階数のみをtotal_stepsとして扱う)。
   *
   * 買掛金計上仕訳は提出時点でdraftとして先行起票しておき、
   * 承認不要でそのままapprovedになる場合のみ即座にposted遷移させる
   * (承認待ちの間は下書き仕訳のまま、確定させない)。
   */
  async submit(tenantId: string, userId: string, id: string): Promise<VendorBillDetailDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const billResult = await client.query<{
        status: string;
        bill_date: string;
        bill_no: string;
        vendor_id: string;
      }>(
        `SELECT status, TO_CHAR(bill_date, 'YYYY-MM-DD') AS bill_date, bill_no, vendor_id
         FROM vendor_bills WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (billResult.rowCount === 0) {
        throw AppException.notFound('指定された仕入請求書が見つかりません');
      }
      const bill = billResult.rows[0];
      if (bill.status !== 'draft') {
        throw AppException.conflict('INVALID_STATE_TRANSITION', 'draft状態の仕入請求書のみ提出できます');
      }

      const linesResult = await client.query<{
        account_id: string;
        amount: string;
        tax_category_id: string;
      }>(
        `SELECT account_id, amount, tax_category_id FROM vendor_bill_lines
         WHERE tenant_id = $1 AND vendor_bill_id = $2 ORDER BY line_no ASC`,
        [tenantId, id],
      );

      const totalsResult = await client.query<{ subtotal_amount: string; tax_amount: string; total_amount: string }>(
        `SELECT subtotal_amount, tax_amount, total_amount FROM vendor_bills WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      const taxAmount = Number(totalsResult.rows[0].tax_amount);
      const totalAmount = Number(totalsResult.rows[0].total_amount);

      const apAccountId = await this.resolveAccountByCode(client, tenantId, ACCOUNTS_PAYABLE_CODE, '買掛金');

      const entryNo = await generateJournalEntryNo(client, tenantId, bill.bill_date);
      const jeInsert = await client.query<{ id: string }>(
        `INSERT INTO journal_entries
           (tenant_id, entry_no, entry_date, description, status, source_type, source_id, created_by)
         VALUES ($1, $2, $3, $4, 'draft', 'vendor_bill', $5, $6)
         RETURNING id`,
        [tenantId, entryNo, bill.bill_date, `買掛金計上: ${bill.bill_no}`, id, userId],
      );
      const journalEntryId = jeInsert.rows[0].id;

      let lineNo = 1;
      // 借方: 明細行ごとの費用/資産科目(税抜金額)
      for (const line of linesResult.rows) {
        await client.query(
          `INSERT INTO journal_entry_lines
             (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount, tax_category_id)
           VALUES ($1, $2, $3, $4, 'debit', $5, $6)`,
          [tenantId, journalEntryId, lineNo++, line.account_id, line.amount, line.tax_category_id],
        );
      }
      // 借方: 仮払消費税(税率区分ごとに1回だけ計算済みのtax_amountを集約1行で計上)
      if (taxAmount > 0) {
        const taxAccountId = await this.resolveAccountByCode(client, tenantId, INPUT_TAX_CODE, '仮払消費税');
        await client.query(
          `INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount)
           VALUES ($1, $2, $3, $4, 'debit', $5)`,
          [tenantId, journalEntryId, lineNo++, taxAccountId, taxAmount],
        );
      }
      // 貸方: 買掛金(総合計)
      await client.query(
        `INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount)
         VALUES ($1, $2, $3, $4, 'credit', $5)`,
        [tenantId, journalEntryId, lineNo++, apAccountId, totalAmount],
      );

      const activeRules = await client.query<{ max_step: number }>(
        `SELECT COALESCE(MAX(step_number), 0)::int AS max_step FROM approval_rules
         WHERE tenant_id = $1 AND target_type = 'vendor_bill' AND is_active = TRUE`,
        [tenantId],
      );
      const totalSteps = activeRules.rows[0].max_step;

      if (totalSteps === 0) {
        // 承認ルール未設定 = 承認不要。仕訳を即座にpostedへ確定させる。
        await client.query(
          `INSERT INTO approval_requests (tenant_id, target_type, target_id, submitted_by, total_steps, current_step, status)
           VALUES ($1, 'vendor_bill', $2, $3, 1, 1, 'approved')`,
          [tenantId, id, userId],
        );
        await client.query(
          `UPDATE journal_entries SET status = 'posted', posted_by = $3 WHERE tenant_id = $1 AND id = $2`,
          [tenantId, journalEntryId, userId],
        );
        await client.query(
          `UPDATE vendor_bills
           SET status = 'approved', journal_entry_id = $3, current_approval_step = 1
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, id, journalEntryId],
        );
      } else {
        await client.query(
          `INSERT INTO approval_requests (tenant_id, target_type, target_id, submitted_by, total_steps, current_step, status)
           VALUES ($1, 'vendor_bill', $2, $3, $4, 1, 'pending')`,
          [tenantId, id, userId, totalSteps],
        );
        await client.query(
          `UPDATE vendor_bills
           SET status = 'pending_approval', journal_entry_id = $3, current_approval_step = 1
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, id, journalEntryId],
        );
      }

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: totalSteps === 0 ? 'vendor_bill.approved' : 'vendor_bill.submitted',
        targetType: 'vendor_bill',
        targetId: id,
        afterData: { journal_entry_id: journalEntryId, total_amount: totalAmount },
      });

      return this.fetchDetail(client, tenantId, id);
    });
  }

  async recordPayment(
    tenantId: string,
    userId: string,
    id: string,
    dto: VendorBillPaymentCreateInput,
  ): Promise<VendorBillPaymentDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const billResult = await client.query<{ status: string; total_amount: string }>(
        `SELECT status, total_amount FROM vendor_bills WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (billResult.rowCount === 0) {
        throw AppException.notFound('指定された仕入請求書が見つかりません');
      }
      if (!['approved', 'scheduled_for_payment'].includes(billResult.rows[0].status)) {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          '承認済み(approved/scheduled_for_payment)の仕入請求書のみ支払消込を記録できます',
        );
      }

      const apAccountId = await this.resolveAccountByCode(client, tenantId, ACCOUNTS_PAYABLE_CODE, '買掛金');
      const bankAccountId = await this.resolveAccountByCode(client, tenantId, BANK_DEPOSIT_CODE, '普通預金');

      const entryNo = await generateJournalEntryNo(client, tenantId, dto.payment_date);
      const jeInsert = await client.query<{ id: string }>(
        `INSERT INTO journal_entries
           (tenant_id, entry_no, entry_date, description, status, source_type, source_id, created_by)
         VALUES ($1, $2, $3, $4, 'draft', 'vendor_bill', $5, $6)
         RETURNING id`,
        [tenantId, entryNo, dto.payment_date, `買掛金消込`, id, userId],
      );
      const journalEntryId = jeInsert.rows[0].id;

      await client.query(
        `INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount)
         VALUES ($1, $2, 1, $3, 'debit', $4)`,
        [tenantId, journalEntryId, apAccountId, dto.amount],
      );
      await client.query(
        `INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount)
         VALUES ($1, $2, 2, $3, 'credit', $4)`,
        [tenantId, journalEntryId, bankAccountId, dto.amount],
      );
      await client.query(
        `UPDATE journal_entries SET status = 'posted', posted_by = $3 WHERE tenant_id = $1 AND id = $2`,
        [tenantId, journalEntryId, userId],
      );

      // vendor_bill_paymentsは追記専用(UPDATE不可)のため、journal_entry_idは
      // 仕訳を先に確定させた上でINSERT時点から確定値として渡す。
      const paymentInsert = await client.query<{ id: string }>(
        `INSERT INTO vendor_bill_payments
           (tenant_id, vendor_bill_id, payment_date, amount, bank_transaction_id, journal_entry_id, matched_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'manual')
         RETURNING id`,
        [tenantId, id, dto.payment_date, dto.amount, dto.bank_transaction_id ?? null, journalEntryId],
      );
      const paymentId = paymentInsert.rows[0].id;

      const totalPaidResult = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total FROM vendor_bill_payments WHERE tenant_id = $1 AND vendor_bill_id = $2`,
        [tenantId, id],
      );
      const totalPaid = Number(totalPaidResult.rows[0].total);
      const totalAmount = Number(billResult.rows[0].total_amount);
      if (totalPaid >= totalAmount) {
        await client.query(`UPDATE vendor_bills SET status = 'paid' WHERE tenant_id = $1 AND id = $2`, [
          tenantId,
          id,
        ]);
      }

      const paymentRow = await client.query<VendorBillPaymentRow>(
        `SELECT ${SQL_COLUMNS.vendorBillPayment} FROM vendor_bill_payments WHERE tenant_id = $1 AND id = $2`,
        [tenantId, paymentId],
      );
      return mapVendorBillPaymentRow(paymentRow.rows[0]);
    });
  }

  // --------------------------------------------------------------------------
  // 内部ヘルパー
  // --------------------------------------------------------------------------

  private async fetchDetail(
    client: PoolClient,
    tenantId: string,
    id: string,
  ): Promise<VendorBillDetailDto> {
    const billResult = await client.query<VendorBillRow>(
      `SELECT ${SQL_COLUMNS.vendorBill} FROM vendor_bills WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const billRow = billResult.rows[0];
    if (!billRow) {
      throw AppException.notFound('指定された仕入請求書が見つかりません');
    }

    const linesResult = await client.query<VendorBillLineRow>(
      `SELECT ${SQL_COLUMNS.vendorBillLine} FROM vendor_bill_lines
       WHERE tenant_id = $1 AND vendor_bill_id = $2 ORDER BY line_no ASC`,
      [tenantId, id],
    );
    const paymentsResult = await client.query<VendorBillPaymentRow>(
      `SELECT ${SQL_COLUMNS.vendorBillPayment} FROM vendor_bill_payments
       WHERE tenant_id = $1 AND vendor_bill_id = $2 ORDER BY payment_date ASC, created_at ASC`,
      [tenantId, id],
    );
    const historyResult = await client.query<ApprovalHistoryRow>(
      `SELECT ${SQL_COLUMNS.approvalHistory}
       FROM approval_history ah
       JOIN approval_requests ar ON ar.id = ah.approval_request_id
       WHERE ah.tenant_id = $1 AND ar.target_type = 'vendor_bill' AND ar.target_id = $2
       ORDER BY ah.acted_at ASC`,
      [tenantId, id],
    );

    let journalEntry: VendorBillDetailDto['journal_entry'] = null;
    if (billRow.journal_entry_id) {
      const jeResult = await client.query<{ id: string; entry_no: string; status: string }>(
        `SELECT id, entry_no, status FROM journal_entries WHERE tenant_id = $1 AND id = $2`,
        [tenantId, billRow.journal_entry_id],
      );
      journalEntry = jeResult.rows[0] ?? null;
    }

    return {
      ...mapVendorBillRow(billRow, linesResult.rows.map(mapVendorBillLineRow)),
      payments: paymentsResult.rows.map(mapVendorBillPaymentRow),
      approval_history: historyResult.rows.map(mapApprovalHistoryRow),
      journal_entry: journalEntry,
    };
  }

  private async fetchLinesForBills(
    client: PoolClient,
    tenantId: string,
    billIds: string[],
  ): Promise<Map<string, VendorBillLineDto[]>> {
    const linesByBillId = new Map<string, VendorBillLineDto[]>();
    if (billIds.length === 0) {
      return linesByBillId;
    }

    const linesResult = await client.query<VendorBillLineRow>(
      `SELECT ${SQL_COLUMNS.vendorBillLine} FROM vendor_bill_lines
       WHERE tenant_id = $1 AND vendor_bill_id = ANY($2::uuid[])
       ORDER BY vendor_bill_id, line_no ASC`,
      [tenantId, billIds],
    );

    for (const row of linesResult.rows) {
      const list = linesByBillId.get(row.vendor_bill_id) ?? [];
      list.push(mapVendorBillLineRow(row));
      linesByBillId.set(row.vendor_bill_id, list);
    }
    return linesByBillId;
  }

  /**
   * 明細行の金額(直接指定)を税区分(tax_category_id)ごとにグルーピングし、
   * `invoices`モジュールと同じ方針で**1請求書・税区分ごとに1回だけ**端数処理(切り捨て)を行う。
   */
  private async computeLineAmountsAndTax(
    client: PoolClient,
    tenantId: string,
    lines: VendorBillLineCreateInput[],
  ): Promise<{
    lineAmounts: (VendorBillLineCreateInput & { amount: number })[];
    subtotalAmount: number;
    taxAmount: number;
  }> {
    const taxCategoryIds = [...new Set(lines.map((line) => line.tax_category_id))];
    const taxRatesResult = await client.query<{ id: string; tax_rate: string }>(
      `SELECT id, tax_rate FROM tax_categories WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, taxCategoryIds],
    );
    const taxRateMap = new Map(taxRatesResult.rows.map((row) => [row.id, Number(row.tax_rate)]));
    const missingTaxCategory = lines.find((line) => !taxRateMap.has(line.tax_category_id));
    if (missingTaxCategory) {
      throw AppException.badRequest(
        `指定された税区分(id: ${missingTaxCategory.tax_category_id})が見つかりません`,
      );
    }

    const lineAmounts = lines.map((line) => ({ ...line, amount: round2(line.amount) }));

    const groupSubtotals = new Map<string, number>();
    for (const line of lineAmounts) {
      groupSubtotals.set(
        line.tax_category_id,
        round2((groupSubtotals.get(line.tax_category_id) ?? 0) + line.amount),
      );
    }

    let taxAmount = 0;
    for (const [taxCategoryId, subtotal] of groupSubtotals) {
      const rate = taxRateMap.get(taxCategoryId) as number;
      taxAmount += Math.floor((subtotal * rate) / 100);
    }

    const subtotalAmount = lineAmounts.reduce((sum, line) => sum + line.amount, 0);

    return { lineAmounts, subtotalAmount, taxAmount };
  }

  private async insertLines(
    client: PoolClient,
    tenantId: string,
    billId: string,
    lines: (VendorBillLineCreateInput & { amount: number })[],
  ): Promise<void> {
    let lineNo = 1;
    for (const line of lines) {
      await client.query(
        `INSERT INTO vendor_bill_lines
           (tenant_id, vendor_bill_id, line_no, description, amount, tax_category_id, account_id, department_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          tenantId,
          billId,
          lineNo++,
          line.description,
          line.amount,
          line.tax_category_id,
          line.account_id,
          line.department_id ?? null,
        ],
      );
    }
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

  private async generateBillNo(client: PoolClient, tenantId: string, billDate: string): Promise<string> {
    const datePart = billDate.replace(/-/g, '');
    const { rows } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM vendor_bills WHERE tenant_id = $1 AND bill_no LIKE $2`,
      [tenantId, `VB-${datePart}-%`],
    );
    const seq = Number(rows[0]?.count ?? 0) + 1;
    return `VB-${datePart}-${String(seq).padStart(4, '0')}`;
  }
}
