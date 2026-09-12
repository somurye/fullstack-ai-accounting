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
