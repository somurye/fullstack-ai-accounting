import { z } from 'zod';

/**
 * expense-reports モジュールのリクエストバリデーションスキーマ。
 * `docs/openapi.yaml` の `ExpenseReportCreate` / `ExpenseReportLineCreate` に対応する。
 */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const EXPENSE_REPORT_STATUSES = [
  'submitted',
  'in_review',
  'approved',
  'rejected',
  'reimbursement_scheduled',
  'reimbursed',
] as const;

export const PAYMENT_METHODS = ['cash', 'corporate_card', 'bank_transfer', 'employee_advance'] as const;

export const expenseReportLineCreateSchema = z.object({
  expense_date: z.string().regex(DATE_ONLY_RE, 'expense_date is YYYY-MM-DD形式で指定してください'),
  category_id: z.string().uuid(),
  description: z.string().optional(),
  amount: z.number().positive(),
  payment_method: z.enum(PAYMENT_METHODS),
  tax_category_id: z.string().uuid().optional(),
  card_transaction_id: z.string().uuid().optional(),
});
export type ExpenseReportLineCreateInput = z.infer<typeof expenseReportLineCreateSchema>;

export const expenseReportCreateSchema = z.object({
  // 領収書OCR機能: ai_suggestions(target_type='expense_report')は申請作成前の
  // 撮影段階から追記されるため、フロントエンドが事前生成したUUIDをそのまま
  // 申請のidとして使うことで、OCR提案のtarget_idを常に有効な参照に保つ。
  id: z.string().uuid().optional(),
  on_behalf_of: z.string().uuid(),
  purpose: z.string().optional(),
  lines: z.array(expenseReportLineCreateSchema).min(1, '経費明細は1行以上必要です'),
});
export type ExpenseReportCreateInput = z.infer<typeof expenseReportCreateSchema>;

export const expenseReportListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(EXPENSE_REPORT_STATUSES).optional(),
  on_behalf_of: z.string().uuid().optional(),
  // openapi.yamlのExpenseReports検索パラメータ(status/on_behalf_of)には無いが、
  // フロントエンドの「自分の申請」「未承認キュー」タブを成立させるために追加した拡張パラメータ。
  submitted_by: z.string().uuid().optional(),
  pending_approval: z.coerce.boolean().optional(),
});
export type ExpenseReportListQuery = z.infer<typeof expenseReportListQuerySchema>;

export const expenseReportApproveSchema = z.object({
  comment: z.string().optional(),
});
export type ExpenseReportApproveInput = z.infer<typeof expenseReportApproveSchema>;

export const expenseReportRejectSchema = z.object({
  comment: z.string().min(1, '却下理由(comment)を入力してください'),
});
export type ExpenseReportRejectInput = z.infer<typeof expenseReportRejectSchema>;

/**
 * `POST /expense-reports/ocr`(multipart/form-data)のリクエストボディ。
 * `expense_report_id`は既存申請への明細追加時はその申請id、新規申請作成中は
 * フロントエンドが事前生成し後続の`POST /expense-reports`にも渡すUUIDを指定する
 * (`ai_suggestions.target_id`を常に有効な参照に保つための設計。詳細は
 * `expenseReportCreateSchema.id`のコメントを参照)。
 */
export const expenseReportOcrSchema = z.object({
  expense_report_id: z.string().uuid('expense_report_idはUUID形式で指定してください'),
});
export type ExpenseReportOcrInput = z.infer<typeof expenseReportOcrSchema>;
