import { apiClient } from '../../lib/apiClient';
import type { components } from '../../types/api.generated';
import type {
  Quotation,
  QuotationDetail,
  QuotationFormInput,
  QuotationStatus,
} from './types';

type Meta = components['schemas']['Meta'];

export interface QuotationListParams {
  page?: number;
  limit?: number;
  status?: QuotationStatus | '';
  customer_id?: string;
  search?: string;
  from_date?: string;
  to_date?: string;
}

export interface QuotationsListResponse {
  quotations: Quotation[];
  pagination: {
    page: number;
    page_size: number;
    total_count: number;
    total_pages: number;
  };
}

export interface CustomerSummary {
  id: string;
  code: string;
  name: string;
  kana_name?: string | null;
}

export async function fetchQuotations(params: QuotationListParams): Promise<QuotationsListResponse> {
  const { data } = await apiClient.get<{ success: true; data: Quotation[]; meta?: Meta }>('/quotations', {
    params,
  });
  return {
    quotations: data.data ?? [],
    pagination: (data.meta?.pagination as QuotationsListResponse['pagination']) ?? {
      page: 1,
      page_size: 20,
      total_count: (data.data ?? []).length,
      total_pages: 1,
    },
  };
}

export async function fetchQuotation(id: string): Promise<QuotationDetail> {
  const { data } = await apiClient.get<{ success: true; data: QuotationDetail; meta?: Meta }>(
    `/quotations/${id}`,
  );
  if (!data.data) throw new Error('見積書データを取得できませんでした');
  return data.data;
}

export async function createQuotation(payload: QuotationFormInput): Promise<QuotationDetail> {
  const { data } = await apiClient.post<{ success: true; data: QuotationDetail; meta?: Meta }>(
    '/quotations',
    payload,
  );
  if (!data.data) throw new Error('見積書の作成に失敗しました');
  return data.data;
}

export async function updateQuotation(
  id: string,
  payload: Partial<QuotationFormInput>,
): Promise<QuotationDetail> {
  const { data } = await apiClient.patch<{ success: true; data: QuotationDetail; meta?: Meta }>(
    `/quotations/${id}`,
    payload,
  );
  if (!data.data) throw new Error('見積書の更新に失敗しました');
  return data.data;
}

export async function deleteQuotation(id: string): Promise<void> {
  await apiClient.delete(`/quotations/${id}`);
}

export async function sendQuotation(id: string): Promise<QuotationDetail> {
  const { data } = await apiClient.post<{ success: true; data: QuotationDetail; meta?: Meta }>(
    `/quotations/${id}/send`,
  );
  if (!data.data) throw new Error('見積書の確定送付に失敗しました');
  return data.data;
}

export async function acceptQuotation(id: string): Promise<QuotationDetail> {
  const { data } = await apiClient.post<{ success: true; data: QuotationDetail; meta?: Meta }>(
    `/quotations/${id}/accept`,
  );
  if (!data.data) throw new Error('見積書の受注確定に失敗しました');
  return data.data;
}

export async function rejectQuotation(id: string): Promise<QuotationDetail> {
  const { data } = await apiClient.post<{ success: true; data: QuotationDetail; meta?: Meta }>(
    `/quotations/${id}/reject`,
  );
  if (!data.data) throw new Error('見積書の却下処理に失敗しました');
  return data.data;
}

export async function reviseQuotation(id: string, notes?: string | null): Promise<QuotationDetail> {
  const { data } = await apiClient.post<{ success: true; data: QuotationDetail; meta?: Meta }>(
    `/quotations/${id}/revise`,
    { notes },
  );
  if (!data.data) throw new Error('改訂版見積書の発行に失敗しました');
  return data.data;
}

export async function convertQuotation(
  id: string,
): Promise<{ quotation: QuotationDetail; invoiceId: string; invoiceNo: string }> {
  const { data } = await apiClient.post<{
    success: true;
    data: { quotation: QuotationDetail; invoiceId: string; invoiceNo: string };
    meta?: Meta;
  }>(`/quotations/${id}/convert`);
  if (!data.data) throw new Error('受注転換に失敗しました');
  return data.data;
}

export async function fetchCustomers(): Promise<CustomerSummary[]> {
  const { data } = await apiClient.get<{ success: true; data: CustomerSummary[]; meta?: Meta }>('/customers');
  return data.data ?? [];
}

export async function downloadQuotationPdf(id: string, filename?: string): Promise<void> {
  const res = await apiClient.get(`/quotations/${id}/pdf`, {
    responseType: 'blob',
  });
  const blob = new Blob([res.data], { type: 'application/pdf' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || `quotation_${id.slice(0, 8)}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}
