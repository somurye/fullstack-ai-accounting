import type { components } from '../../types/api.generated';

export type ExpenseReport = components['schemas']['ExpenseReport'];
export type ExpenseReportLine = components['schemas']['ExpenseReportLine'];
export type ExpenseReportLineCreate = components['schemas']['ExpenseReportLineCreate'];
export type ExpenseReportCreate = components['schemas']['ExpenseReportCreate'];
export type ExpenseReportStatus = components['schemas']['ExpenseReportStatus'];
export type PaymentMethod = components['schemas']['PaymentMethod'];
export type ApprovalHistoryEntry = components['schemas']['ApprovalHistoryEntry'];
export type ExpenseReportOcrResult = components['schemas']['ExpenseReportOcrResult'];
export type ExpenseReportOcrSuggestion = components['schemas']['ExpenseReportOcrSuggestion'];
export type ExpenseReportOcrSuggestionData = components['schemas']['ExpenseReportOcrSuggestionData'];

/** `docs/openapi.yaml` に定義が無いため、バックエンドの `ExpenseCategoriesController` に合わせた独自型 */
export interface ExpenseCategory {
  id: string;
  code: string;
  name: string;
  default_account_id: string | null;
  requires_receipt: boolean;
  monthly_limit_amount: number | null;
  is_active: boolean;
}

/** バックエンドの `fetchDetail` が返す拡張レスポンス(承認履歴・紐付け仕訳を含む) */
export interface ExpenseReportDetail extends ExpenseReport {
  approval_history: ApprovalHistoryEntry[];
  journal_entry: { id: string; entry_no: string; status: string } | null;
}

export interface ExpenseReportListParams {
  page?: number;
  page_size?: number;
  status?: ExpenseReportStatus;
  on_behalf_of?: string;
  submitted_by?: string;
  pending_approval?: boolean;
}

export const EXPENSE_REPORT_STATUS_LABEL: Record<ExpenseReportStatus, string> = {
  submitted: '申請中',
  in_review: '審査中',
  approved: '承認済み',
  rejected: '却下',
  reimbursement_scheduled: '精算予定',
  reimbursed: '精算済み',
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: '現金',
  corporate_card: '法人カード',
  bank_transfer: '銀行振込',
  employee_advance: '従業員立替',
};
