import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../../lib/apiClient';
import { toast } from '../../../stores/toastStore';
import {
  createAutoJournalRule,
  deactivateAutoJournalRule,
  fetchAutoJournalRules,
  updateAutoJournalRule,
} from './api';
import type { AutoJournalRuleFormInput, AutoJournalRuleListParams } from './types';

const RULES_KEY = 'auto-journal-rules';

export function useAutoJournalRules(params: AutoJournalRuleListParams) {
  return useQuery({
    queryKey: [RULES_KEY, 'list', params],
    queryFn: () => fetchAutoJournalRules(params),
  });
}

export function useCreateAutoJournalRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: AutoJournalRuleFormInput) => createAutoJournalRule(dto),
    onSuccess: (rule) => {
      queryClient.invalidateQueries({ queryKey: [RULES_KEY] });
      toast.success(`自動仕訳ルール「${rule.rule_name}」を作成しました`);
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}

export function useUpdateAutoJournalRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: AutoJournalRuleFormInput }) =>
      updateAutoJournalRule(id, dto),
    onSuccess: (rule) => {
      queryClient.invalidateQueries({ queryKey: [RULES_KEY] });
      toast.success(`自動仕訳ルール「${rule.rule_name}」を更新しました`);
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}

export function useDeactivateAutoJournalRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deactivateAutoJournalRule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [RULES_KEY] });
      toast.success('自動仕訳ルールを無効化しました');
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}
