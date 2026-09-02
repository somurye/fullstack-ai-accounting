import { z } from 'zod';

/**
 * attachments モジュールのリクエストバリデーションスキーマ。
 * `docs/openapi.yaml` の `Attachment` 系エンドポイントに対応する。
 *
 * アップロード(`POST /attachments`)は `multipart/form-data` のため、
 * `transaction_date`/`amount`/`counterparty_name` は文字列フィールドとして
 * 届く。`z.coerce` で数値へ変換する。
 */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const ATTACHMENT_DOCUMENT_CATEGORIES = [
  'receipt',
  'invoice',
  'contract',
  'purchase_order',
  'other',
] as const;
export type DocumentCategory = (typeof ATTACHMENT_DOCUMENT_CATEGORIES)[number];

export const attachmentUploadSchema = z.object({
  document_category: z.enum(ATTACHMENT_DOCUMENT_CATEGORIES).default('receipt'),
  transaction_date: z.string().regex(DATE_ONLY_RE, 'transaction_dateはYYYY-MM-DD形式で指定してください').optional(),
  amount: z.coerce.number().optional(),
  counterparty_name: z.string().min(1, 'counterparty_nameを指定してください').optional(),
});
export type AttachmentUploadInput = z.infer<typeof attachmentUploadSchema>;

export const attachmentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  document_category: z.enum(ATTACHMENT_DOCUMENT_CATEGORIES).optional(),
  transaction_date_from: z.string().regex(DATE_ONLY_RE).optional(),
  transaction_date_to: z.string().regex(DATE_ONLY_RE).optional(),
  amount: z.coerce.number().optional(),
  counterparty_name: z.string().optional(),
});
export type AttachmentListQuery = z.infer<typeof attachmentListQuerySchema>;

export const ATTACHMENT_LINKABLE_TYPES = [
  'journal_entry',
  'expense_report_line',
  'invoice',
  'vendor_bill',
  'fixed_asset',
] as const;

export const attachmentLinkCreateSchema = z.object({
  linkable_type: z.enum(ATTACHMENT_LINKABLE_TYPES),
  linkable_id: z.string().uuid(),
});
export type AttachmentLinkCreateInput = z.infer<typeof attachmentLinkCreateSchema>;
