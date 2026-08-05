import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import { createBankAccount, fetchBankAccounts, updateBankAccount } from './api';
import type { BankAccountFormInput, BankAccountListParams } from './types';

const BANK_ACCOUNTS_KEY = 'bank-accounts';

export function useBankAccounts(params: BankAccountListParams) {
  return useQuery({
    queryKey: [BANK_ACCOUNTS_KEY, 'list', params],
    queryFn: () => fetchBankAccounts(params),
  });
}

export function useCreateBankAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: BankAccountFormInput) => createBankAccount(dto),
    onSuccess: (bankAccount) => {
      queryClient.invalidateQueries({ queryKey: [BANK_ACCOUNTS_KEY] });
      toast.success(`銀行口座「${bankAccount.bank_name}」を作成しました`);
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}

export function useUpdateBankAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: BankAccountFormInput }) => updateBankAccount(id, dto),
    onSuccess: (bankAccount) => {
      queryClient.invalidateQueries({ queryKey: [BANK_ACCOUNTS_KEY] });
      toast.success(`銀行口座「${bankAccount.bank_name}」を更新しました`);
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}
