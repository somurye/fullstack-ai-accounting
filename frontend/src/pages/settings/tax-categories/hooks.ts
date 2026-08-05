import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../../lib/apiClient';
import { toast } from '../../../stores/toastStore';
import { createTaxCategory, fetchTaxCategories, updateTaxCategory } from './api';
import type { TaxCategoryFormInput, TaxCategoryListParams } from './types';

const TAX_CATEGORIES_KEY = 'settings-tax-categories';

export function useTaxCategories(params: TaxCategoryListParams) {
  return useQuery({
    queryKey: [TAX_CATEGORIES_KEY, 'list', params],
    queryFn: () => fetchTaxCategories(params),
  });
}

export function useCreateTaxCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: TaxCategoryFormInput) => createTaxCategory(dto),
    onSuccess: (taxCategory) => {
      queryClient.invalidateQueries({ queryKey: [TAX_CATEGORIES_KEY] });
      toast.success(`税区分「${taxCategory.name}」を作成しました`);
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}

export function useUpdateTaxCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: TaxCategoryFormInput }) => updateTaxCategory(id, dto),
    onSuccess: (taxCategory) => {
      queryClient.invalidateQueries({ queryKey: [TAX_CATEGORIES_KEY] });
      toast.success(`税区分「${taxCategory.name}」を更新しました`);
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}
