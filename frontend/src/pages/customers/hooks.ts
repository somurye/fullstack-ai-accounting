import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import { createCustomer, fetchCustomers, updateCustomer } from './api';
import type { CustomerFormInput, CustomerListParams } from './types';

const CUSTOMERS_KEY = 'customers';

export function useCustomers(params: CustomerListParams) {
  return useQuery({
    queryKey: [CUSTOMERS_KEY, 'list', params],
    queryFn: () => fetchCustomers(params),
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CustomerFormInput) => createCustomer(dto),
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: [CUSTOMERS_KEY] });
      toast.success(`顧客「${customer.name}」を作成しました`);
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: CustomerFormInput }) => updateCustomer(id, dto),
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: [CUSTOMERS_KEY] });
      toast.success(`顧客「${customer.name}」を更新しました`);
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}
