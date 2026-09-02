import type { components } from '../../types/api.generated';

export type Attachment = components['schemas']['Attachment'];

export const DOCUMENT_CATEGORIES = [
  'receipt',
  'invoice',
  'contract',
  'purchase_order',
  'other',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  receipt: 'レシート・領収書',
  invoice: '請求書',
  contract: '契約書',
  purchase_order: '発注書',
  other: 'その他',
};

export interface AttachmentListParams {
  page?: number;
  page_size?: number;
  document_category?: DocumentCategory;
  transaction_date_from?: string;
  transaction_date_to?: string;
  amount?: number;
  counterparty_name?: string;
}

export interface AttachmentUploadParams {
  file: File;
  document_category?: DocumentCategory;
  transaction_date?: string;
  amount?: number;
  counterparty_name?: string;
}

export const ATTACHMENT_LINKABLE_TYPES = [
  'journal_entry',
  'expense_report_line',
  'invoice',
  'vendor_bill',
  'fixed_asset',
] as const;
export type AttachmentLinkableType = (typeof ATTACHMENT_LINKABLE_TYPES)[number];
