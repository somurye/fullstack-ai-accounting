import { VENDOR_BILL_STATUS_LABEL, type VendorBillStatus } from './types';

const STATUS_BADGE_CLASS: Record<VendorBillStatus, string> = {
  draft: 'badge-draft',
  pending_approval: 'badge-pending',
  approved: 'badge-posted',
  rejected: 'badge-rejected',
  scheduled_for_payment: 'badge-pending',
  paid: 'badge-posted',
};

export function StatusBadge({ status }: { status: VendorBillStatus }) {
  return <span className={STATUS_BADGE_CLASS[status]}>{VENDOR_BILL_STATUS_LABEL[status]}</span>;
}
