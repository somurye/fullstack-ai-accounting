import type { components } from '../../types/api.generated';

export type InvoiceDto = components['schemas']['Invoice'];
export type InvoiceLineDto = components['schemas']['InvoiceLine'];
export type CreditNoteDto = components['schemas']['CreditNote'];
export type InvoicePaymentDto = components['schemas']['InvoicePayment'];

/** 詳細画面向けに、消込履歴・クレジットノート履歴・紐付け仕訳を加算した拡張レスポンス型 */
export interface InvoiceDetailDto extends InvoiceDto {
  payments: InvoicePaymentDto[];
  credit_notes: CreditNoteDto[];
  journal_entry: { id: string; entry_no: string; status: string } | null;
}

export interface InvoiceRow {
  id: string;
  invoice_no: string;
  customer_id: string;
  issue_date: string;
  due_date: string;
  status: string;
  subtotal_amount: string;
  tax_amount: string;
  total_amount: string;
  currency_code: string;
  journal_entry_id: string | null;
  issued_at: Date | null;
}

export interface InvoiceLineRow {
  id: string;
  invoice_id: string;
  line_no: number;
  description: string;
  quantity: string;
  unit_price: string;
  amount: string;
  tax_category_id: string;
  account_id: string;
}

export interface CreditNoteRow {
  id: string;
  original_invoice_id: string;
  credit_note_no: string;
  issue_date: string;
  amount: string;
  reason: string;
  journal_entry_id: string | null;
}

export interface InvoicePaymentRow {
  id: string;
  invoice_id: string;
  payment_date: string;
  amount: string;
  bank_transaction_id: string | null;
  journal_entry_id: string | null;
  matched_by: string;
}

export function mapInvoiceLineRow(row: InvoiceLineRow): InvoiceLineDto {
  return {
    id: row.id,
    line_no: row.line_no,
    description: row.description,
    quantity: Number(row.quantity),
    unit_price: Number(row.unit_price),
    amount: Number(row.amount),
    tax_category_id: row.tax_category_id,
    account_id: row.account_id,
  };
}

export function mapInvoiceRow(row: InvoiceRow, lines: InvoiceLineDto[]): InvoiceDto {
  return {
    id: row.id,
    invoice_no: row.invoice_no,
    customer_id: row.customer_id,
    issue_date: row.issue_date,
    due_date: row.due_date,
    status: row.status as InvoiceDto['status'],
    subtotal_amount: Number(row.subtotal_amount),
    tax_amount: Number(row.tax_amount),
    total_amount: Number(row.total_amount),
    currency_code: row.currency_code,
    journal_entry_id: row.journal_entry_id,
    issued_at: row.issued_at ? row.issued_at.toISOString() : null,
    lines,
  };
}

export function mapCreditNoteRow(row: CreditNoteRow): CreditNoteDto {
  return {
    id: row.id,
    original_invoice_id: row.original_invoice_id,
    credit_note_no: row.credit_note_no,
    issue_date: row.issue_date,
    amount: Number(row.amount),
    reason: row.reason,
    journal_entry_id: row.journal_entry_id,
  };
}

export function mapInvoicePaymentRow(row: InvoicePaymentRow): InvoicePaymentDto {
  return {
    id: row.id,
    invoice_id: row.invoice_id,
    payment_date: row.payment_date,
    amount: Number(row.amount),
    bank_transaction_id: row.bank_transaction_id,
    journal_entry_id: row.journal_entry_id,
    matched_by: row.matched_by as InvoicePaymentDto['matched_by'],
  };
}

/**
 * `status` は生の格納値ではなく、`issued`/`partially_paid` かつ `due_date` が過去日の場合に
 * `overdue` へ読み替えた「実効ステータス」を返す。本スキーマには期日超過を自動検知する
 * バッチ/スケジューラが存在しないため、永続化はせず読み取り時に都度計算する。
 * 一覧・詳細のフィルタ条件でも同じ式を使用し、一貫性を保つこと。
 */
export const EFFECTIVE_STATUS_EXPR = `
  CASE
    WHEN i.status IN ('issued', 'partially_paid') AND i.due_date < CURRENT_DATE THEN 'overdue'
    ELSE i.status
  END
`;

const INVOICE_COLUMNS = `
  i.id,
  i.invoice_no,
  i.customer_id,
  TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS issue_date,
  TO_CHAR(i.due_date, 'YYYY-MM-DD') AS due_date,
  (${EFFECTIVE_STATUS_EXPR}) AS status,
  i.subtotal_amount,
  i.tax_amount,
  i.total_amount,
  i.currency_code,
  i.journal_entry_id,
  i.issued_at
`;

const INVOICE_LINE_COLUMNS = `
  id,
  invoice_id,
  line_no,
  description,
  quantity,
  unit_price,
  amount,
  tax_category_id,
  account_id
`;

const CREDIT_NOTE_COLUMNS = `
  id,
  original_invoice_id,
  credit_note_no,
  TO_CHAR(issue_date, 'YYYY-MM-DD') AS issue_date,
  amount,
  reason,
  journal_entry_id
`;

const INVOICE_PAYMENT_COLUMNS = `
  id,
  invoice_id,
  TO_CHAR(payment_date, 'YYYY-MM-DD') AS payment_date,
  amount,
  bank_transaction_id,
  journal_entry_id,
  matched_by
`;

export const SQL_COLUMNS = {
  invoice: INVOICE_COLUMNS,
  invoiceLine: INVOICE_LINE_COLUMNS,
  creditNote: CREDIT_NOTE_COLUMNS,
  invoicePayment: INVOICE_PAYMENT_COLUMNS,
};
