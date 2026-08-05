import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { acquireAdvisoryLock } from '../../common/database/advisory-lock';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { generateJournalEntryNo } from '../../common/journal/generate-entry-no';
import { AiSuggestionsService } from '../ai-suggestions/ai-suggestions.service';
import type { AiSuggestionPayload } from '../ai-suggestions/ai-suggestions.mapper';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { SettingsService } from '../settings/settings.service';
import type {
  ExpenseReportApproveInput,
  ExpenseReportCreateInput,
  ExpenseReportLineCreateInput,
  ExpenseReportListQuery,
  ExpenseReportOcrInput,
  ExpenseReportRejectInput,
} from './dto/expense-report.schemas';
import {
  mapApprovalHistoryRow,
  mapExpenseReportLineRow,
  mapExpenseReportRow,
  SQL_COLUMNS,
  type ApprovalHistoryRow,
  type ExpenseReportDetailDto,
  type ExpenseReportDto,
  type ExpenseReportLineDto,
  type ExpenseReportLineRow,
  type ExpenseReportRow,
} from './expense-reports.mapper';
import { ReceiptOcrExtractionService, type OcrExtractionFile } from './receipt-ocr-extraction.service';

export interface ExpenseReportListResult {
  reports: ExpenseReportDto[];
  pagination: PaginationMeta;
}

export interface ExpenseReportOcrSuggestionData {
  transaction_date: string | null;
  amount: number | null;
  vendor_name: string | null;
  invoice_registration_number: string | null;
  suggested_account_id: string | null;
  confidence_score: number;
  model_name: string;
}

export interface ExpenseReportOcrSuggestion {
  id: string;
  data: ExpenseReportOcrSuggestionData;
}

export interface ExpenseReportOcrResult {
  suggestions: ExpenseReportOcrSuggestion[];
}

/**
 * 支払方法(payment_method)ごとの貸方科目を、勘定科目マスタの `code` 規約で解決する。
 *
 * `docs/openapi.yaml`・DBスキーマのいずれにも「テナントごとの支払方法別貸方科目設定」を
 * 保持する場所が存在しない(将来的にはテナント設定テーブルとして切り出すべき箇所)ため、
 * このMVP実装では固定のcode規約を採用する。該当科目が存在しないテナントでは
 * 明確なエラーメッセージで申請をブロックする(サイレントに誤った科目へ計上しない)。
 */
const PAYMENT_METHOD_CREDIT_ACCOUNT_CODE: Record<string, string> = {
  cash: '1000', // 現金
  corporate_card: '2110', // 未払金(法人カード)
  bank_transfer: '2120', // 未払金(振込)
  employee_advance: '2130', // 未払金(従業員立替)
};

@Injectable()
export class ExpenseReportsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly aiSuggestions: AiSuggestionsService,
    private readonly auditLogs: AuditLogsService,
    private readonly settings: SettingsService,
    private readonly receiptOcr: ReceiptOcrExtractionService,
  ) {}

  /**
   * レシート・領収書画像をVision AI(設定済みのAIプロバイダー)で解析し、取引情報を
   * `ai_suggestions`(target_type='expense_report', suggestion_type='ocr')へ追記保存する。
   * 原則1(AI提案の隔離領域遵守)により、確定データへは一切書き込まない。
   *
   * 1枚の画像に複数のレシート・領収書が写っている場合、`receiptOcr.extract()`は
   * 検出した数だけ配列で結果を返す。検出数ぶんループし、それぞれ独立した
   * `ai_suggestions`行として追記する(1レシート=1提案=1採否判定という既存の
   * accept/rejectモデルをそのまま維持するため、1行にまとめて配列で持たせない)。
   */
  async extractReceiptOcr(
    tenantId: string,
    userId: string,
    file: OcrExtractionFile,
    dto: ExpenseReportOcrInput,
  ): Promise<ExpenseReportOcrResult> {
    // AI呼び出し(最大30秒、`receipt-ocr-extraction.service.ts`参照)を
    // `db.transaction()`の外側で行う。トランザクション内で呼び出すと、
    // 開いたままのトランザクション(=プールから借用したコネクション)が
    // AI応答を待つ間ずっと占有され、`PG_POOL_MAX`を少数の同時OCRリクエストで
    // 枯渇させ、無関係な他テナントのリクエストまで巻き込んで詰まらせうる。
    // そのため、認証情報の取得(短時間)とAI呼び出し(長時間)の間で
    // トランザクションを分離する。
    const { provider, apiKey } = await this.db.transaction(tenantId, userId, (client) =>
      this.settings.getDecryptedAiCredentials(client, tenantId),
    );
    const extractions = await this.receiptOcr.extract(provider, apiKey, file);

    return this.db.transaction(tenantId, userId, async (client) => {
      const suggestions: ExpenseReportOcrSuggestion[] = [];
      for (const extraction of extractions) {
        let suggestedAccountId: string | null = null;
        if (extraction.vendor_name) {
          const candidate = await this.aiSuggestions.findTopExpenseAccountCandidate(
            client,
            tenantId,
            extraction.vendor_name,
          );
          suggestedAccountId = candidate?.accountId ?? null;
        }

        const payload: AiSuggestionPayload = {
          transaction_date: extraction.transaction_date,
          amount: extraction.amount,
          vendor_name: extraction.vendor_name,
          invoice_registration_number: extraction.invoice_registration_number,
          suggested_account_id: suggestedAccountId,
        };

        const suggestion = await this.aiSuggestions.generateOcrSuggestion(
          client,
          tenantId,
          dto.expense_report_id,
          payload,
          extraction.confidence_score,
          extraction.model_name,
        );

        suggestions.push({
          // insertSuggestion直後のRETURNINGで必ずidが埋まっているため安全にアサートする
          // (AiSuggestionDto.idはopenapi.yaml上optional指定のため型はstring | undefined)。
          id: suggestion.id as string,
          data: {
            transaction_date: extraction.transaction_date,
            amount: extraction.amount,
            vendor_name: extraction.vendor_name,
            invoice_registration_number: extraction.invoice_registration_number,
            suggested_account_id: suggestedAccountId,
            confidence_score: extraction.confidence_score,
            model_name: extraction.model_name,
          },
        });
      }

      return { suggestions };
    });
  }

  async list(
    tenantId: string,
    userId: string | null,
    currentUserId: string,
    query: ExpenseReportListQuery,
  ): Promise<ExpenseReportListResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const conditions: string[] = ['er.tenant_id = $1'];
      const params: unknown[] = [tenantId];

      if (query.status) {
        params.push(query.status);
        conditions.push(`er.status = $${params.length}`);
      }
      if (query.on_behalf_of) {
        params.push(query.on_behalf_of);
        conditions.push(`er.on_behalf_of = $${params.length}`);
      }
      if (query.submitted_by) {
        params.push(query.submitted_by);
        conditions.push(`er.submitted_by = $${params.length}`);
      }
      if (query.pending_approval) {
        // 「未承認(承認待ち)キュー」: 自分が提出したものは自己承認できないため除外し、
        // pendingの承認依頼が紐づく申請のみに絞り込む。
        params.push(currentUserId);
        conditions.push(
          `er.submitted_by <> $${params.length} AND EXISTS (
             SELECT 1 FROM approval_requests ar
             WHERE ar.tenant_id = er.tenant_id AND ar.target_type = 'expense_report'
               AND ar.target_id = er.id AND ar.status = 'pending'
           )`,
        );
      }

      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM expense_reports er WHERE ${whereClause}`,
        params,
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const listParams = [...params, query.page_size, (query.page - 1) * query.page_size];
      const reportsResult = await client.query<ExpenseReportRow>(
        `SELECT ${SQL_COLUMNS.expenseReport}
         FROM expense_reports er
         WHERE ${whereClause}
         ORDER BY er.submitted_at DESC, er.report_no DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      const reportIds = reportsResult.rows.map((row) => row.id);
      const linesByReportId = await this.fetchLinesForReports(client, tenantId, reportIds);

      const reports = reportsResult.rows.map((row) =>
        mapExpenseReportRow(row, linesByReportId.get(row.id) ?? []),
      );

      return { reports, pagination: buildPagination(query.page, query.page_size, totalCount) };
    });
  }

  async findById(
    tenantId: string,
    userId: string | null,
    id: string,
  ): Promise<ExpenseReportDetailDto> {
    return this.db.transaction(tenantId, userId, (client) => this.fetchDetail(client, tenantId, id));
  }

  async create(
    tenantId: string,
    userId: string,
    dto: ExpenseReportCreateInput,
  ): Promise<ExpenseReportDetailDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      // 1. 費目カテゴリの借方科目(default_account_id)を一括解決する。
      const categoryIds = [...new Set(dto.lines.map((line) => line.category_id))];
      const categoriesResult = await client.query<{ id: string; default_account_id: string | null }>(
        `SELECT id, default_account_id FROM expense_categories WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, categoryIds],
      );
      const categoryAccountMap = new Map<string, string>();
      for (const row of categoriesResult.rows) {
        if (!row.default_account_id) {
          throw AppException.badRequest(
            `費目カテゴリ(id: ${row.id})に借方科目(default_account_id)が設定されていません。勘定科目マスタの設定を確認してください`,
          );
        }
        categoryAccountMap.set(row.id, row.default_account_id);
      }
      const missingCategory = dto.lines.find((line) => !categoryAccountMap.has(line.category_id));
      if (missingCategory) {
        throw AppException.badRequest(
          `指定された費目カテゴリ(id: ${missingCategory.category_id})が見つかりません`,
        );
      }

      // 2. 貸方科目(支払方法別)を解決する。
      const creditAccountByPaymentMethod = new Map<string, string>();
      for (const paymentMethod of new Set(dto.lines.map((line) => line.payment_method))) {
        creditAccountByPaymentMethod.set(
          paymentMethod,
          await this.resolveCreditAccountId(client, tenantId, paymentMethod),
        );
      }

      // 3. expense_reports ヘッダを作成する(journal_entry_idは後続で確定させる)。
      const totalAmount = dto.lines.reduce((sum, line) => sum + line.amount, 0);
      // 起票日は明細のうち最も新しい支出日を採用する(invoices/vendor-bills/payroll-imports/
      // fixed-assetsの各モジュールと同様、業務上の取引日を起票日とする方針に統一する)。
      // `new Date()`(サーバー実行時刻)を使うと、過去日付の経費(例: 決算月をまたぐ精算)が
      // 常に「起票処理を行った日」の月次PL/BSに計上されてしまい、月次損益や会計期間との
      // 対応関係が壊れる。
      const entryDate = dto.lines.reduce((max, line) => (line.expense_date > max ? line.expense_date : max), dto.lines[0].expense_date);
      const reportNo = await this.generateReportNo(client, tenantId, entryDate);

      const insertedReport = await client.query<{ id: string }>(
        `INSERT INTO expense_reports
           (id, tenant_id, report_no, submitted_by, on_behalf_of, purpose, status, total_amount)
         VALUES (COALESCE($7::uuid, gen_random_uuid()), $1, $2, $3, $4, $5, 'submitted', $6)
         RETURNING id`,
        [tenantId, reportNo, userId, dto.on_behalf_of, dto.purpose ?? null, totalAmount, dto.id ?? null],
      );
      const reportId = insertedReport.rows[0].id;

      let lineNo = 1;
      for (const line of dto.lines) {
        const insertedLine = await client.query<{ id: string }>(
          `INSERT INTO expense_report_lines
             (tenant_id, expense_report_id, line_no, expense_date, category_id, description, amount, payment_method, tax_category_id, card_transaction_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id`,
          [
            tenantId,
            reportId,
            lineNo++,
            line.expense_date,
            line.category_id,
            line.description ?? null,
            line.amount,
            line.payment_method,
            line.tax_category_id ?? null,
            line.card_transaction_id ?? null,
          ],
        );

        // 過去の確定仕訳との類似度検索により、費目カテゴリ(勘定科目)の再提案を
        // AI提案の隔離領域(ai_suggestions)へ生成する(確定データは一切汚染しない)。
        if (line.description) {
          await this.aiSuggestions.generateExpenseLineSuggestion(
            client,
            tenantId,
            insertedLine.rows[0].id,
            categoryAccountMap.get(line.category_id) as string,
            line.description,
          );
        }
      }

      // 4. 先行draft仕訳を1トランザクション内で自動起票する(明細行ごとに借方/貸方を1:1で対応させ、
      //    構造上必ず貸借が一致するようにする)。
      const entryNo = await generateJournalEntryNo(client, tenantId, entryDate);
      const insertedEntry = await client.query<{ id: string }>(
        `INSERT INTO journal_entries
           (tenant_id, entry_no, entry_date, description, status, source_type, source_id, created_by)
         VALUES ($1, $2, $3, $4, 'draft', 'expense_report', $5, $6)
         RETURNING id`,
        [
          tenantId,
          entryNo,
          entryDate,
          dto.purpose ? `経費精算: ${dto.purpose}` : `経費精算: ${reportNo}`,
          reportId,
          userId,
        ],
      );
      const journalEntryId = insertedEntry.rows[0].id;

      let jeLineNo = 1;
      for (const line of dto.lines) {
        const debitAccountId = categoryAccountMap.get(line.category_id) as string;
        const creditAccountId = creditAccountByPaymentMethod.get(line.payment_method) as string;

        await client.query(
          `INSERT INTO journal_entry_lines
             (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount, tax_category_id, description)
           VALUES ($1, $2, $3, $4, 'debit', $5, $6, $7)`,
          [tenantId, journalEntryId, jeLineNo++, debitAccountId, line.amount, line.tax_category_id ?? null, line.description ?? null],
        );
        await client.query(
          `INSERT INTO journal_entry_lines
             (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount, description)
           VALUES ($1, $2, $3, $4, 'credit', $5, $6)`,
          [tenantId, journalEntryId, jeLineNo++, creditAccountId, line.amount, line.description ?? null],
        );
      }

      await client.query(
        `UPDATE expense_reports SET journal_entry_id = $3 WHERE tenant_id = $1 AND id = $2`,
        [tenantId, reportId, journalEntryId],
      );

      // 5. 単一ステップの承認依頼を作成する(承認ルール(approval_rules)の条件評価は本MVPの
      //    スコープ外とし、常に1ステップ承認とする)。
      await client.query(
        `INSERT INTO approval_requests (tenant_id, target_type, target_id, submitted_by, total_steps, current_step, status)
         VALUES ($1, 'expense_report', $2, $3, 1, 1, 'pending')`,
        [tenantId, reportId, userId],
      );

      return this.fetchDetail(client, tenantId, reportId);
    });
  }

  /**
   * 経費明細を1行追加する(submitted/in_review状態のみ)。`create()`と同じロジックで
   * 先行draft仕訳(journal_entry_id)にも借方(費目カテゴリ科目)/貸方(支払方法科目)の
   * 1行ずつを追加し、`expense_reports.total_amount`を再集計する。
   */
  async addLine(
    tenantId: string,
    userId: string,
    id: string,
    dto: ExpenseReportLineCreateInput,
  ): Promise<ExpenseReportLineDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const report = await client.query<{ status: string; journal_entry_id: string | null }>(
        `SELECT status, journal_entry_id FROM expense_reports WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (report.rowCount === 0) {
        throw AppException.notFound('指定された経費精算申請が見つかりません');
      }
      if (!['submitted', 'in_review'].includes(report.rows[0].status)) {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          '承認待ち(submitted/in_review)の申請のみ明細を追加できます',
        );
      }

      const categoryResult = await client.query<{ default_account_id: string | null }>(
        `SELECT default_account_id FROM expense_categories WHERE tenant_id = $1 AND id = $2`,
        [tenantId, dto.category_id],
      );
      if (categoryResult.rowCount === 0) {
        throw AppException.badRequest(`指定された費目カテゴリ(id: ${dto.category_id})が見つかりません`);
      }
      const debitAccountId = categoryResult.rows[0].default_account_id;
      if (!debitAccountId) {
        throw AppException.badRequest(
          `費目カテゴリ(id: ${dto.category_id})に借方科目(default_account_id)が設定されていません。勘定科目マスタの設定を確認してください`,
        );
      }
      const creditAccountId = await this.resolveCreditAccountId(client, tenantId, dto.payment_method);

      const nextLineNoResult = await client.query<{ next_line_no: number }>(
        `SELECT COALESCE(MAX(line_no), 0)::int + 1 AS next_line_no
         FROM expense_report_lines WHERE tenant_id = $1 AND expense_report_id = $2`,
        [tenantId, id],
      );
      const lineNo = nextLineNoResult.rows[0].next_line_no;

      const insertedLine = await client.query<{ id: string }>(
        `INSERT INTO expense_report_lines
           (tenant_id, expense_report_id, line_no, expense_date, category_id, description, amount, payment_method, tax_category_id, card_transaction_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          tenantId,
          id,
          lineNo,
          dto.expense_date,
          dto.category_id,
          dto.description ?? null,
          dto.amount,
          dto.payment_method,
          dto.tax_category_id ?? null,
          dto.card_transaction_id ?? null,
        ],
      );

      if (dto.description) {
        await this.aiSuggestions.generateExpenseLineSuggestion(
          client,
          tenantId,
          insertedLine.rows[0].id,
          debitAccountId,
          dto.description,
        );
      }

      const journalEntryId = report.rows[0].journal_entry_id;
      if (journalEntryId) {
        const nextJeLineNoResult = await client.query<{ next_line_no: number }>(
          `SELECT COALESCE(MAX(line_no), 0)::int + 1 AS next_line_no
           FROM journal_entry_lines WHERE tenant_id = $1 AND journal_entry_id = $2`,
          [tenantId, journalEntryId],
        );
        let jeLineNo = nextJeLineNoResult.rows[0].next_line_no;

        await client.query(
          `INSERT INTO journal_entry_lines
             (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount, tax_category_id, description)
           VALUES ($1, $2, $3, $4, 'debit', $5, $6, $7)`,
          [tenantId, journalEntryId, jeLineNo++, debitAccountId, dto.amount, dto.tax_category_id ?? null, dto.description ?? null],
        );
        await client.query(
          `INSERT INTO journal_entry_lines
             (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount, description)
           VALUES ($1, $2, $3, $4, 'credit', $5, $6)`,
          [tenantId, journalEntryId, jeLineNo++, creditAccountId, dto.amount, dto.description ?? null],
        );
      }

      await client.query(
        `UPDATE expense_reports SET total_amount = total_amount + $3 WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id, dto.amount],
      );

      const lineResult = await client.query<ExpenseReportLineRow>(
        `SELECT ${SQL_COLUMNS.expenseReportLine} FROM expense_report_lines WHERE tenant_id = $1 AND id = $2`,
        [tenantId, insertedLine.rows[0].id],
      );
      return mapExpenseReportLineRow(lineResult.rows[0]);
    });
  }

  async approve(
    tenantId: string,
    userId: string,
    id: string,
    dto: ExpenseReportApproveInput,
  ): Promise<ExpenseReportDetailDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const report = await client.query<{ status: string; journal_entry_id: string | null }>(
        `SELECT status, journal_entry_id FROM expense_reports WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (report.rowCount === 0) {
        throw AppException.notFound('指定された経費精算申請が見つかりません');
      }
      if (!['submitted', 'in_review'].includes(report.rows[0].status)) {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          '承認待ち(submitted/in_review)の申請のみ承認できます',
        );
      }

      const approvalRequest = await client.query<{
        id: string;
        status: string;
        current_step: number;
        total_steps: number;
      }>(
        `SELECT id, status, current_step, total_steps FROM approval_requests
         WHERE tenant_id = $1 AND target_type = 'expense_report' AND target_id = $2`,
        [tenantId, id],
      );
      if (approvalRequest.rowCount === 0) {
        throw AppException.conflict('CONFLICT', '承認依頼(approval_requests)が見つかりません');
      }
      const ar = approvalRequest.rows[0];
      if (ar.status !== 'pending') {
        throw AppException.conflict('INVALID_STATE_TRANSITION', 'この承認依頼は既に完了しています');
      }
      await this.assertAssignedApprover(client, tenantId, userId, 'expense_report', ar.current_step);

      // `trg_prevent_self_approval` トリガーが submitted_by = approver_id を検知して
      // 23514(check_violation)を送出する(申請者本人による承認の防止)。
      // ここでの明示的な事前チェックは行わず、DBトリガーの発火をそのまま
      // `pg-error-mapper` 経由で `SELF_APPROVAL_NOT_ALLOWED` へ変換させる。
      await client.query(
        `INSERT INTO approval_history (tenant_id, approval_request_id, step_number, approver_id, action, comment)
         VALUES ($1, $2, $3, $4, 'approve', $5)`,
        [tenantId, ar.id, ar.current_step, userId, dto.comment ?? null],
      );

      if (ar.current_step >= ar.total_steps) {
        await client.query(`UPDATE approval_requests SET status = 'approved' WHERE id = $1`, [ar.id]);
        await client.query(
          `UPDATE expense_reports SET status = 'approved' WHERE tenant_id = $1 AND id = $2`,
          [tenantId, id],
        );
        if (report.rows[0].journal_entry_id) {
          // 先行起票していたdraft仕訳を確定する。`fn_check_journal_balance` が貸借一致を
          // 再検証する(自動起票は明細行ごとに借方/貸方を1:1で対応させているため必ず一致する)。
          await client.query(
            `UPDATE journal_entries SET status = 'posted', posted_by = $3 WHERE tenant_id = $1 AND id = $2`,
            [tenantId, report.rows[0].journal_entry_id, userId],
          );
        }

        await this.auditLogs.record(client, tenantId, {
          actorUserId: userId,
          action: 'expense_report.approved',
          targetType: 'expense_report',
          targetId: id,
          afterData: { status: 'approved', journal_entry_id: report.rows[0].journal_entry_id },
        });
      } else {
        await client.query(`UPDATE approval_requests SET current_step = current_step + 1 WHERE id = $1`, [
          ar.id,
        ]);
        await client.query(
          `UPDATE expense_reports SET status = 'in_review' WHERE tenant_id = $1 AND id = $2`,
          [tenantId, id],
        );
      }

      return this.fetchDetail(client, tenantId, id);
    });
  }

  async reject(
    tenantId: string,
    userId: string,
    id: string,
    dto: ExpenseReportRejectInput,
  ): Promise<ExpenseReportDetailDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const report = await client.query<{ status: string; journal_entry_id: string | null }>(
        `SELECT status, journal_entry_id FROM expense_reports WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (report.rowCount === 0) {
        throw AppException.notFound('指定された経費精算申請が見つかりません');
      }
      if (!['submitted', 'in_review'].includes(report.rows[0].status)) {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          '承認待ち(submitted/in_review)の申請のみ却下できます',
        );
      }

      const approvalRequest = await client.query<{ id: string; status: string; current_step: number }>(
        `SELECT id, status, current_step FROM approval_requests
         WHERE tenant_id = $1 AND target_type = 'expense_report' AND target_id = $2`,
        [tenantId, id],
      );
      if (approvalRequest.rowCount === 0) {
        throw AppException.conflict('CONFLICT', '承認依頼(approval_requests)が見つかりません');
      }
      const ar = approvalRequest.rows[0];
      if (ar.status !== 'pending') {
        throw AppException.conflict('INVALID_STATE_TRANSITION', 'この承認依頼は既に完了しています');
      }
      await this.assertAssignedApprover(client, tenantId, userId, 'expense_report', ar.current_step);

      // 却下も`trg_prevent_self_approval`の対象(申請者本人によるアクションを一律禁止)。
      await client.query(
        `INSERT INTO approval_history (tenant_id, approval_request_id, step_number, approver_id, action, comment)
         VALUES ($1, $2, $3, $4, 'reject', $5)`,
        [tenantId, ar.id, ar.current_step, userId, dto.comment],
      );

      await client.query(`UPDATE approval_requests SET status = 'rejected' WHERE id = $1`, [ar.id]);
      await client.query(
        `UPDATE expense_reports SET status = 'rejected' WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );

      if (report.rows[0].journal_entry_id) {
        // 先行起票していたdraft仕訳を破棄する。journal_entriesは物理削除ができない
        // (`fn_guard_journal_entry_transition`)ため、draft状態からvoidedへ直接遷移させることで
        // 「破棄」を表現する(draft状態からの遷移はDBトリガーで制限されていないため許可される)。
          await client.query(
          `UPDATE journal_entries
           SET status = 'voided', voided_at = now(), voided_by = $3
           WHERE tenant_id = $1 AND id = $2 AND status = 'draft'`,
          [tenantId, report.rows[0].journal_entry_id, userId],
        );
      }

      return this.fetchDetail(client, tenantId, id);
    });
  }

  // --------------------------------------------------------------------------
  // 内部ヘルパー
  // --------------------------------------------------------------------------

  /**
   * 呼び出しユーザーが、この承認依頼の現在のステップに割り当てられた承認者
   * (`approval_rules.approver_user_id` または `approver_role_id` 経由)であることを検証する。
   * 自己承認の禁止はDBトリガー(`trg_prevent_self_approval`)に委ねているが、
   * 「そもそも承認権限を割り当てられていない第三者」による承認/却下はDB制約だけでは
   * 防げないため、ここでアプリケーション層のガードとして必須で行う
   * (`approval-requests.service.ts` の同名メソッドと同じ方針)。
   */
  private async assertAssignedApprover(
    client: PoolClient,
    tenantId: string,
    userId: string,
    targetType: 'expense_report',
    currentStep: number,
  ): Promise<void> {
    const result = await client.query(
      `SELECT 1 FROM approval_rules rule
       WHERE rule.tenant_id = $1 AND rule.target_type = $2
         AND rule.step_number = $3 AND rule.is_active = TRUE
         AND (
           rule.approver_user_id = $4
           OR rule.approver_role_id IN (
             SELECT role_id FROM user_roles WHERE tenant_id = $1 AND user_id = $4
           )
         )
       LIMIT 1`,
      [tenantId, targetType, currentStep, userId],
    );
    if (result.rowCount === 0) {
      throw AppException.forbidden('この承認依頼のステップに割り当てられた承認者ではありません');
    }
  }

  private async fetchDetail(
    client: PoolClient,
    tenantId: string,
    id: string,
  ): Promise<ExpenseReportDetailDto> {
    const reportResult = await client.query<ExpenseReportRow>(
      `SELECT ${SQL_COLUMNS.expenseReport} FROM expense_reports WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const reportRow = reportResult.rows[0];
    if (!reportRow) {
      throw AppException.notFound('指定された経費精算申請が見つかりません');
    }

    const linesResult = await client.query<ExpenseReportLineRow>(
      `SELECT ${SQL_COLUMNS.expenseReportLine}
       FROM expense_report_lines
       WHERE tenant_id = $1 AND expense_report_id = $2
       ORDER BY line_no ASC`,
      [tenantId, id],
    );

    const historyResult = await client.query<ApprovalHistoryRow>(
      `SELECT ${SQL_COLUMNS.approvalHistory}
       FROM approval_history ah
       JOIN approval_requests ar ON ar.id = ah.approval_request_id
       WHERE ah.tenant_id = $1 AND ar.target_type = 'expense_report' AND ar.target_id = $2
       ORDER BY ah.acted_at ASC`,
      [tenantId, id],
    );

    let journalEntry: ExpenseReportDetailDto['journal_entry'] = null;
    if (reportRow.journal_entry_id) {
      const jeResult = await client.query<{ id: string; entry_no: string; status: string }>(
        `SELECT id, entry_no, status FROM journal_entries WHERE tenant_id = $1 AND id = $2`,
        [tenantId, reportRow.journal_entry_id],
      );
      journalEntry = jeResult.rows[0] ?? null;
    }

    return {
      ...mapExpenseReportRow(reportRow, linesResult.rows.map(mapExpenseReportLineRow)),
      approval_history: historyResult.rows.map(mapApprovalHistoryRow),
      journal_entry: journalEntry,
    };
  }

  private async fetchLinesForReports(
    client: PoolClient,
    tenantId: string,
    reportIds: string[],
  ): Promise<Map<string, ExpenseReportLineDto[]>> {
    const linesByReportId = new Map<string, ExpenseReportLineDto[]>();
    if (reportIds.length === 0) {
      return linesByReportId;
    }

    const linesResult = await client.query<ExpenseReportLineRow>(
      `SELECT ${SQL_COLUMNS.expenseReportLine}
       FROM expense_report_lines
       WHERE tenant_id = $1 AND expense_report_id = ANY($2::uuid[])
       ORDER BY expense_report_id, line_no ASC`,
      [tenantId, reportIds],
    );

    for (const row of linesResult.rows) {
      const list = linesByReportId.get(row.expense_report_id) ?? [];
      list.push(mapExpenseReportLineRow(row));
      linesByReportId.set(row.expense_report_id, list);
    }
    return linesByReportId;
  }

  private async resolveCreditAccountId(
    client: PoolClient,
    tenantId: string,
    paymentMethod: string,
  ): Promise<string> {
    const code = PAYMENT_METHOD_CREDIT_ACCOUNT_CODE[paymentMethod];
    const result = await client.query<{ id: string }>(
      `SELECT id FROM accounts WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );
    const account = result.rows[0];
    if (!account) {
      throw AppException.badRequest(
        `支払方法「${paymentMethod}」に対応する貸方科目(code: ${code})が勘定科目マスタに存在しません。管理者に登録を依頼してください`,
      );
    }
    return account.id;
  }

  private async generateReportNo(client: PoolClient, tenantId: string, entryDate: string): Promise<string> {
    const datePart = entryDate.replace(/-/g, '');
    // `entry_no`/`invoice_no`/`credit_note_no`と同じ採番競合対策(advisory lock)。
    await acquireAdvisoryLock(client, `expense_report_no:${tenantId}:${datePart}`);
    const { rows } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM expense_reports WHERE tenant_id = $1 AND report_no LIKE $2`,
      [tenantId, `EXP-${datePart}-%`],
    );
    const seq = Number(rows[0]?.count ?? 0) + 1;
    return `EXP-${datePart}-${String(seq).padStart(4, '0')}`;
  }
}
