import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import { acceptAiSuggestion, fetchAiSuggestions, rejectAiSuggestion } from './api';
import type { AiSuggestionListParams } from './types';

const AI_SUGGESTIONS_KEY = 'ai-suggestions';

export function useAiSuggestions(
  params: AiSuggestionListParams,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: [AI_SUGGESTIONS_KEY, 'list', params],
    queryFn: () => fetchAiSuggestions(params),
    enabled: options?.enabled ?? true,
  });
}

/**
 * accept/rejectはAI提案自体だけでなく対象の草案レコード(仕訳・経費精算)も
 * 書き換えるため、両モジュールのクエリキャッシュも合わせて無効化する。
 */
function invalidateRelatedQueries(queryClient: ReturnType<typeof useQueryClient>): void {
  queryClient.invalidateQueries({ queryKey: [AI_SUGGESTIONS_KEY] });
  queryClient.invalidateQueries({ queryKey: ['journal-entries'] });
  queryClient.invalidateQueries({ queryKey: ['expense-reports'] });
}

export function useAcceptAiSuggestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => acceptAiSuggestion(id),
    onSuccess: () => {
      invalidateRelatedQueries(queryClient);
      toast.success('AI提案を採用し、対象レコードへ反映しました');
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useRejectAiSuggestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => rejectAiSuggestion(id, reason),
    onSuccess: () => {
      invalidateRelatedQueries(queryClient);
      toast.success('AI提案を不採用にしました');
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}
