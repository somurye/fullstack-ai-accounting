import { apiClient } from '../../../lib/apiClient';
import type { components } from '../../../types/api.generated';
import type { AutoJournalRule, AutoJournalRuleFormInput, AutoJournalRuleListParams } from './types';

type Meta = components['schemas']['Meta'];

export interface AutoJournalRuleListResult {
  rules: AutoJournalRule[];
  meta: Meta | undefined;
}

export async function fetchAutoJournalRules(
  params: AutoJournalRuleListParams,
): Promise<AutoJournalRuleListResult> {
  const { data } = await apiClient.get<{ success: true; data: AutoJournalRule[]; meta?: Meta }>(
    '/auto-journal-rules',
    { params },
  );
  return { rules: data.data ?? [], meta: data.meta };
}

export async function createAutoJournalRule(dto: AutoJournalRuleFormInput): Promise<AutoJournalRule> {
  const { data } = await apiClient.post<{ success: true; data: AutoJournalRule }>(
    '/auto-journal-rules',
    dto,
  );
  if (!data.data) throw new Error('自動仕訳ルールの作成に失敗しました');
  return data.data;
}

export async function updateAutoJournalRule(
  id: string,
  dto: AutoJournalRuleFormInput,
): Promise<AutoJournalRule> {
  const { data } = await apiClient.patch<{ success: true; data: AutoJournalRule }>(
    `/auto-journal-rules/${id}`,
    dto,
  );
  if (!data.data) throw new Error('自動仕訳ルールの更新に失敗しました');
  return data.data;
}

export async function deactivateAutoJournalRule(id: string): Promise<void> {
  await apiClient.delete(`/auto-journal-rules/${id}`);
}
