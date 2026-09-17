export interface QuotationRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  customer_code?: string;
  customer_name?: string;
  deal_id: string | null;
  quote_no: string;
  title: string;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';
  valid_until: string | null;
  issue_date: string;
  subtotal: string | number;
  tax_amount: string | number;
  total_amount: string | number;
  currency_code: string;
  version: number;
  superseded_by: string | null;
  superseded_by_quote_no?: string | null;
  notes: string | null;
  converted_invoice_id: string | null;
  converted_invoice_no?: string | null;
  converted_at: string | Date | null;
  converted_by: string | null;
  created_by: string;
  creator_name?: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface QuotationLineItemRow {
  id: string;
  tenant_id: string;
  quotation_id: string;
  line_no: number;
  item_name: string;
  description: string | null;
  quantity: string | number;
  unit: string;
  unit_price: string | number;
  amount: string | number;
  tax_rate: string | number;
  tax_category_id: string | null;
  tax_category_name?: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface QuotationLineItemDto {
  id: string;
  quotation_id: string;
  line_no: number;
  item_name: string;
  description: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
  amount: number;
  tax_rate: number;
  tax_category_id: string | null;
  tax_category_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuotationDto {
  id: string;
  tenant_id: string;
  customer_id: string;
  customer_code: string | null;
  customer_name: string | null;
  deal_id: string | null;
  quote_no: string;
  title: string;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';
  valid_until: string | null;
  issue_date: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  currency_code: string;
  version: number;
  superseded_by: string | null;
  superseded_by_quote_no: string | null;
  notes: string | null;
  converted_invoice_id: string | null;
  converted_invoice_no: string | null;
  converted_at: string | null;
  converted_by: string | null;
  created_by: string;
  creator_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuotationDetailDto extends QuotationDto {
  lines: QuotationLineItemDto[];
}

function toIsoString(val: string | Date | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  return new Date(val).toISOString();
}

function toDateString(val: string | Date | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

export function mapQuotationRow(row: QuotationRow): QuotationDto {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    customer_id: row.customer_id,
    customer_code: row.customer_code ?? null,
    customer_name: row.customer_name ?? null,
    deal_id: row.deal_id ?? null,
    quote_no: row.quote_no,
    title: row.title,
    status: row.status,
    valid_until: toDateString(row.valid_until),
    issue_date: toDateString(row.issue_date) ?? new Date().toISOString().slice(0, 10),
    subtotal: Number(row.subtotal),
    tax_amount: Number(row.tax_amount),
    total_amount: Number(row.total_amount),
    currency_code: row.currency_code ?? 'JPY',
    version: Number(row.version),
    superseded_by: row.superseded_by ?? null,
    superseded_by_quote_no: row.superseded_by_quote_no ?? null,
    notes: row.notes ?? null,
    converted_invoice_id: row.converted_invoice_id ?? null,
    converted_invoice_no: row.converted_invoice_no ?? null,
    converted_at: toIsoString(row.converted_at),
    converted_by: row.converted_by ?? null,
    created_by: row.created_by,
    creator_name: row.creator_name ?? null,
    created_at: toIsoString(row.created_at) ?? '',
    updated_at: toIsoString(row.updated_at) ?? '',
  };
}

export function mapQuotationLineItemRow(row: QuotationLineItemRow): QuotationLineItemDto {
  return {
    id: row.id,
    quotation_id: row.quotation_id,
    line_no: Number(row.line_no),
    item_name: row.item_name,
    description: row.description ?? null,
    quantity: Number(row.quantity),
    unit: row.unit ?? '式',
    unit_price: Number(row.unit_price),
    amount: Number(row.amount),
    tax_rate: Number(row.tax_rate),
    tax_category_id: row.tax_category_id ?? null,
    tax_category_name: row.tax_category_name ?? null,
    created_at: toIsoString(row.created_at) ?? '',
    updated_at: toIsoString(row.updated_at) ?? '',
  };
}

export function mapQuotationDetail(row: QuotationRow, lines: QuotationLineItemRow[]): QuotationDetailDto {
  return {
    ...mapQuotationRow(row),
    lines: lines.map(mapQuotationLineItemRow),
  };
}

export const SQL_QUOTATION_COLUMNS = `
  q.id,
  q.tenant_id,
  q.customer_id,
  c.code AS customer_code,
  c.name AS customer_name,
  q.deal_id,
  q.quote_no,
  q.title,
  q.status,
  q.valid_until,
  q.issue_date,
  q.subtotal,
  q.tax_amount,
  q.total_amount,
  q.currency_code,
  q.version,
  q.superseded_by,
  sq.quote_no AS superseded_by_quote_no,
  q.notes,
  q.converted_invoice_id,
  inv.invoice_no AS converted_invoice_no,
  q.converted_at,
  q.converted_by,
  q.created_by,
  u.name AS creator_name,
  q.created_at,
  q.updated_at
`;

export const SQL_QUOTATION_LINE_COLUMNS = `
  ql.id,
  ql.tenant_id,
  ql.quotation_id,
  ql.line_no,
  ql.item_name,
  ql.description,
  ql.quantity,
  ql.unit,
  ql.unit_price,
  ql.amount,
  ql.tax_rate,
  ql.tax_category_id,
  tc.name AS tax_category_name,
  ql.created_at,
  ql.updated_at
`;
