import { apiClient } from '../../lib/apiClient';
import type { components } from '../../types/api.generated';
import type {
  Customer,
  CreditNote,
  Invoice,
  InvoiceCreate,
  InvoiceDetail,
  InvoiceListParams,
  InvoicePayment,
} from './types';

type Meta = components['schemas']['Meta'];

export interface InvoiceListResult {
  invoices: Invoice[];
  meta: Meta | undefined;
}

export async function fetchInvoices(params: InvoiceListParams): Promise<InvoiceListResult> {
  const { data } = await apiClient.get<{ success: true; data: Invoice[]; meta?: Meta }>('/invoices', {
    params,
  });
  return { invoices: data.data ?? [], meta: data.meta };
}

export async function fetchInvoice(id: string): Promise<InvoiceDetail> {
  const { data } = await apiClient.get<{ success: true; data: InvoiceDetail; meta?: Meta }>(
    `/invoices/${id}`,
  );
  if (!data.data) throw new Error('請求書データを取得できませんでした');
  return data.data;
}

export async function createInvoice(payload: InvoiceCreate): Promise<InvoiceDetail> {
  const { data } = await apiClient.post<{ success: true; data: InvoiceDetail; meta?: Meta }>(
    '/invoices',
    payload,
  );
  if (!data.data) throw new Error('請求書の作成に失敗しました');
  return data.data;
}

export async function updateInvoice(id: string, payload: InvoiceCreate): Promise<InvoiceDetail> {
  const { data } = await apiClient.patch<{ success: true; data: InvoiceDetail; meta?: Meta }>(
    `/invoices/${id}`,
    payload,
  );
  if (!data.data) throw new Error('請求書の更新に失敗しました');
  return data.data;
}

export async function issueInvoice(id: string): Promise<InvoiceDetail> {
  const { data } = await apiClient.post<{ success: true; data: InvoiceDetail; meta?: Meta }>(
    `/invoices/${id}/issue`,
  );
  if (!data.data) throw new Error('請求書の発行に失敗しました');
  return data.data;
}

export async function voidInvoice(id: string): Promise<InvoiceDetail> {
  const { data } = await apiClient.post<{ success: true; data: InvoiceDetail; meta?: Meta }>(
    `/invoices/${id}/void`,
  );
  if (!data.data) throw new Error('請求書の取消に失敗しました');
  return data.data;
}

export async function recordInvoicePayment(
  id: string,
  payload: { payment_date: string; amount: number; bank_transaction_id?: string },
): Promise<InvoicePayment> {
  const { data } = await apiClient.post<{ success: true; data: InvoicePayment; meta?: Meta }>(
    `/invoices/${id}/payments`,
    payload,
  );
  if (!data.data) throw new Error('入金消込の登録に失敗しました');
  return data.data;
}

export async function createCreditNote(
  id: string,
  payload: { amount: number; reason: string },
): Promise<CreditNote> {
  const { data } = await apiClient.post<{ success: true; data: CreditNote; meta?: Meta }>(
    `/invoices/${id}/credit-notes`,
    payload,
  );
  if (!data.data) throw new Error('クレジットノートの作成に失敗しました');
  return data.data;
}

export async function fetchCustomers(): Promise<Customer[]> {
  const { data } = await apiClient.get<components['schemas']['CustomerListResponse']>('/customers', {
    params: { page_size: 200 },
  });
  return data.data ?? [];
}
