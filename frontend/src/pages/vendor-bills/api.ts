import { apiClient } from '../../lib/apiClient';
import type { components } from '../../types/api.generated';
import type {
  Vendor,
  VendorBill,
  VendorBillCreate,
  VendorBillDetail,
  VendorBillListParams,
  VendorBillPayment,
} from './types';

type Meta = components['schemas']['Meta'];

export interface VendorBillListResult {
  vendorBills: VendorBill[];
  meta: Meta | undefined;
}

export async function fetchVendorBills(params: VendorBillListParams): Promise<VendorBillListResult> {
  const { data } = await apiClient.get<{ success: true; data: VendorBill[]; meta?: Meta }>(
    '/vendor-bills',
    { params },
  );
  return { vendorBills: data.data ?? [], meta: data.meta };
}

export async function fetchVendorBill(id: string): Promise<VendorBillDetail> {
  const { data } = await apiClient.get<{ success: true; data: VendorBillDetail; meta?: Meta }>(
    `/vendor-bills/${id}`,
  );
  if (!data.data) throw new Error('仕入請求書データを取得できませんでした');
  return data.data;
}

export async function createVendorBill(payload: VendorBillCreate): Promise<VendorBillDetail> {
  const { data } = await apiClient.post<{ success: true; data: VendorBillDetail; meta?: Meta }>(
    '/vendor-bills',
    payload,
  );
  if (!data.data) throw new Error('仕入請求書の作成に失敗しました');
  return data.data;
}

export async function submitVendorBill(id: string): Promise<VendorBillDetail> {
  const { data } = await apiClient.post<{ success: true; data: VendorBillDetail; meta?: Meta }>(
    `/vendor-bills/${id}/submit`,
  );
  if (!data.data) throw new Error('仕入請求書の提出に失敗しました');
  return data.data;
}

export async function recordVendorBillPayment(
  id: string,
  payload: { payment_date: string; amount: number; bank_transaction_id?: string },
): Promise<VendorBillPayment> {
  const { data } = await apiClient.post<{ success: true; data: VendorBillPayment; meta?: Meta }>(
    `/vendor-bills/${id}/payments`,
    payload,
  );
  if (!data.data) throw new Error('支払消込の登録に失敗しました');
  return data.data;
}

export async function fetchVendors(): Promise<Vendor[]> {
  const { data } = await apiClient.get<components['schemas']['VendorListResponse']>('/vendors', {
    params: { page_size: 200 },
  });
  return data.data ?? [];
}
