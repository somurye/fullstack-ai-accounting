import type { components } from '../../types/api.generated';

export type ExpenseReportDto = components['schemas']['ExpenseReport'];
export type ExpenseReportLineDto = components['schemas']['ExpenseReportLine'];
export type ApprovalHistoryEntryDto = components['schemas']['ApprovalHistoryEntry'];

/**
 * `ExpenseReport`(openapi.yaml)に、詳細画面で必要な「紐付け仕訳」「承認履歴」を
 * 追加した拡張レスポンス型。openapi.yamlのExpenseReportスキーマには無い加算フィールドだが、
 * 既存フィールドは維持したまま追加するのみなので後方互換を壊さない。
 */
export interface ExpenseReportDetailDto extends ExpenseReportDto {
  approval_history: ApprovalHistoryEntryDto[];
  journal_entry: { id: string; entry_no: string; status: string } | null;
}

export interface ExpenseReportRow {
  id: string;
  report_no: string;
  submitted_by: string;
  on_behalf_of: string;
  purpose: string | null;
  status: string;
  total_amount: string;
  journal_entry_id: string | null;
}

export interface ExpenseReportLineRow {
  id: string;
  expense_report_id: string;
  line_no: number;
  expense_date: string;
  category_id: string;
  description: string | null;
  amount: string;
  payment_method: string;
  tax_category_id: string | null;
  card_transaction_id: string | null;
}

export interface ApprovalHistoryRow {
  id: string;
  step_number: number;
  approver_id: string;
  action: string;
  comment: string | null;
  acted_at: Date;
}

export function mapExpenseReportLineRow(row: ExpenseReportLineRow): ExpenseReportLineDto {
  return {
    id: row.id,
    line_no: row.line_no,
    expense_date: row.expense_date,
    category_id: row.category_id,
    description: row.description,
    amount: Number(row.amount),
    payment_method: row.payment_method as ExpenseReportLineDto['payment_method'],
    tax_category_id: row.tax_category_id,
    card_transaction_id: row.card_transaction_id,
  };
}

export function mapExpenseReportRow(
  row: ExpenseReportRow,
  lines: ExpenseReportLineDto[],
): ExpenseReportDto {
  return {
    id: row.id,
    report_no: row.report_no,
    submitted_by: row.submitted_by,
    on_behalf_of: row.on_behalf_of,
    purpose: row.purpose,
    status: row.status as ExpenseReportDto['status'],
    total_amount: Number(row.total_amount),
    journal_entry_id: row.journal_entry_id,
    lines,
  };
}

export function mapApprovalHistoryRow(row: ApprovalHistoryRow): ApprovalHistoryEntryDto {
  return {
    id: row.id,
    step_number: row.step_number,
    approver_id: row.approver_id,
    action: row.action as ApprovalHistoryEntryDto['action'],
    comment: row.comment,
    acted_at: row.acted_at.toISOString(),
  };
}

const EXPENSE_REPORT_COLUMNS = `
  id,
  report_no,
  submitted_by,
  on_behalf_of,
  purpose,
  status,
  total_amount,
  journal_entry_id
`;

const EXPENSE_REPORT_LINE_COLUMNS = `
  id,
  expense_report_id,
  line_no,
  TO_CHAR(expense_date, 'YYYY-MM-DD') AS expense_date,
  category_id,
  description,
  amount,
  payment_method,
  tax_category_id,
  card_transaction_id
`;

const APPROVAL_HISTORY_COLUMNS = `
  ah.id,
  ah.step_number,
  ah.approver_id,
  ah.action,
  ah.comment,
  ah.acted_at
`;

export const SQL_COLUMNS = {
  expenseReport: EXPENSE_REPORT_COLUMNS,
  expenseReportLine: EXPENSE_REPORT_LINE_COLUMNS,
  approvalHistory: APPROVAL_HISTORY_COLUMNS,
};
