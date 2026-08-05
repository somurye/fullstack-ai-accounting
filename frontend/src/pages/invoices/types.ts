import type { components } from '../../types/api.generated';

export type Invoice = components['schemas']['Invoice'];
export type InvoiceLine = components['schemas']['InvoiceLine'];
export type InvoiceLineCreate = components['schemas']['InvoiceLineCreate'];
export type InvoiceCreate = components['schemas']['InvoiceCreate'];
export type InvoiceStatus = components['schemas']['InvoiceStatus'];
export type CreditNote = components['schemas']['CreditNote'];
export type InvoicePayment = components['schemas']['InvoicePayment'];
export type Customer = components['schemas']['Customer'];
export type TaxCategory = components['schemas']['TaxCategory'];
export type Account = components['schemas']['Account'];

/** バックエンドの `fetchDetail` が返す拡張レスポンス(消込履歴・クレジットノート・紐付け仕訳を含む) */
export interface InvoiceDetail extends Invoice {
  payments: InvoicePayment[];
  credit_notes: CreditNote[];
  journal_entry: { id: string; entry_no: string; status: string } | null;
}

export interface InvoiceListParams {
  page?: number;
  page_size?: number;
  status?: InvoiceStatus;
  customer_id?: string;
  due_date_from?: string;
  due_date_to?: string;
}

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: '下書き',
  issued: '発行済み',
  partially_paid: '一部入金',
  paid: '入金済み',
  overdue: '期日超過',
  voided: '取消済み',
  credit_note_issued: '訂正済み',
};
