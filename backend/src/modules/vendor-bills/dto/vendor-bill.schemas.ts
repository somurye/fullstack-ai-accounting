import { z } from 'zod';

/**
 * vendor-bills モジュールのリクエストバリデーションスキーマ。
 * `docs/openapi.yaml` の `VendorBillCreate` / `VendorBillLineCreate` 等に対応する。
 */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const VENDOR_BILL_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'scheduled_for_payment',
  'paid',
] as const;

export const PAYMENT_METHODS = ['cash', 'corporate_card', 'bank_transfer', 'employee_advance'] as const;

export const vendorBillLineCreateSchema = z.object({
  description: z.string().min(1),
  amount: z.number().positive(),
  tax_category_id: z.string().uuid(),
  account_id: z.string().uuid(),
  department_id: z.string().uuid().optional(),
});
export type VendorBillLineCreateInput = z.infer<typeof vendorBillLineCreateSchema>;

export const vendorBillCreateSchema = z
  .object({
    vendor_id: z.string().uuid(),
    bill_date: z.string().regex(DATE_ONLY_RE, 'bill_date is YYYY-MM-DD形式で指定してください'),
    due_date: z.string().regex(DATE_ONLY_RE, 'due_date is YYYY-MM-DD形式で指定してください'),
    payment_method: z.enum(PAYMENT_METHODS).default('bank_transfer'),
    lines: z.array(vendorBillLineCreateSchema).min(1, '仕入請求書明細は1行以上必要です'),
  })
  .refine((v) => v.due_date >= v.bill_date, {
    message: 'due_dateはbill_date以降の日付を指定してください',
    path: ['due_date'],
  });
export type VendorBillCreateInput = z.infer<typeof vendorBillCreateSchema>;

export const vendorBillListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(VENDOR_BILL_STATUSES).optional(),
  vendor_id: z.string().uuid().optional(),
  due_date_from: z.string().regex(DATE_ONLY_RE).optional(),
  due_date_to: z.string().regex(DATE_ONLY_RE).optional(),
});
export type VendorBillListQuery = z.infer<typeof vendorBillListQuerySchema>;

export const vendorBillPaymentCreateSchema = z.object({
  payment_date: z.string().regex(DATE_ONLY_RE, 'payment_date is YYYY-MM-DD形式で指定してください'),
  amount: z.number().positive(),
  bank_transaction_id: z.string().uuid().optional(),
});
export type VendorBillPaymentCreateInput = z.infer<typeof vendorBillPaymentCreateSchema>;
