import { apiClient } from '../../../lib/apiClient';
import type { components } from '../../../types/api.generated';
import type { TaxCategory, TaxCategoryFormInput, TaxCategoryListParams } from './types';

type Meta = components['schemas']['Meta'];

export interface TaxCategoryListResult {
  taxCategories: TaxCategory[];
  meta: Meta | undefined;
}

export async function fetchTaxCategories(params: TaxCategoryListParams): Promise<TaxCategoryListResult> {
  const { data } = await apiClient.get<{ success: true; data: TaxCategory[]; meta?: Meta }>(
    '/tax-categories',
    { params },
  );
  return { taxCategories: data.data ?? [], meta: data.meta };
}

export async function createTaxCategory(dto: TaxCategoryFormInput): Promise<TaxCategory> {
  const { data } = await apiClient.post<{ success: true; data: TaxCategory }>('/tax-categories', dto);
  if (!data.data) throw new Error('税区分の作成に失敗しました');
  return data.data;
}

export async function updateTaxCategory(id: string, dto: TaxCategoryFormInput): Promise<TaxCategory> {
  const { data } = await apiClient.patch<{ success: true; data: TaxCategory }>(
    `/tax-categories/${id}`,
    dto,
  );
  if (!data.data) throw new Error('税区分の更新に失敗しました');
  return data.data;
}
