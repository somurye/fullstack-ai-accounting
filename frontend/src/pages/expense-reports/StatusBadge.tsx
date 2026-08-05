import { EXPENSE_REPORT_STATUS_LABEL, type ExpenseReportStatus } from './types';

const STATUS_BADGE_CLASS: Record<ExpenseReportStatus, string> = {
  submitted: 'badge-pending',
  in_review: 'badge-pending',
  approved: 'badge-posted',
  rejected: 'badge-rejected',
  reimbursement_scheduled: 'badge-reversed',
  reimbursed: 'badge-posted',
};

export function StatusBadge({ status }: { status: ExpenseReportStatus }) {
  return <span className={STATUS_BADGE_CLASS[status]}>{EXPENSE_REPORT_STATUS_LABEL[status]}</span>;
}
