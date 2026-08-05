import { apiClient } from '../../lib/apiClient';
import type { components } from '../../types/api.generated';
import type { AiSuggestion, AiSuggestionListParams } from './types';

type Meta = components['schemas']['Meta'];

export interface AiSuggestionListResult {
  suggestions: AiSuggestion[];
  meta: Meta | undefined;
}

export async function fetchAiSuggestions(
  params: AiSuggestionListParams,
): Promise<AiSuggestionListResult> {
  const { data } = await apiClient.get<{ success: true; data: AiSuggestion[]; meta?: Meta }>(
    '/ai/suggestions',
    { params },
  );
  return { suggestions: data.data ?? [], meta: data.meta };
}

export async function fetchAiSuggestion(id: string): Promise<AiSuggestion> {
  const { data } = await apiClient.get<{ success: true; data: AiSuggestion; meta?: Meta }>(
    `/ai/suggestions/${id}`,
  );
  if (!data.data) throw new Error('AI提案を取得できませんでした');
  return data.data;
}

export async function acceptAiSuggestion(id: string): Promise<AiSuggestion> {
  const { data } = await apiClient.post<{ success: true; data: AiSuggestion; meta?: Meta }>(
    `/ai/suggestions/${id}/accept`,
  );
  if (!data.data) throw new Error('AI提案の採用に失敗しました');
  return data.data;
}

export async function rejectAiSuggestion(id: string, reason?: string): Promise<AiSuggestion> {
  const { data } = await apiClient.post<{ success: true; data: AiSuggestion; meta?: Meta }>(
    `/ai/suggestions/${id}/reject`,
    { reason },
  );
  if (!data.data) throw new Error('AI提案の不採用に失敗しました');
  return data.data;
}
