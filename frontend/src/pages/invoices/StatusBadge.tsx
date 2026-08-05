import { INVOICE_STATUS_LABEL, type InvoiceStatus } from './types';

const STATUS_BADGE_CLASS: Record<InvoiceStatus, string> = {
  draft: 'badge-draft',
  issued: 'badge-pending',
  partially_paid: 'badge-pending',
  paid: 'badge-posted',
  overdue: 'badge-rejected',
  voided: 'badge-void',
  credit_note_issued: 'badge-reversed',
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return <span className={STATUS_BADGE_CLASS[status]}>{INVOICE_STATUS_LABEL[status]}</span>;
}
