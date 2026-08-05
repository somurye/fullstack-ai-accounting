import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { acquireAdvisoryLock } from '../../common/database/advisory-lock';
import { generateJournalEntryNo } from '../../common/journal/generate-entry-no';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type {
  CreditNoteCreateInput,
  InvoiceCreateInput,
  InvoiceListQuery,
  InvoiceLineCreateInput,
  InvoicePaymentCreateInput,
} from './dto/invoice.schemas';
import {
  EFFECTIVE_STATUS_EXPR,
  mapCreditNoteRow,
  mapInvoiceLineRow,
  mapInvoicePaymentRow,
  mapInvoiceRow,
  SQL_COLUMNS,
  type CreditNoteDto,
  type CreditNoteRow,
  type InvoiceDetailDto,
  type InvoiceDto,
  type InvoiceLineDto,
  type InvoiceLineRow,
  type InvoicePaymentDto,
  type InvoicePaymentRow,
  type InvoiceRow,
} from './invoices.mapper';

export interface InvoiceListResult {
  invoices: InvoiceDto[];
  pagination: PaginationMeta;
}

/**
 * 勘定科目コード規約(MVP実装)。
 *
 * テナントごとの「売掛金/仮受消費税/預金の控除対象科目」を保持する設定テーブルが
 * `docs/openapi.yaml`・DBスキーマのいずれにも存在しないため、`expense-reports`モジュールと
 * 同様に固定のcode規約で解決する(将来的にはテナント設定として切り出すべき箇所)。
 */
const ACCOUNTS_RECEIVABLE_CODE = '1200'; // 売掛金
const CONSUMPTION_TAX_PAYABLE_CODE = '2200'; // 仮受消費税
const BANK_DEPOSIT_CODE = '1100'; // 普通預金

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async list(
    tenantId: string,
    userId: string | null,
    query: InvoiceListQuery,
  ): Promise<InvoiceListResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const conditions: string[] = ['i.tenant_id = $1'];
      const params: unknown[] = [tenantId];

      if (query.status) {
        params.push(query.status);
        conditions.push(`(${EFFECTIVE_STATUS_EXPR}) = $${params.length}`);
      }
      if (query.customer_id) {
        params.push(query.customer_id);
        conditions.push(`i.customer_id = $${params.length}`);
      }
      if (query.due_date_from) {
        params.push(query.due_date_from);
        conditions.push(`i.due_date >= $${params.length}`);
      }
      if (query.due_date_to) {
        params.push(query.due_date_to);
        conditions.push(`i.due_date <= $${params.length}`);
      }

      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM invoices i WHERE ${whereClause}`,
        params,
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const listParams = [...params, query.page_size, (query.page - 1) * query.page_size];
      const invoicesResult = await client.query<InvoiceRow>(
        `SELECT ${SQL_COLUMNS.invoice}
         FROM invoices i
         WHERE ${whereClause}
         ORDER BY i.issue_date DESC, i.invoice_no DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      const invoiceIds = invoicesResult.rows.map((row) => row.id);
      const linesByInvoiceId = await this.fetchLinesForInvoices(client, tenantId, invoiceIds);

      const invoices = invoicesResult.rows.map((row) =>
        mapInvoiceRow(row, linesByInvoiceId.get(row.id) ?? []),
      );

      return { invoices, pagination: buildPagination(query.page, query.page_size, totalCount) };
    });
  }

  async findById(tenantId: string, userId: string | null, id: string): Promise<InvoiceDetailDto> {
    return this.db.transaction(tenantId, userId, (client) => this.fetchDetail(client, tenantId, id));
  }

  async listPayments(
    tenantId: string,
    userId: string | null,
    invoiceId: string,
  ): Promise<InvoicePaymentDto[]> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const invoiceResult = await client.query(
        `SELECT id FROM invoices WHERE tenant_id = $1 AND id = $2`,
        [tenantId, invoiceId],
      );
      if (invoiceResult.rowCount === 0) {
        throw AppException.notFound('指定された請求書が見つかりません');
      }
      const paymentsResult = await client.query<InvoicePaymentRow>(
        `SELECT ${SQL_COLUMNS.invoicePayment} FROM invoice_payments
         WHERE tenant_id = $1 AND invoice_id = $2 ORDER BY payment_date ASC, created_at ASC`,
        [tenantId, invoiceId],
      );
      return paymentsResult.rows.map(mapInvoicePaymentRow);
    });
  }

  async create(
    tenantId: string,
    userId: string,
    dto: InvoiceCreateInput,
  ): Promise<InvoiceDetailDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const { lineAmounts, subtotalAmount, taxAmount } = await this.computeLineAmountsAndTax(
        client,
        tenantId,
        dto.lines,
      );

      const invoiceNo = await this.generateInvoiceNo(client, tenantId, dto.issue_date);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO invoices
           (tenant_id, invoice_no, customer_id, issue_date, due_date, status, subtotal_amount, tax_amount, currency_code, created_by)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9)
         RETURNING id`,
        [
          tenantId,
          invoiceNo,
          dto.customer_id,
          dto.issue_date,
          dto.due_date,
          subtotalAmount,
          taxAmount,
          dto.currency_code,
          userId,
        ],
      );
      const invoiceId = inserted.rows[0].id;

      await this.insertLines(client, tenantId, invoiceId, lineAmounts);

      return this.fetchDetail(client, tenantId, invoiceId);
    });
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    dto: InvoiceCreateInput,
  ): Promise<InvoiceDetailDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      // invoicesにはDBトリガーによる状態遷移ガードが存在しないため、
      // draft状態であることをアプリ層で明示的に検証する。
      const current = await client.query<{ status: string }>(
        `SELECT status FROM invoices WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (current.rowCount === 0) {
        throw AppException.notFound('指定された請求書が見つかりません');
      }
      if (current.rows[0].status !== 'draft') {
        throw AppException.conflict('INVALID_STATE_TRANSITION', 'draft状態の請求書のみ編集できます');
      }

      const { lineAmounts, subtotalAmount, taxAmount } = await this.computeLineAmountsAndTax(
        client,
        tenantId,
        dto.lines,
      );

      await client.query(
        `UPDATE invoices
         SET customer_id = $3, issue_date = $4, due_date = $5, subtotal_amount = $6, tax_amount = $7, currency_code = $8
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id, dto.customer_id, dto.issue_date, dto.due_date, subtotalAmount, taxAmount, dto.currency_code],
      );

      await client.query(`DELETE FROM invoice_lines WHERE tenant_id = $1 AND invoice_id = $2`, [
        tenantId,
        id,
      ]);
      await this.insertLines(client, tenantId, id, lineAmounts);

      return this.fetchDetail(client, tenantId, id);
    });
  }

  async issue(tenantId: string, userId: string, id: string): Promise<InvoiceDetailDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const invoiceResult = await client.query<{
        status: string;
        issue_date: string;
        invoice_no: string;
        total_amount: string;
        tax_amount: string;
      }>(
        `SELECT status, TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue_date, invoice_no, total_amount, tax_amount
         FROM invoices WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, id],
      );
      if (invoiceResult.rowCount === 0) {
        throw AppException.notFound('指定された請求書が見つかりません');
      }
      const invoice = invoiceResult.rows[0];
      if (invoice.status !== 'draft') {
        throw AppException.conflict('INVALID_STATE_TRANSITION', 'draft状態の請求書のみ発行できます');
      }
      // `FOR UPDATE`により同一請求書への同時issue()呼び出しを直列化する。
      // 先勝ちがCOMMITした後で後続がこのSELECTを取得すると、status='issued'に
      // 更新済みのため上のチェックで確実にINVALID_STATE_TRANSITIONとなり、
      // 二重の売上仕訳計上(二重issue)を防止する。

      const linesResult = await client.query<{
        account_id: string;
        amount: string;
        tax_category_id: string;
      }>(
        `SELECT account_id, amount, tax_category_id FROM invoice_lines
         WHERE tenant_id = $1 AND invoice_id = $2 ORDER BY line_no ASC`,
        [tenantId, id],
      );

      const totalAmount = Number(invoice.total_amount);
      const taxAmount = Number(invoice.tax_amount);
      const arAccountId = await this.resolveAccountByCode(
        client,
        tenantId,
        ACCOUNTS_RECEIVABLE_CODE,
        '売掛金',
      );

      const entryNo = await generateJournalEntryNo(client, tenantId, invoice.issue_date);
      const jeInsert = await client.query<{ id: string }>(
        `INSERT INTO journal_entries
           (tenant_id, entry_no, entry_date, description, status, source_type, source_id, created_by)
         VALUES ($1, $2, $3, $4, 'draft', 'invoice', $5, $6)
         RETURNING id`,
        [tenantId, entryNo, invoice.issue_date, `売上計上: ${invoice.invoice_no}`, id, userId],
      );
      const journalEntryId = jeInsert.rows[0].id;

      let lineNo = 1;
      // 借方: 売掛金(総合計)
      await client.query(
        `INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount)
         VALUES ($1, $2, $3, $4, 'debit', $5)`,
        [tenantId, journalEntryId, lineNo++, arAccountId, totalAmount],
      );
      // 貸方: 明細行ごとの売上高科目(税抜金額)
      for (const line of linesResult.rows) {
        await client.query(
          `INSERT INTO journal_entry_lines
             (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount, tax_category_id)
           VALUES ($1, $2, $3, $4, 'credit', $5, $6)`,
          [tenantId, journalEntryId, lineNo++, line.account_id, line.amount, line.tax_category_id],
        );
      }
      // 貸方: 仮受消費税(税率区分ごとに1回だけ計算済みのtax_amountを集約1行で計上)
      if (taxAmount > 0) {
        const taxAccountId = await this.resolveAccountByCode(
          client,
          tenantId,
          CONSUMPTION_TAX_PAYABLE_CODE,
          '仮受消費税',
        );
        await client.query(
          `INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount)
           VALUES ($1, $2, $3, $4, 'credit', $5)`,
          [tenantId, journalEntryId, lineNo++, taxAccountId, taxAmount],
        );
      }

      // draftとして起票した上でposted遷移させ、`fn_check_journal_balance`による貸借一致検証を経由する
      // (構造上必ず一致するが、DBトリガーを最終防御として通す方針を他モジュールと統一している)。
      await client.query(
        `UPDATE journal_entries SET status = 'posted', posted_by = $3 WHERE tenant_id = $1 AND id = $2`,
        [tenantId, journalEntryId, userId],
      );

      await client.query(
        `UPDATE invoices SET status = 'issued', issued_at = now(), journal_entry_id = $3
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id, journalEntryId],
      );

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'invoice.issued',
        targetType: 'invoice',
        targetId: id,
        afterData: { status: 'issued', journal_entry_id: journalEntryId, total_amount: totalAmount },
      });

      return this.fetchDetail(client, tenantId, id);
    });
  }

  async recordPayment(
    tenantId: string,
    userId: string,
    id: string,
    dto: InvoicePaymentCreateInput,
  ): Promise<InvoicePaymentDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const invoiceResult = await client.query<{ status: string; total_amount: string }>(
        `SELECT status, total_amount FROM invoices WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (invoiceResult.rowCount === 0) {
        throw AppException.notFound('指定された請求書が見つかりません');
      }
      if (!['issued', 'partially_paid'].includes(invoiceResult.rows[0].status)) {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          '発行済み(issued/partially_paid)の請求書のみ入金消込を記録できます',
        );
      }

      const bankAccountId = await this.resolveAccountByCode(
        client,
        tenantId,
        BANK_DEPOSIT_CODE,
        '普通預金',
      );
      const arAccountId = await this.resolveAccountByCode(
        client,
        tenantId,
        ACCOUNTS_RECEIVABLE_CODE,
        '売掛金',
      );

      const entryNo = await generateJournalEntryNo(client, tenantId, dto.payment_date);
      const jeInsert = await client.query<{ id: string }>(
        `INSERT INTO journal_entries
           (tenant_id, entry_no, entry_date, description, status, source_type, source_id, created_by)
         VALUES ($1, $2, $3, $4, 'draft', 'invoice', $5, $6)
         RETURNING id`,
        [tenantId, entryNo, dto.payment_date, `売掛金消込`, id, userId],
      );
      const journalEntryId = jeInsert.rows[0].id;

      await client.query(
        `INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount)
         VALUES ($1, $2, 1, $3, 'debit', $4)`,
        [tenantId, journalEntryId, bankAccountId, dto.amount],
      );
      await client.query(
        `INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount)
         VALUES ($1, $2, 2, $3, 'credit', $4)`,
        [tenantId, journalEntryId, arAccountId, dto.amount],
      );
      await client.query(
        `UPDATE journal_entries SET status = 'posted', posted_by = $3 WHERE tenant_id = $1 AND id = $2`,
        [tenantId, journalEntryId, userId],
      );

      // invoice_paymentsは追記専用(UPDATE不可)のため、journal_entry_idは
      // 仕訳を先に確定させた上でINSERT時点から確定値として渡す。
      const paymentInsert = await client.query<{ id: string }>(
        `INSERT INTO invoice_payments
           (tenant_id, invoice_id, payment_date, amount, bank_transaction_id, journal_entry_id, matched_by, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7)
         RETURNING id`,
        [tenantId, id, dto.payment_date, dto.amount, dto.bank_transaction_id ?? null, journalEntryId, userId],
      );
      const paymentId = paymentInsert.rows[0].id;

      const totalPaidResult = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total FROM invoice_payments WHERE tenant_id = $1 AND invoice_id = $2`,
        [tenantId, id],
      );
      const totalPaid = Number(totalPaidResult.rows[0].total);
      const totalAmount = Number(invoiceResult.rows[0].total_amount);
      const newStatus = totalPaid >= totalAmount ? 'paid' : 'partially_paid';
      await client.query(`UPDATE invoices SET status = $3 WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        id,
        newStatus,
      ]);

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'invoice.payment_recorded',
        targetType: 'invoice',
        targetId: id,
        afterData: { amount: dto.amount, new_status: newStatus, journal_entry_id: journalEntryId },
      });

      const paymentRow = await client.query<InvoicePaymentRow>(
        `SELECT ${SQL_COLUMNS.invoicePayment} FROM invoice_payments WHERE tenant_id = $1 AND id = $2`,
        [tenantId, paymentId],
      );
      return mapInvoicePaymentRow(paymentRow.rows[0]);
    });
  }

  /**
   * 発行済み請求書を取消す(発行後24時間以内かつ未入金の場合のみ)。
   *
   * `fn_guard_journal_entry_transition` トリガーは `EXISTS (SELECT 1 FROM invoices
   * WHERE journal_entry_id = OLD.id)` を用いて売上計上仕訳のvoidを拒否するため、
   * この請求書自身が参照している間は自身の仕訳をvoidにできない(恒久的にブロックされる)。
   * そのため一時的に `invoices.journal_entry_id` をNULLにしてから仕訳をvoidにし、
   * 直後に同じ値を復元する(監査証跡としての紐付けは維持する)。
   */
  async voidInvoice(tenantId: string, userId: string, id: string): Promise<InvoiceDetailDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const invoiceResult = await client.query<{
        status: string;
        issued_at: Date | null;
        journal_entry_id: string | null;
      }>(
        `SELECT status, issued_at, journal_entry_id FROM invoices WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (invoiceResult.rowCount === 0) {
        throw AppException.notFound('指定された請求書が見つかりません');
      }
      const invoice = invoiceResult.rows[0];
      if (invoice.status !== 'issued') {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          '発行済み(issued)の請求書のみ取消できます',
        );
      }
      if (!invoice.issued_at || Date.now() - invoice.issued_at.getTime() > 24 * 60 * 60 * 1000) {
        throw AppException.conflict(
          'VOID_WINDOW_EXPIRED',
          '発行から24時間を超えているため取消できません。クレジットノートを起票してください',
        );
      }

      const paymentCountResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM invoice_payments WHERE tenant_id = $1 AND invoice_id = $2`,
        [tenantId, id],
      );
      if (Number(paymentCountResult.rows[0].count) > 0) {
        throw AppException.conflict(
          'VOID_WINDOW_EXPIRED',
          '入金消込が記録済みのため取消できません。クレジットノートを起票してください',
        );
      }

      // クレジットノートは元の売上計上仕訳の構成を按分比率で反転させたものであり、
      // 元仕訳をvoidにすると按分の前提そのものが失われ帳簿が不整合になる。
      // 部分クレジットノートの場合、請求書statusは'issued'のまま維持される(credit_note_issued
      // へは全額訂正時のみ遷移する)ため、statusチェックだけでは検出できずここで明示的に確認する。
      const creditNoteCountResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM credit_notes WHERE tenant_id = $1 AND original_invoice_id = $2`,
        [tenantId, id],
      );
      if (Number(creditNoteCountResult.rows[0].count) > 0) {
        throw AppException.conflict(
          'VOID_WINDOW_EXPIRED',
          'クレジットノートが起票済みのため取消できません',
        );
      }

      const journalEntryId = invoice.journal_entry_id;
      if (journalEntryId) {
        await client.query(`UPDATE invoices SET journal_entry_id = NULL WHERE tenant_id = $1 AND id = $2`, [
          tenantId,
          id,
        ]);
        await client.query(
          `UPDATE journal_entries SET status = 'voided', voided_by = $3, voided_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, journalEntryId, userId],
        );
      }

      await client.query(
        `UPDATE invoices SET status = 'voided', voided_at = now(), journal_entry_id = $3
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id, journalEntryId],
      );

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'invoice.voided',
        targetType: 'invoice',
        targetId: id,
        afterData: { status: 'voided', journal_entry_id: journalEntryId },
      });

      return this.fetchDetail(client, tenantId, id);
    });
  }

  async createCreditNote(
    tenantId: string,
    userId: string,
    id: string,
    dto: CreditNoteCreateInput,
  ): Promise<CreditNoteDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const invoiceResult = await client.query<{
        status: string;
        total_amount: string;
        journal_entry_id: string | null;
      }>(
        `SELECT status, total_amount, journal_entry_id FROM invoices WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (invoiceResult.rowCount === 0) {
        throw AppException.notFound('指定された請求書が見つかりません');
      }
      const invoice = invoiceResult.rows[0];
      if (!['issued', 'partially_paid', 'paid'].includes(invoice.status)) {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          '発行済みの請求書のみクレジットノートを起票できます',
        );
      }
      if (!invoice.journal_entry_id) {
        throw AppException.conflict('CONFLICT', '紐付けされた売上計上仕訳が見つかりません');
      }

      const totalAmount = Number(invoice.total_amount);
      const existingCreditedResult = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total FROM credit_notes WHERE tenant_id = $1 AND original_invoice_id = $2`,
        [tenantId, id],
      );
      const alreadyCredited = Number(existingCreditedResult.rows[0].total);
      if (alreadyCredited + dto.amount > totalAmount) {
        throw AppException.badRequest(
          `クレジットノート金額が請求書残額を超えています(請求総額: ${totalAmount}, 既存クレジットノート合計: ${alreadyCredited})`,
        );
      }

      const originalLinesResult = await client.query<{
        account_id: string;
        debit_credit: 'debit' | 'credit';
        amount: string;
      }>(
        `SELECT account_id, debit_credit, amount FROM journal_entry_lines
         WHERE tenant_id = $1 AND journal_entry_id = $2 ORDER BY line_no ASC`,
        [tenantId, invoice.journal_entry_id],
      );

      // 元の売上計上仕訳を按分比率で反転(reverse)する。1請求書全体に対するamount指定のみを
      // 受け付けるAPI仕様のため、明細ごとの個別指定は行わず、元仕訳の構成を比例縮小して
      // 貸借を再現する。
      //
      // 端数調整は反転後の借方側・貸方側それぞれで独立に行う(借方合計・貸方合計は
      // どちらも理論上dto.amountに一致するはずだが、切り捨て/丸めにより数円ずれることがある)。
      // 借方・貸方をまとめて1つの合計として調整すると、反転後は互いに符号が逆の関係にないため
      // (両者とも単純な正の金額の並びであるため)相殺されて意図しない補正になる
      // (実際に、合算調整では借方1行がゼロ円になりCHECK制約違反を起こすバグが確認された)。
      const ratio = dto.amount / totalAmount;
      const scaledLines = originalLinesResult.rows.map((line) => ({
        account_id: line.account_id,
        newDebitCredit: (line.debit_credit === 'debit' ? 'credit' : 'debit') as 'debit' | 'credit',
        amount: round2(Number(line.amount) * ratio),
      }));

      for (const side of ['debit', 'credit'] as const) {
        const sideLines = scaledLines.filter((l) => l.newDebitCredit === side);
        if (sideLines.length === 0) continue;
        const sideTotal = sideLines.reduce((sum, l) => sum + l.amount, 0);
        const diff = round2(dto.amount - sideTotal);
        if (diff !== 0) {
          const maxLine = sideLines.reduce((max, l) => (l.amount > max.amount ? l : max), sideLines[0]);
          maxLine.amount = round2(maxLine.amount + diff);
        }
      }

      const creditNoteNo = await this.generateCreditNoteNo(client, tenantId);
      const today = new Date().toISOString().slice(0, 10);
      const entryNo = await generateJournalEntryNo(client, tenantId, today);
      const jeInsert = await client.query<{ id: string }>(
        `INSERT INTO journal_entries
           (tenant_id, entry_no, entry_date, description, status, source_type, source_id, created_by)
         VALUES ($1, $2, $3, $4, 'draft', 'invoice', $5, $6)
         RETURNING id`,
        [tenantId, entryNo, today, `クレジットノート ${creditNoteNo}: ${dto.reason}`, id, userId],
      );
      const journalEntryId = jeInsert.rows[0].id;

      let lineNo = 1;
      for (const line of scaledLines) {
        await client.query(
          `INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [tenantId, journalEntryId, lineNo++, line.account_id, line.newDebitCredit, line.amount],
        );
      }

      await client.query(
        `UPDATE journal_entries SET status = 'posted', posted_by = $3 WHERE tenant_id = $1 AND id = $2`,
        [tenantId, journalEntryId, userId],
      );

      // credit_notesは追記専用(UPDATE不可)のため、journal_entry_idを確定値としてINSERTする。
      const creditNoteInsert = await client.query<{ id: string }>(
        `INSERT INTO credit_notes
           (tenant_id, original_invoice_id, credit_note_no, issue_date, amount, reason, journal_entry_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [tenantId, id, creditNoteNo, today, dto.amount, dto.reason, journalEntryId, userId],
      );
      const creditNoteId = creditNoteInsert.rows[0].id;

      // 請求総額の全額がクレジットノートで訂正された場合のみ、請求書を終端状態にする
      // (部分的な訂正では issued/partially_paid/paid のステータスを維持する)。
      if (alreadyCredited + dto.amount >= totalAmount) {
        await client.query(`UPDATE invoices SET status = 'credit_note_issued' WHERE tenant_id = $1 AND id = $2`, [
          tenantId,
          id,
        ]);
      }

      const creditNoteRow = await client.query<CreditNoteRow>(
        `SELECT ${SQL_COLUMNS.creditNote} FROM credit_notes WHERE tenant_id = $1 AND id = $2`,
        [tenantId, creditNoteId],
      );
      return mapCreditNoteRow(creditNoteRow.rows[0]);
    });
  }

  // --------------------------------------------------------------------------
  // 内部ヘルパー
  // --------------------------------------------------------------------------

  private async fetchDetail(
    client: PoolClient,
    tenantId: string,
    id: string,
  ): Promise<InvoiceDetailDto> {
    const invoiceResult = await client.query<InvoiceRow>(
      `SELECT ${SQL_COLUMNS.invoice} FROM invoices i WHERE i.tenant_id = $1 AND i.id = $2`,
      [tenantId, id],
    );
    const invoiceRow = invoiceResult.rows[0];
    if (!invoiceRow) {
      throw AppException.notFound('指定された請求書が見つかりません');
    }

    const linesResult = await client.query<InvoiceLineRow>(
      `SELECT ${SQL_COLUMNS.invoiceLine} FROM invoice_lines
       WHERE tenant_id = $1 AND invoice_id = $2 ORDER BY line_no ASC`,
      [tenantId, id],
    );
    const paymentsResult = await client.query<InvoicePaymentRow>(
      `SELECT ${SQL_COLUMNS.invoicePayment} FROM invoice_payments
       WHERE tenant_id = $1 AND invoice_id = $2 ORDER BY payment_date ASC, created_at ASC`,
      [tenantId, id],
    );
    const creditNotesResult = await client.query<CreditNoteRow>(
      `SELECT ${SQL_COLUMNS.creditNote} FROM credit_notes
       WHERE tenant_id = $1 AND original_invoice_id = $2 ORDER BY created_at ASC`,
      [tenantId, id],
    );

    let journalEntry: InvoiceDetailDto['journal_entry'] = null;
    if (invoiceRow.journal_entry_id) {
      const jeResult = await client.query<{ id: string; entry_no: string; status: string }>(
        `SELECT id, entry_no, status FROM journal_entries WHERE tenant_id = $1 AND id = $2`,
        [tenantId, invoiceRow.journal_entry_id],
      );
      journalEntry = jeResult.rows[0] ?? null;
    }

    return {
      ...mapInvoiceRow(invoiceRow, linesResult.rows.map(mapInvoiceLineRow)),
      payments: paymentsResult.rows.map(mapInvoicePaymentRow),
      credit_notes: creditNotesResult.rows.map(mapCreditNoteRow),
      journal_entry: journalEntry,
    };
  }

  private async fetchLinesForInvoices(
    client: PoolClient,
    tenantId: string,
    invoiceIds: string[],
  ): Promise<Map<string, InvoiceLineDto[]>> {
    const linesByInvoiceId = new Map<string, InvoiceLineDto[]>();
    if (invoiceIds.length === 0) {
      return linesByInvoiceId;
    }

    const linesResult = await client.query<InvoiceLineRow>(
      `SELECT ${SQL_COLUMNS.invoiceLine} FROM invoice_lines
       WHERE tenant_id = $1 AND invoice_id = ANY($2::uuid[])
       ORDER BY invoice_id, line_no ASC`,
      [tenantId, invoiceIds],
    );

    for (const row of linesResult.rows) {
      const list = linesByInvoiceId.get(row.invoice_id) ?? [];
      list.push(mapInvoiceLineRow(row));
      linesByInvoiceId.set(row.invoice_id, list);
    }
    return linesByInvoiceId;
  }

  /**
   * 明細行ごとの金額(quantity×unit_price)を計算した上で、消費税は税区分(tax_category_id)
   * ごとにグルーピングした小計へ税率を乗じ、**1請求書・税区分ごとに1回だけ**端数処理(切り捨て)を行う。
   * 明細行単位での個別端数処理は行わない(要件どおり)。
   */
  private async computeLineAmountsAndTax(
    client: PoolClient,
    tenantId: string,
    lines: InvoiceLineCreateInput[],
  ): Promise<{
    lineAmounts: (InvoiceLineCreateInput & { amount: number })[];
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

    const lineAmounts = lines.map((line) => ({ ...line, amount: round2(line.quantity * line.unit_price) }));

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
      // 切り捨て。税率区分ごとの小計に対して1回だけ適用する(明細行ごとの端数処理は行わない)。
      taxAmount += Math.floor((subtotal * rate) / 100);
    }

    const subtotalAmount = lineAmounts.reduce((sum, line) => sum + line.amount, 0);

    return { lineAmounts, subtotalAmount, taxAmount };
  }

  private async insertLines(
    client: PoolClient,
    tenantId: string,
    invoiceId: string,
    lines: (InvoiceLineCreateInput & { amount: number })[],
  ): Promise<void> {
    let lineNo = 1;
    for (const line of lines) {
      await client.query(
        `INSERT INTO invoice_lines
           (tenant_id, invoice_id, line_no, description, quantity, unit_price, amount, tax_category_id, account_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          tenantId,
          invoiceId,
          lineNo++,
          line.description,
          line.quantity,
          line.unit_price,
          line.amount,
          line.tax_category_id,
          line.account_id,
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

  private async generateInvoiceNo(
    client: PoolClient,
    tenantId: string,
    issueDate: string,
  ): Promise<string> {
    const datePart = issueDate.replace(/-/g, '');
    // 同時実行下での採番衝突防止(詳細は `acquireAdvisoryLock` のコメント参照)。
    await acquireAdvisoryLock(client, `invoice_no:${tenantId}:${datePart}`);
    const { rows } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM invoices WHERE tenant_id = $1 AND invoice_no LIKE $2`,
      [tenantId, `INV-${datePart}-%`],
    );
    const seq = Number(rows[0]?.count ?? 0) + 1;
    return `INV-${datePart}-${String(seq).padStart(4, '0')}`;
  }

  private async generateCreditNoteNo(client: PoolClient, tenantId: string): Promise<string> {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    await acquireAdvisoryLock(client, `credit_note_no:${tenantId}:${datePart}`);
    const { rows } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM credit_notes WHERE tenant_id = $1 AND credit_note_no LIKE $2`,
      [tenantId, `CN-${datePart}-%`],
    );
    const seq = Number(rows[0]?.count ?? 0) + 1;
    return `CN-${datePart}-${String(seq).padStart(4, '0')}`;
  }
}
