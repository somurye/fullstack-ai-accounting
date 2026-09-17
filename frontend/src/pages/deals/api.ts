import { apiClient } from '../../lib/apiClient';
import type { components } from '../../types/api.generated';
import type {
  Deal,
  DealFormInput,
  CloseDealInput,
  DealStage,
} from './types';

type Meta = components['schemas']['Meta'];

export interface DealListParams {
  page?: number;
  limit?: number;
  stage?: DealStage | '';
  customer_id?: string;
  owner_user_id?: string;
  search?: string;
}

export interface DealsListResponse {
  deals: Deal[];
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

export interface UserSummary {
  id: string;
  display_name: string;
  email: string;
}

export async function fetchDeals(params: DealListParams): Promise<DealsListResponse> {
  const { data } = await apiClient.get<{ success: true; data: Deal[]; meta?: Meta }>('/deals', {
    params,
  });
  return {
    deals: data.data ?? [],
    pagination: (data.meta?.pagination as DealsListResponse['pagination']) ?? {
      page: 1,
      page_size: 20,
      total_count: (data.data ?? []).length,
      total_pages: 1,
    },
  };
}

export async function fetchDeal(id: string): Promise<Deal> {
  const { data } = await apiClient.get<{ success: true; data: Deal; meta?: Meta }>(
    `/deals/${id}`,
  );
  if (!data.data) throw new Error('案件データを取得できませんでした');
  return data.data;
}

export async function createDeal(input: DealFormInput): Promise<Deal> {
  const { data } = await apiClient.post<{ success: true; data: Deal }>('/deals', input);
  return data.data;
}

export async function updateDeal(id: string, input: Partial<DealFormInput>): Promise<Deal> {
  const { data } = await apiClient.patch<{ success: true; data: Deal }>(`/deals/${id}`, input);
  return data.data;
}

export async function closeDeal(id: string, input: CloseDealInput): Promise<Deal> {
  const { data } = await apiClient.post<{ success: true; data: Deal }>(`/deals/${id}/close`, input);
  return data.data;
}

export async function deleteDeal(id: string): Promise<{ success: boolean; id: string }> {
  const { data } = await apiClient.delete<{ success: true; data: { success: boolean; id: string } }>(
    `/deals/${id}`,
  );
  return data.data;
}

export async function fetchCustomers(): Promise<CustomerSummary[]> {
  try {
    const { data } = await apiClient.get<{ success: true; data: CustomerSummary[] }>('/customers', {
      params: { limit: 100 },
    });
    return data.data ?? [];
  } catch {
    return [];
  }
}

export async function fetchUsers(): Promise<UserSummary[]> {
  try {
    const { data } = await apiClient.get<{ success: true; data: UserSummary[] }>('/users', {
      params: { limit: 100 },
    });
    return data.data ?? [];
  } catch {
    return [];
  }
}
