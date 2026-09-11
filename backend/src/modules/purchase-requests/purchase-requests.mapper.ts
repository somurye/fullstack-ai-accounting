import type { PurchaseRequestStatus } from './dto/purchase-request.schemas';

export interface PurchaseRequestAttachmentDto {
  id: string;
  file_name: string;
  mime_type: string;
  file_size: number;
}

export interface PurchaseRequestApprovalHistoryEntryDto {
  id: string;
  step_number: number;
  approver_id: string;
  approver_name?: string;
  action: 'approve' | 'reject';
  comment: string | null;
  acted_at: string;
}

export interface PurchaseRequestDto {
  id: string;
  tenant_id: string;
  request_no: string;
  title: string;
  supplier_name: string;
  item_description: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  currency: string;
  requested_delivery_date: string | null;
  status: PurchaseRequestStatus;
  attachment_id: string | null;
  description: string | null;
  approved_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PurchaseRequestDetailDto extends PurchaseRequestDto {
  attachment: PurchaseRequestAttachmentDto | null;
  approval_history: PurchaseRequestApprovalHistoryEntryDto[];
}

export interface PurchaseRequestRow {
  id: string;
  tenant_id: string;
  request_no: string;
  title: string;
  supplier_name: string;
  item_description: string;
  quantity: string | number;
  unit_price: string | number;
  total_amount: string | number;
  currency: string;
  requested_delivery_date: string | null;
  status: PurchaseRequestStatus;
  attachment_id: string | null;
  description: string | null;
  approved_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export const SQL_PURCHASE_REQUEST_COLUMNS = `
  pr.id,
  pr.tenant_id,
  pr.request_no,
  pr.title,
  pr.supplier_name,
  pr.item_description,
  pr.quantity,
  pr.unit_price,
  pr.total_amount,
  pr.currency,
  pr.requested_delivery_date::text,
  pr.status,
  pr.attachment_id,
  pr.description,
  pr.approved_at,
  pr.created_by,
  pr.created_at,
  pr.updated_at
`;

export function mapPurchaseRequestRow(row: PurchaseRequestRow): PurchaseRequestDto {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    request_no: row.request_no,
    title: row.title,
    supplier_name: row.supplier_name,
    item_description: row.item_description,
    quantity: Number(row.quantity),
    unit_price: Number(row.unit_price),
    total_amount: Number(row.total_amount),
    currency: row.currency,
    requested_delivery_date: row.requested_delivery_date,
    status: row.status,
    attachment_id: row.attachment_id,
    description: row.description,
    approved_at: row.approved_at ? row.approved_at.toISOString() : null,
    created_by: row.created_by,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}
