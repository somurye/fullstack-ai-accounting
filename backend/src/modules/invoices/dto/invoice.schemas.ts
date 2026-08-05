import { z } from 'zod';

/**
 * invoices モジュールのリクエストバリデーションスキーマ。
 * `docs/openapi.yaml` の `InvoiceCreate` / `InvoiceLineCreate` 等に対応する。
 */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const INVOICE_STATUSES = [
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'overdue',
  'voided',
  'credit_note_issued',
] as const;

export const invoiceLineCreateSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive().default(1),
  unit_price: z.number().positive(),
  tax_category_id: z.string().uuid(),
  account_id: z.string().uuid(),
});
export type InvoiceLineCreateInput = z.infer<typeof invoiceLineCreateSchema>;

export const invoiceCreateSchema = z
  .object({
    customer_id: z.string().uuid(),
    issue_date: z.string().regex(DATE_ONLY_RE, 'issue_date is YYYY-MM-DD形式で指定してください'),
    due_date: z.string().regex(DATE_ONLY_RE, 'due_date is YYYY-MM-DD形式で指定してください'),
    currency_code: z.string().length(3).default('JPY'),
    lines: z.array(invoiceLineCreateSchema).min(1, '請求書明細は1行以上必要です'),
  })
  .refine((v) => v.due_date >= v.issue_date, {
    message: 'due_dateはissue_date以降の日付を指定してください',
    path: ['due_date'],
  });
export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>;

export const invoiceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(INVOICE_STATUSES).optional(),
  customer_id: z.string().uuid().optional(),
  due_date_from: z.string().regex(DATE_ONLY_RE).optional(),
  due_date_to: z.string().regex(DATE_ONLY_RE).optional(),
});
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

export const invoicePaymentCreateSchema = z.object({
  payment_date: z.string().regex(DATE_ONLY_RE, 'payment_date is YYYY-MM-DD形式で指定してください'),
  amount: z.number().positive(),
  bank_transaction_id: z.string().uuid().optional(),
});
export type InvoicePaymentCreateInput = z.infer<typeof invoicePaymentCreateSchema>;

export const creditNoteCreateSchema = z.object({
  amount: z.number().positive(),
  reason: z.string().min(1, '訂正理由(reason)を入力してください'),
});
export type CreditNoteCreateInput = z.infer<typeof creditNoteCreateSchema>;
