import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import {
  createJournalEntry,
  deleteJournalEntryLine,
  fetchAccounts,
  fetchDepartments,
  fetchJournalEntries,
  fetchJournalEntry,
  fetchTaxCategories,
  postJournalEntry,
  reverseJournalEntry,
  updateJournalEntry,
  voidJournalEntry,
} from './api';
import type { JournalEntryCreate, JournalEntryListParams, JournalEntryUpdate } from './types';

const JOURNAL_ENTRIES_KEY = 'journal-entries';

export function useJournalEntries(params: JournalEntryListParams) {
  return useQuery({
    queryKey: [JOURNAL_ENTRIES_KEY, 'list', params],
    queryFn: () => fetchJournalEntries(params),
  });
}

export function useJournalEntry(id: string | undefined) {
  return useQuery({
    queryKey: [JOURNAL_ENTRIES_KEY, 'detail', id],
    queryFn: () => fetchJournalEntry(id as string),
    enabled: Boolean(id),
  });
}

export function useAccounts() {
  return useQuery({ queryKey: ['accounts'], queryFn: fetchAccounts, staleTime: 5 * 60_000 });
}

export function useTaxCategories() {
  return useQuery({
    queryKey: ['tax-categories'],
    queryFn: fetchTaxCategories,
    staleTime: 5 * 60_000,
  });
}

export function useDepartments() {
  return useQuery({ queryKey: ['departments'], queryFn: fetchDepartments, staleTime: 5 * 60_000 });
}

export function useCreateJournalEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: JournalEntryCreate) => createJournalEntry(payload),
    onSuccess: (entry) => {
      queryClient.invalidateQueries({ queryKey: [JOURNAL_ENTRIES_KEY, 'list'] });
      toast.success(`仕訳 ${entry.entry_no} を下書きとして作成しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useUpdateJournalEntry(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: JournalEntryUpdate) => updateJournalEntry(id, payload),
    onSuccess: (entry) => {
      queryClient.invalidateQueries({ queryKey: [JOURNAL_ENTRIES_KEY, 'list'] });
      queryClient.invalidateQueries({ queryKey: [JOURNAL_ENTRIES_KEY, 'detail', id] });
      toast.success(`仕訳 ${entry.entry_no} を更新しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useDeleteJournalEntryLine(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (lineId: string) => deleteJournalEntryLine(id, lineId),
    onSuccess: () => {
      // 一覧画面は`entry.lines`から借方/貸方合計を算出して表示するため、
      // detailだけでなくlistのキャッシュも合わせて無効化する(他の更新系mutationと同様)。
      queryClient.invalidateQueries({ queryKey: [JOURNAL_ENTRIES_KEY, 'list'] });
      queryClient.invalidateQueries({ queryKey: [JOURNAL_ENTRIES_KEY, 'detail', id] });
      // 明細削除で残りの行番号がずれるため、行番号(target_line_no)に紐づく
      // AIサジェスチョンのキャッシュも合わせて無効化する。
      queryClient.invalidateQueries({ queryKey: ['ai-suggestions'] });
      toast.success('仕訳明細を削除しました');
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function usePostJournalEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => postJournalEntry(id),
    onSuccess: (entry) => {
      queryClient.invalidateQueries({ queryKey: [JOURNAL_ENTRIES_KEY] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      toast.success(`仕訳 ${entry.entry_no} を確定しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useVoidJournalEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => voidJournalEntry(id, reason),
    onSuccess: (entry) => {
      queryClient.invalidateQueries({ queryKey: [JOURNAL_ENTRIES_KEY] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      toast.success(`仕訳 ${entry.entry_no} をvoid(取消)しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useReverseJournalEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason, entry_date }: { id: string; reason: string; entry_date?: string }) =>
      reverseJournalEntry(id, { reason, entry_date }),
    onSuccess: (entry) => {
      queryClient.invalidateQueries({ queryKey: [JOURNAL_ENTRIES_KEY] });
      queryClient.invalidateQueries({ queryKey: ['reports'] });
      toast.success(`反対仕訳 ${entry.entry_no} を下書きとして起票しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}
