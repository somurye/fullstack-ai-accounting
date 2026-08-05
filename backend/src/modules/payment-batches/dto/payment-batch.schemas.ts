import { z } from 'zod';

/**
 * payment-batches モジュールのリクエストバリデーションスキーマ。
 * `docs/openapi.yaml` の `/payment-batches/export-zengin` リクエストボディに対応する。
 */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const PAYMENT_BATCH_STATUSES = ['draft', 'exported', 'completed', 'cancelled'] as const;

export const PAYMENT_BATCH_SOURCE_TYPES = ['vendor_bill', 'expense_reimbursement', 'payroll'] as const;

export const paymentBatchListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(PAYMENT_BATCH_STATUSES).optional(),
});
export type PaymentBatchListQuery = z.infer<typeof paymentBatchListQuerySchema>;

export const exportZenginSourceSchema = z.object({
  source_type: z.enum(PAYMENT_BATCH_SOURCE_TYPES),
  source_id: z.string().uuid(),
});

export const exportZenginSchema = z.object({
  payment_date: z.string().regex(DATE_ONLY_RE, 'payment_date is YYYY-MM-DD形式で指定してください'),
  sources: z.array(exportZenginSourceSchema).min(1, '振込対象を1件以上指定してください'),
});
export type ExportZenginInput = z.infer<typeof exportZenginSchema>;
