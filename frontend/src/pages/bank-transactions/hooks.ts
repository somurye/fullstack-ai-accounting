import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import { fetchBankTransactions, importBankTransactionsCsv, matchBankTransaction } from './api';
import type { BankTransactionListParams, ImportCsvParams, MatchInput } from './types';

const BANK_TRANSACTIONS_KEY = 'bank-transactions';

export function useBankTransactions(params: BankTransactionListParams) {
  return useQuery({
    queryKey: [BANK_TRANSACTIONS_KEY, 'list', params],
    queryFn: () => fetchBankTransactions(params),
  });
}

export function useImportBankTransactionsCsv() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: ImportCsvParams) => importBankTransactionsCsv(params),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [BANK_TRANSACTIONS_KEY] });
      toast.success(
        `${result.imported_count}件取込(重複スキップ${result.duplicate_skipped_count}件、自動消込${result.auto_matched_count}件)`,
      );
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}

export function useMatchBankTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: MatchInput }) => matchBankTransaction(id, dto),
    onSuccess: (transaction) => {
      queryClient.invalidateQueries({ queryKey: [BANK_TRANSACTIONS_KEY] });
      queryClient.invalidateQueries({ queryKey: ['ai-suggestions'] });
      if (transaction.match_status === 'unmatched') {
        toast.info('自動仕訳ルールに該当なし。AI提案を確認してください');
      } else {
        toast.success('明細を消込みました');
      }
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}
