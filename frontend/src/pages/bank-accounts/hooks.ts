import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import { createBankAccount, fetchBankAccounts, syncBankTransactions, updateBankAccount } from './api';
import type { BankAccountFormInput, BankAccountListParams, BankSyncParams } from './types';

const BANK_ACCOUNTS_KEY = 'bank-accounts';
const BANK_TRANSACTIONS_KEY = 'bank-transactions';

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

interface AggregatedSyncResult {
  synced_count: number;
  duplicate_skipped_count: number;
  auto_matched_count: number;
}

/**
 * 設定画面「銀行・外部決済コネクタ」カードの「今すぐ明細同期」用。口座ごとの個別同期ボタンとは
 * 異なり、テナントの全銀行口座に対して既存の`/bank-integration/sync`を順に呼び出し、
 * 結果を合算した1件のトーストにまとめる(口座数だけトーストが連続表示されるのを避けるため)。
 */
export function useSyncAllBankAccounts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<AggregatedSyncResult> => {
      const { bankAccounts } = await fetchBankAccounts({ page: 1, page_size: 100 });
      const accountIds = bankAccounts
        .map((account) => account.id)
        .filter((id): id is string => id !== undefined);
      const results = await Promise.all(
        accountIds.map((bankAccountId) => syncBankTransactions({ bank_account_id: bankAccountId })),
      );
      return results.reduce<AggregatedSyncResult>(
        (acc, result) => ({
          synced_count: acc.synced_count + result.synced_count,
          duplicate_skipped_count: acc.duplicate_skipped_count + result.duplicate_skipped_count,
          auto_matched_count: acc.auto_matched_count + result.auto_matched_count,
        }),
        { synced_count: 0, duplicate_skipped_count: 0, auto_matched_count: 0 },
      );
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [BANK_TRANSACTIONS_KEY] });
      queryClient.invalidateQueries({ queryKey: ['ai-suggestions'] });
      if (result.synced_count === 0) {
        toast.info(
          `新着明細はありませんでした(重複スキップ${result.duplicate_skipped_count}件)`,
        );
        return;
      }
      toast.success(
        `${result.synced_count}件の新着明細を取り込み、自動消込を完了しました` +
          `(自動消込${result.auto_matched_count}件、重複スキップ${result.duplicate_skipped_count}件)`,
      );
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}

/** 銀行API連携(モック)のワンクリック同期。取込件数・自動消込件数をトースト表示する */
export function useSyncBankTransactions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: BankSyncParams) => syncBankTransactions(params),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [BANK_TRANSACTIONS_KEY] });
      queryClient.invalidateQueries({ queryKey: ['ai-suggestions'] });
      if (result.synced_count === 0) {
        toast.info(
          `新着明細はありませんでした(重複スキップ${result.duplicate_skipped_count}件)`,
        );
        return;
      }
      toast.success(
        `${result.synced_count}件の新着明細を取り込み、自動消込を完了しました` +
          `(自動消込${result.auto_matched_count}件、重複スキップ${result.duplicate_skipped_count}件)`,
      );
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}
