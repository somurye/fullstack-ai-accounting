export interface SupplierDto {
  id: string;
  tenant_id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  payment_terms: string | null;
  status: 'active' | 'inactive';
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SupplierRow {
  id: string;
  tenant_id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  payment_terms: string | null;
  status: 'active' | 'inactive';
  created_by: string;
  created_at: string | Date;
  updated_at: string | Date;
}

export const SUPPLIER_COLUMNS = `
  s.id,
  s.tenant_id,
  s.name,
  s.contact_name,
  s.contact_email,
  s.contact_phone,
  s.payment_terms,
  s.status,
  s.created_by,
  s.created_at,
  s.updated_at
`;

export function mapSupplierRow(row: SupplierRow): SupplierDto {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    contact_name: row.contact_name,
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
    payment_terms: row.payment_terms,
    status: row.status,
    created_by: row.created_by,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}
