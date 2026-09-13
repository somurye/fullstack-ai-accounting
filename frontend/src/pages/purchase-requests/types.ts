import type { components } from '../../types/api.generated';

export type PurchaseRequest = components['schemas']['PurchaseRequest'];
export type PurchaseRequestDetail = components['schemas']['PurchaseRequestDetail'];
export type CreatePurchaseRequestInput = components['schemas']['CreatePurchaseRequestInput'];
export type UpdatePurchaseRequestInput = components['schemas']['UpdatePurchaseRequestInput'];
export type PurchaseRequestStatus = components['schemas']['PurchaseRequestStatus'];

export interface PurchaseReceipt {
  id: string;
  purchase_request_id: string;
  received_quantity: number;
  received_date: string;
  notes: string | null;
  received_by: string;
  received_by_name?: string;
  created_at: string;
}

export interface LinkedVendorBill {
  id: string;
  bill_no: string;
  vendor_id: string;
  bill_date: string;
  due_date: string;
  status: string;
  total_amount: number;
}

export interface ExtendedPurchaseRequestDetail extends PurchaseRequestDetail {
  receipts?: PurchaseReceipt[];
  total_received_quantity?: number;
  remaining_quantity?: number;
  linked_vendor_bills?: LinkedVendorBill[];
}

export const STATUS_LABELS: Record<
  PurchaseRequestStatus,
  { label: string; bg: string; text: string; border: string }
> = {
  draft: {
    label: '下書き',
    bg: 'bg-surface-800',
    text: 'text-surface-300',
    border: 'border-surface-700',
  },
  pending_approval: {
    label: '承認待ち',
    bg: 'bg-amber-950/40',
    text: 'text-amber-400',
    border: 'border-amber-800/60',
  },
  active: {
    label: '承認済(発注確定)',
    bg: 'bg-emerald-950/40',
    text: 'text-emerald-400',
    border: 'border-emerald-800/60',
  },
  rejected: {
    label: '却下',
    bg: 'bg-rose-950/40',
    text: 'text-rose-400',
    border: 'border-rose-800/60',
  },
  terminated: {
    label: '解約・取消',
    bg: 'bg-zinc-800/60',
    text: 'text-zinc-400',
    border: 'border-zinc-700',
  },
};

export interface StatusCountItem {
  count: number;
  total_amount: number;
}

export interface StatusCounts {
  draft: StatusCountItem;
  pending_approval: StatusCountItem;
  active: StatusCountItem;
  rejected: StatusCountItem;
  terminated: StatusCountItem;
  total: StatusCountItem;
}

export interface SupplierRankingItem {
  supplier_id: string | null;
  supplier_name: string;
  request_count: number;
  total_amount: number;
}

export interface AmountSummary {
  current_month_active_amount: number;
  current_month_total_amount: number;
  current_period_active_amount: number;
  current_period_total_amount: number;
  current_month_label: string;
  current_period_label: string;
}

export interface PendingReceipts {
  total_pending_receipt_count: number;
  unreceived_count: number;
  partially_received_count: number;
}

export interface MonthlyTrendItem {
  month: string;
  active_amount: number;
  total_amount: number;
  request_count: number;
}

export interface PurchaseDashboardSummary {
  status_counts: StatusCounts;
  supplier_ranking: SupplierRankingItem[];
  amount_summary: AmountSummary;
  pending_receipts: PendingReceipts;
  monthly_trends: MonthlyTrendItem[];
}

