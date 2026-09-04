import type { components } from '../../types/api.generated';

export type GeneralRequestDto = components['schemas']['GeneralRequest'];

export interface GeneralRequestRow {
  id: string;
  tenant_id: string;
  request_no: string;
  title: string;
  description: string;
  category: string;
  amount: string | null;
  attachment_id: string | null;
  status: 'draft' | 'pending_approval' | 'active' | 'rejected';
  created_by: string;
  approved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export const SQL_GENERAL_REQUEST_COLUMNS = `
  gr.id,
  gr.tenant_id,
  gr.request_no,
  gr.title,
  gr.description,
  gr.category,
  gr.amount,
  gr.attachment_id,
  gr.status,
  gr.created_by,
  gr.approved_at,
  gr.created_at,
  gr.updated_at
`;

export function mapGeneralRequestRow(row: GeneralRequestRow): GeneralRequestDto {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    request_no: row.request_no,
    title: row.title,
    description: row.description,
    category: row.category,
    amount: row.amount !== null && row.amount !== undefined ? Number(row.amount) : null,
    attachment_id: row.attachment_id,
    status: row.status,
    created_by: row.created_by,
    approved_at: row.approved_at ? row.approved_at.toISOString() : null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}
