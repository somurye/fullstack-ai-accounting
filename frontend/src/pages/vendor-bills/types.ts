import type { components } from '../../types/api.generated';

export type VendorBill = components['schemas']['VendorBill'];
export type VendorBillLine = components['schemas']['VendorBillLine'];
export type VendorBillLineCreate = components['schemas']['VendorBillLineCreate'];
export type VendorBillCreate = components['schemas']['VendorBillCreate'];
export type VendorBillStatus = components['schemas']['VendorBillStatus'];
export type VendorBillPayment = components['schemas']['VendorBillPayment'];
export type PaymentMethod = components['schemas']['PaymentMethod'];
export type Vendor = components['schemas']['Vendor'];
export type ApprovalHistoryEntry = components['schemas']['ApprovalHistoryEntry'];
export type TaxCategory = components['schemas']['TaxCategory'];
export type Account = components['schemas']['Account'];

/** バックエンドの `fetchDetail` が返す拡張レスポンス(支払消込履歴・承認履歴・紐付け仕訳を含む) */
export interface VendorBillDetail extends VendorBill {
  payments: VendorBillPayment[];
  approval_history: ApprovalHistoryEntry[];
  journal_entry: { id: string; entry_no: string; status: string } | null;
}

export interface VendorBillListParams {
  page?: number;
  page_size?: number;
  status?: VendorBillStatus;
  vendor_id?: string;
  due_date_from?: string;
  due_date_to?: string;
}

export const VENDOR_BILL_STATUS_LABEL: Record<VendorBillStatus, string> = {
  draft: '下書き',
  pending_approval: '承認待ち',
  approved: '承認済み',
  rejected: '却下',
  scheduled_for_payment: '振込予定',
  paid: '支払済み',
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: '現金',
  corporate_card: '法人カード',
  bank_transfer: '銀行振込',
  employee_advance: '従業員立替',
};
