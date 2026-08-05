import { apiClient } from '../../../lib/apiClient';
import type { components } from '../../../types/api.generated';
import type { Account, AccountCreateFormInput, AccountListParams, AccountUpdateFormInput } from './types';

type Meta = components['schemas']['Meta'];

export interface AccountListResult {
  accounts: Account[];
  meta: Meta | undefined;
}

export async function fetchAccounts(params: AccountListParams): Promise<AccountListResult> {
  const { data } = await apiClient.get<{ success: true; data: Account[]; meta?: Meta }>('/accounts', {
    params,
  });
  return { accounts: data.data ?? [], meta: data.meta };
}

export async function createAccount(dto: AccountCreateFormInput): Promise<Account> {
  const { data } = await apiClient.post<{ success: true; data: Account }>('/accounts', dto);
  if (!data.data) throw new Error('勘定科目の作成に失敗しました');
  return data.data;
}

export async function updateAccount(id: string, dto: AccountUpdateFormInput): Promise<Account> {
  const { data } = await apiClient.patch<{ success: true; data: Account }>(`/accounts/${id}`, dto);
  if (!data.data) throw new Error('勘定科目の更新に失敗しました');
  return data.data;
}
