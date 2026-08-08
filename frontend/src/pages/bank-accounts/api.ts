import { apiClient } from '../../lib/apiClient';
import type { components } from '../../types/api.generated';
import type {
  BankAccount,
  BankAccountFormInput,
  BankAccountListParams,
  BankSyncParams,
  BankSyncResult,
} from './types';

type Meta = components['schemas']['Meta'];

export interface BankAccountListResult {
  bankAccounts: BankAccount[];
  meta: Meta | undefined;
}

export async function fetchBankAccounts(params: BankAccountListParams): Promise<BankAccountListResult> {
  const { data } = await apiClient.get<{ success: true; data: BankAccount[]; meta?: Meta }>(
    '/bank-accounts',
    { params },
  );
  return { bankAccounts: data.data ?? [], meta: data.meta };
}

export async function createBankAccount(dto: BankAccountFormInput): Promise<BankAccount> {
  const { data } = await apiClient.post<{ success: true; data: BankAccount }>('/bank-accounts', dto);
  if (!data.data) throw new Error('銀行口座の作成に失敗しました');
  return data.data;
}

export async function updateBankAccount(id: string, dto: BankAccountFormInput): Promise<BankAccount> {
  const { data } = await apiClient.patch<{ success: true; data: BankAccount }>(
    `/bank-accounts/${id}`,
    dto,
  );
  if (!data.data) throw new Error('銀行口座の更新に失敗しました');
  return data.data;
}

/** 銀行API連携(モック)経由で明細を取得し、既存の自動消込エンジンへ連携する */
export async function syncBankTransactions(params: BankSyncParams): Promise<BankSyncResult> {
  const { data } = await apiClient.post<{ success: true; data: BankSyncResult }>(
    '/bank-integration/sync',
    params,
  );
  if (!data.data) throw new Error('銀行明細のAPI同期に失敗しました');
  return data.data;
}
