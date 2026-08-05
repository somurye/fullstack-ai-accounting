import { apiClient } from '../../lib/apiClient';
import type { components } from '../../types/api.generated';
import type {
  Account,
  Department,
  JournalEntry,
  JournalEntryCreate,
  JournalEntryListParams,
  JournalEntryUpdate,
  TaxCategory,
} from './types';

type Meta = components['schemas']['Meta'];

export interface JournalEntryListResult {
  entries: JournalEntry[];
  meta: Meta | undefined;
}

export async function fetchJournalEntries(
  params: JournalEntryListParams,
): Promise<JournalEntryListResult> {
  const { data } = await apiClient.get<components['schemas']['JournalEntryListResponse']>(
    '/journal-entries',
    { params },
  );
  return { entries: data.data ?? [], meta: data.meta };
}

export async function fetchJournalEntry(id: string): Promise<JournalEntry> {
  const { data } = await apiClient.get<components['schemas']['JournalEntryResponse']>(
    `/journal-entries/${id}`,
  );
  if (!data.data) throw new Error('仕訳データを取得できませんでした');
  return data.data;
}

export async function createJournalEntry(payload: JournalEntryCreate): Promise<JournalEntry> {
  const { data } = await apiClient.post<components['schemas']['JournalEntryResponse']>(
    '/journal-entries',
    payload,
  );
  if (!data.data) throw new Error('仕訳の作成に失敗しました');
  return data.data;
}

export async function updateJournalEntry(
  id: string,
  payload: JournalEntryUpdate,
): Promise<JournalEntry> {
  const { data } = await apiClient.patch<components['schemas']['JournalEntryResponse']>(
    `/journal-entries/${id}`,
    payload,
  );
  if (!data.data) throw new Error('仕訳の更新に失敗しました');
  return data.data;
}

export async function postJournalEntry(id: string): Promise<JournalEntry> {
  const { data } = await apiClient.post<components['schemas']['JournalEntryResponse']>(
    `/journal-entries/${id}/post`,
  );
  if (!data.data) throw new Error('仕訳の確定に失敗しました');
  return data.data;
}

export async function voidJournalEntry(id: string, reason?: string): Promise<JournalEntry> {
  const { data } = await apiClient.post<components['schemas']['JournalEntryResponse']>(
    `/journal-entries/${id}/void`,
    { reason },
  );
  if (!data.data) throw new Error('仕訳のvoidに失敗しました');
  return data.data;
}

export async function reverseJournalEntry(
  id: string,
  payload: { reason: string; entry_date?: string },
): Promise<JournalEntry> {
  const { data } = await apiClient.post<components['schemas']['JournalEntryResponse']>(
    `/journal-entries/${id}/reverse`,
    payload,
  );
  if (!data.data) throw new Error('反対仕訳の起票に失敗しました');
  return data.data;
}

export async function deleteJournalEntryLine(id: string, lineId: string): Promise<void> {
  await apiClient.delete(`/journal-entries/${id}/lines/${lineId}`);
}

export async function fetchAccounts(): Promise<Account[]> {
  const { data } = await apiClient.get<components['schemas']['AccountListResponse']>('/accounts', {
    params: { page_size: 200, is_active: true },
  });
  return data.data ?? [];
}

export async function fetchTaxCategories(): Promise<TaxCategory[]> {
  const { data } = await apiClient.get<components['schemas']['TaxCategoryListResponse']>(
    '/tax-categories',
    { params: { page_size: 200 } },
  );
  return data.data ?? [];
}

export async function fetchDepartments(): Promise<Department[]> {
  const { data } = await apiClient.get<components['schemas']['DepartmentListResponse']>(
    '/departments',
    { params: { page_size: 200 } },
  );
  return data.data ?? [];
}
