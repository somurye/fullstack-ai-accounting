import type { components } from '../../types/api.generated';

export type Attachment = components['schemas']['Attachment'];

export interface AttachmentListParams {
  page?: number;
  page_size?: number;
  transaction_date_from?: string;
  transaction_date_to?: string;
  amount?: number;
  counterparty_name?: string;
}

export interface AttachmentUploadParams {
  file: File;
  transaction_date: string;
  amount: number;
  counterparty_name: string;
}

export const ATTACHMENT_LINKABLE_TYPES = [
  'journal_entry',
  'expense_report_line',
  'invoice',
  'vendor_bill',
  'fixed_asset',
] as const;
export type AttachmentLinkableType = (typeof ATTACHMENT_LINKABLE_TYPES)[number];
