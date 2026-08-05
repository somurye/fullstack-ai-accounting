import { apiClient } from '../../lib/apiClient';
import type { components } from '../../types/api.generated';
import type {
  BankTransaction,
  BankTransactionListParams,
  ImportCsvParams,
  ImportCsvResult,
  MatchInput,
} from './types';

type Meta = components['schemas']['Meta'];

export interface BankTransactionListResult {
  transactions: BankTransaction[];
  meta: Meta | undefined;
}

export async function fetchBankTransactions(
  params: BankTransactionListParams,
): Promise<BankTransactionListResult> {
  const { data } = await apiClient.get<{ success: true; data: BankTransaction[]; meta?: Meta }>(
    '/bank-transactions',
    { params },
  );
  return { transactions: data.data ?? [], meta: data.meta };
}

export async function importBankTransactionsCsv(params: ImportCsvParams): Promise<ImportCsvResult> {
  const formData = new FormData();
  formData.append('file', params.file);
  formData.append('bank_account_id', params.bank_account_id);
  if (params.import_profile_id) {
    formData.append('import_profile_id', params.import_profile_id);
  }
  const { data } = await apiClient.post<{ success: true; data: ImportCsvResult }>(
    '/bank-transactions/import-csv',
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  if (!data.data) throw new Error('CSV取込に失敗しました');
  return data.data;
}

export async function matchBankTransaction(
  id: string,
  dto: MatchInput,
): Promise<BankTransaction> {
  const { data } = await apiClient.post<{ success: true; data: BankTransaction }>(
    `/bank-transactions/${id}/match`,
    dto,
  );
  if (!data.data) throw new Error('明細マッチングに失敗しました');
  return data.data;
}
