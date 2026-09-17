export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';

export interface QuotationLineItem {
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

export interface Quotation {
  id: string;
  tenant_id: string;
  customer_id: string;
  customer_code: string | null;
  customer_name: string | null;
  deal_id: string | null;
  quote_no: string;
  title: string;
  status: QuotationStatus;
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

export interface QuotationDetail extends Quotation {
  lines: QuotationLineItem[];
}

export interface QuotationLineItemFormInput {
  item_name: string;
  description?: string | null;
  quantity: number;
  unit: string;
  unit_price: number;
  tax_rate: number;
  tax_category_id?: string | null;
}

export interface QuotationFormInput {
  customer_id: string;
  deal_id?: string | null;
  title: string;
  issue_date?: string;
  valid_until?: string | null;
  notes?: string | null;
  lines: QuotationLineItemFormInput[];
}

export const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  draft: '下書き',
  sent: '提示・確定送付済',
  accepted: '受注確定',
  rejected: '失注・却下',
  expired: '有効期限切れ',
};

export const QUOTATION_STATUS_COLORS: Record<QuotationStatus, { bg: string; text: string; border: string }> = {
  draft: { bg: 'bg-surface-800', text: 'text-surface-300', border: 'border-surface-700' },
  sent: { bg: 'bg-sky-950/60', text: 'text-sky-400', border: 'border-sky-800' },
  accepted: { bg: 'bg-emerald-950/60', text: 'text-emerald-400', border: 'border-emerald-800' },
  rejected: { bg: 'bg-rose-950/60', text: 'text-rose-400', border: 'border-rose-800' },
  expired: { bg: 'bg-amber-950/60', text: 'text-amber-400', border: 'border-amber-800' },
};
