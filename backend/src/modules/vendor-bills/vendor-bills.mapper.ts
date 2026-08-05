import type { components } from '../../types/api.generated';

export type VendorBillDto = components['schemas']['VendorBill'];
export type VendorBillLineDto = components['schemas']['VendorBillLine'];
export type VendorBillPaymentDto = components['schemas']['VendorBillPayment'];
export type ApprovalHistoryEntryDto = components['schemas']['ApprovalHistoryEntry'];

/** 詳細画面向けに、支払消込履歴・承認履歴・紐付け仕訳を加算した拡張レスポンス型 */
export interface VendorBillDetailDto extends VendorBillDto {
  payments: VendorBillPaymentDto[];
  approval_history: ApprovalHistoryEntryDto[];
  journal_entry: { id: string; entry_no: string; status: string } | null;
}

export interface VendorBillRow {
  id: string;
  bill_no: string;
  vendor_id: string;
  bill_date: string;
  due_date: string;
  status: string;
  subtotal_amount: string;
  tax_amount: string;
  total_amount: string;
  payment_method: string;
  journal_entry_id: string | null;
  current_approval_step: number;
}

export interface VendorBillLineRow {
  id: string;
  vendor_bill_id: string;
  line_no: number;
  description: string;
  amount: string;
  tax_category_id: string;
  account_id: string;
  department_id: string | null;
}

export interface VendorBillPaymentRow {
  id: string;
  vendor_bill_id: string;
  payment_date: string;
  amount: string;
  bank_transaction_id: string | null;
  payment_batch_item_id: string | null;
  journal_entry_id: string | null;
  matched_by: string;
}

export interface ApprovalHistoryRow {
  id: string;
  step_number: number;
  approver_id: string;
  action: string;
  comment: string | null;
  acted_at: Date;
}

export function mapVendorBillLineRow(row: VendorBillLineRow): VendorBillLineDto {
  return {
    id: row.id,
    line_no: row.line_no,
    description: row.description,
    amount: Number(row.amount),
    tax_category_id: row.tax_category_id,
    account_id: row.account_id,
    department_id: row.department_id,
  };
}

export function mapVendorBillRow(row: VendorBillRow, lines: VendorBillLineDto[]): VendorBillDto {
  return {
    id: row.id,
    bill_no: row.bill_no,
    vendor_id: row.vendor_id,
    bill_date: row.bill_date,
    due_date: row.due_date,
    status: row.status as VendorBillDto['status'],
    subtotal_amount: Number(row.subtotal_amount),
    tax_amount: Number(row.tax_amount),
    total_amount: Number(row.total_amount),
    payment_method: row.payment_method as VendorBillDto['payment_method'],
    journal_entry_id: row.journal_entry_id,
    current_approval_step: row.current_approval_step,
    lines,
  };
}

export function mapVendorBillPaymentRow(row: VendorBillPaymentRow): VendorBillPaymentDto {
  return {
    id: row.id,
    vendor_bill_id: row.vendor_bill_id,
    payment_date: row.payment_date,
    amount: Number(row.amount),
    bank_transaction_id: row.bank_transaction_id,
    payment_batch_item_id: row.payment_batch_item_id,
    journal_entry_id: row.journal_entry_id,
    matched_by: row.matched_by as VendorBillPaymentDto['matched_by'],
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

const VENDOR_BILL_COLUMNS = `
  id,
  bill_no,
  vendor_id,
  TO_CHAR(bill_date, 'YYYY-MM-DD') AS bill_date,
  TO_CHAR(due_date, 'YYYY-MM-DD') AS due_date,
  status,
  subtotal_amount,
  tax_amount,
  total_amount,
  payment_method,
  journal_entry_id,
  current_approval_step
`;

const VENDOR_BILL_LINE_COLUMNS = `
  id,
  vendor_bill_id,
  line_no,
  description,
  amount,
  tax_category_id,
  account_id,
  department_id
`;

const VENDOR_BILL_PAYMENT_COLUMNS = `
  id,
  vendor_bill_id,
  TO_CHAR(payment_date, 'YYYY-MM-DD') AS payment_date,
  amount,
  bank_transaction_id,
  payment_batch_item_id,
  journal_entry_id,
  matched_by
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
  vendorBill: VENDOR_BILL_COLUMNS,
  vendorBillLine: VENDOR_BILL_LINE_COLUMNS,
  vendorBillPayment: VENDOR_BILL_PAYMENT_COLUMNS,
  approvalHistory: APPROVAL_HISTORY_COLUMNS,
};
