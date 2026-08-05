import { apiClient } from '../../lib/apiClient';
import type { components } from '../../types/api.generated';
import type { Customer, CustomerFormInput, CustomerListParams } from './types';

type Meta = components['schemas']['Meta'];

export interface CustomerListResult {
  customers: Customer[];
  meta: Meta | undefined;
}

export async function fetchCustomers(params: CustomerListParams): Promise<CustomerListResult> {
  const { data } = await apiClient.get<{ success: true; data: Customer[]; meta?: Meta }>('/customers', {
    params,
  });
  return { customers: data.data ?? [], meta: data.meta };
}

export async function createCustomer(dto: CustomerFormInput): Promise<Customer> {
  const { data } = await apiClient.post<{ success: true; data: Customer }>('/customers', dto);
  if (!data.data) throw new Error('顧客の作成に失敗しました');
  return data.data;
}

export async function updateCustomer(id: string, dto: CustomerFormInput): Promise<Customer> {
  const { data } = await apiClient.patch<{ success: true; data: Customer }>(`/customers/${id}`, dto);
  if (!data.data) throw new Error('顧客の更新に失敗しました');
  return data.data;
}
