import { apiClient } from '../../lib/apiClient';
import type { components } from '../../types/api.generated';
import type { Vendor, VendorFormInput, VendorListParams } from './types';

type Meta = components['schemas']['Meta'];

export interface VendorListResult {
  vendors: Vendor[];
  meta: Meta | undefined;
}

export async function fetchVendors(params: VendorListParams): Promise<VendorListResult> {
  const { data } = await apiClient.get<{ success: true; data: Vendor[]; meta?: Meta }>('/vendors', {
    params,
  });
  return { vendors: data.data ?? [], meta: data.meta };
}

export async function createVendor(dto: VendorFormInput): Promise<Vendor> {
  const { data } = await apiClient.post<{ success: true; data: Vendor }>('/vendors', dto);
  if (!data.data) throw new Error('仕入先の作成に失敗しました');
  return data.data;
}

export async function updateVendor(id: string, dto: VendorFormInput): Promise<Vendor> {
  const { data } = await apiClient.patch<{ success: true; data: Vendor }>(`/vendors/${id}`, dto);
  if (!data.data) throw new Error('仕入先の更新に失敗しました');
  return data.data;
}
