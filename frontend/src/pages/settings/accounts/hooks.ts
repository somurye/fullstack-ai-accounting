import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../../lib/apiClient';
import { toast } from '../../../stores/toastStore';
import { createAccount, fetchAccounts, updateAccount } from './api';
import type { AccountCreateFormInput, AccountListParams, AccountUpdateFormInput } from './types';

const ACCOUNTS_KEY = 'settings-accounts';

export function useAccounts(params: AccountListParams) {
  return useQuery({
    queryKey: [ACCOUNTS_KEY, 'list', params],
    queryFn: () => fetchAccounts(params),
  });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: AccountCreateFormInput) => createAccount(dto),
    onSuccess: (account) => {
      queryClient.invalidateQueries({ queryKey: [ACCOUNTS_KEY] });
      toast.success(`勘定科目「${account.name}」を作成しました`);
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}

export function useUpdateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: AccountUpdateFormInput }) => updateAccount(id, dto),
    onSuccess: (account) => {
      queryClient.invalidateQueries({ queryKey: [ACCOUNTS_KEY] });
      toast.success(`勘定科目「${account.name}」を更新しました`);
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}
