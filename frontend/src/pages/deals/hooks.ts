import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import {
  fetchDeals,
  fetchDeal,
  createDeal,
  updateDeal,
  closeDeal,
  deleteDeal,
  fetchCustomers,
  fetchUsers,
  type DealListParams,
} from './api';
import type { DealFormInput, CloseDealInput } from './types';

export const DEALS_KEY = 'deals';

export function useDeals(params: DealListParams) {
  return useQuery({
    queryKey: [DEALS_KEY, 'list', params],
    queryFn: () => fetchDeals(params),
  });
}

export function useDeal(id: string | undefined) {
  return useQuery({
    queryKey: [DEALS_KEY, 'detail', id],
    queryFn: () => fetchDeal(id as string),
    enabled: Boolean(id),
  });
}

export function useCustomers() {
  return useQuery({
    queryKey: ['customers'],
    queryFn: fetchCustomers,
    staleTime: 5 * 60_000,
  });
}

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
    staleTime: 5 * 60_000,
  });
}

export function useCreateDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: DealFormInput) => createDeal(payload),
    onSuccess: (deal) => {
      queryClient.invalidateQueries({ queryKey: [DEALS_KEY] });
      toast.success(`案件「${deal.title}」を作成しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useUpdateDeal(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<DealFormInput>) => updateDeal(id, payload),
    onSuccess: (deal) => {
      queryClient.invalidateQueries({ queryKey: [DEALS_KEY] });
      queryClient.invalidateQueries({ queryKey: [DEALS_KEY, 'detail', id] });
      toast.success(`案件「${deal.title}」を更新しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useCloseDeal(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CloseDealInput) => closeDeal(id, payload),
    onSuccess: (deal) => {
      queryClient.invalidateQueries({ queryKey: [DEALS_KEY] });
      queryClient.invalidateQueries({ queryKey: [DEALS_KEY, 'detail', id] });
      const label = deal.stage === 'won' ? '受注(Won)' : '失注(Lost)';
      toast.success(`案件「${deal.title}」を「${label}」としてクローズしました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useDeleteDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteDeal(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [DEALS_KEY] });
      toast.success('案件を削除しました');
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}
