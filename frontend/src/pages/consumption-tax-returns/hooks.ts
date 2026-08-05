import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import {
  createConsumptionTaxReturn,
  fetchConsumptionTaxReturn,
  fetchConsumptionTaxReturns,
  finalizeConsumptionTaxReturn,
  recalculateConsumptionTaxReturn,
} from './api';
import type { ConsumptionTaxReturnListParams, TaxFilingMethod } from './types';

const KEY = 'consumption-tax-returns';

export function useConsumptionTaxReturns(params: ConsumptionTaxReturnListParams) {
  return useQuery({
    queryKey: [KEY, 'list', params],
    queryFn: () => fetchConsumptionTaxReturns(params),
  });
}

export function useConsumptionTaxReturn(id: string | undefined) {
  return useQuery({
    queryKey: [KEY, 'detail', id],
    queryFn: () => fetchConsumptionTaxReturn(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateConsumptionTaxReturn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { fiscal_year_id: string; filing_method: TaxFilingMethod }) =>
      createConsumptionTaxReturn(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY, 'list'] });
      toast.success('消費税申告データを計算・作成しました');
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useRecalculateConsumptionTaxReturn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => recalculateConsumptionTaxReturn(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY] });
      toast.success('税額を再計算しました');
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useFinalizeConsumptionTaxReturn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => finalizeConsumptionTaxReturn(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY] });
      toast.success('消費税申告を確定しました');
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}
