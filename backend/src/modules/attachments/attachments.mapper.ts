import type { components } from '../../types/api.generated';
import type { DocumentCategory } from './dto/attachment.schemas';

export type AttachmentDto = components['schemas']['Attachment'];

export interface AttachmentRow {
  id: string;
  file_name: string;
  storage_path: string;
  mime_type: string;
  file_hash: string;
  document_category: DocumentCategory;
  transaction_date: string | null;
  amount: string | null;
  counterparty_name: string | null;
  uploaded_by: string;
  uploaded_at: Date;
}

export function mapAttachmentRow(row: AttachmentRow): AttachmentDto {
  return {
    id: row.id,
    file_name: row.file_name,
    storage_path: row.storage_path,
    mime_type: row.mime_type,
    file_hash: row.file_hash,
    document_category: row.document_category,
    transaction_date: row.transaction_date ?? undefined,
    amount: row.amount !== null ? Number(row.amount) : undefined,
    counterparty_name: row.counterparty_name ?? undefined,
    uploaded_by: row.uploaded_by,
    uploaded_at: row.uploaded_at.toISOString(),
  };
}

export const ATTACHMENT_COLUMNS = `
  id,
  file_name,
  storage_path,
  mime_type,
  file_hash,
  document_category,
  TO_CHAR(transaction_date, 'YYYY-MM-DD') AS transaction_date,
  amount,
  counterparty_name,
  uploaded_by,
  uploaded_at
`;
