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
  supplier_id: string | null;
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

export interface PurchaseReceiptDto {
  id: string;
  tenant_id: string;
  purchase_request_id: string;
  received_quantity: number;
  received_date: string;
  notes: string | null;
  received_by: string;
  received_by_name?: string;
  created_at: string;
}

export interface LinkedVendorBillDto {
  id: string;
  bill_no: string;
  vendor_id: string;
  bill_date: string;
  due_date: string;
  status: string;
  total_amount: number;
}

export interface PurchaseRequestDetailDto extends PurchaseRequestDto {
  attachment: PurchaseRequestAttachmentDto | null;
  approval_history: PurchaseRequestApprovalHistoryEntryDto[];
  receipts: PurchaseReceiptDto[];
  total_received_quantity: number;
  remaining_quantity: number;
  linked_vendor_bills: LinkedVendorBillDto[];
}

export interface PurchaseRequestRow {
  id: string;
  tenant_id: string;
  request_no: string;
  title: string;
  supplier_id: string | null;
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

export function getSqlPurchaseRequestColumns(hasSupplierId: boolean = true): string {
  return `
  pr.id,
  pr.tenant_id,
  pr.request_no,
  pr.title,
  ${hasSupplierId ? 'pr.supplier_id' : 'NULL::uuid AS supplier_id'},
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
}

export const SQL_PURCHASE_REQUEST_COLUMNS = getSqlPurchaseRequestColumns(true);

export function mapPurchaseRequestRow(row: PurchaseRequestRow): PurchaseRequestDto {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    request_no: row.request_no,
    title: row.title,
    supplier_id: row.supplier_id,
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

export interface PurchaseReceiptRow {
  id: string;
  tenant_id: string;
  purchase_request_id: string;
  received_quantity: string | number;
  received_date: string;
  notes: string | null;
  received_by: string;
  received_by_name?: string;
  created_at: Date | string;
}

export function mapPurchaseReceiptRow(row: PurchaseReceiptRow): PurchaseReceiptDto {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    purchase_request_id: row.purchase_request_id,
    received_quantity: Number(row.received_quantity),
    received_date: typeof row.received_date === 'string' ? row.received_date.slice(0, 10) : String(row.received_date),
    notes: row.notes,
    received_by: row.received_by,
    received_by_name: row.received_by_name,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}
