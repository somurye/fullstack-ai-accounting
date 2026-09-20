import { apiClient } from '../../lib/apiClient';

export type RecommendationStatus = 'new' | 'shown' | 'accepted' | 'dismissed';
export type RecommendationDomain = 'contracts' | 'approval_requests' | 'quotations';
export type RecommendationType =
  | 'contract_renewal_pending'
  | 'approval_stale'
  | 'quotation_follow_up';

export interface Recommendation {
  id: string;
  tenant_id: string;
  type: RecommendationType;
  target_domain: RecommendationDomain;
  target_id: string;
  title: string;
  message: string;
  status: RecommendationStatus;
  action_url: string | null;
  metadata: Record<string, any>;
  shown_at: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecommendationActionResponse {
  recommendation: Recommendation;
  message: string;
  next_action_url: string | null;
}

export const recommendationsApi = {
  list: async (params?: {
    status?: RecommendationStatus;
    target_domain?: RecommendationDomain;
  }): Promise<Recommendation[]> => {
    const res = await apiClient.get<{ data: Recommendation[] }>('/recommendations', {
      params,
    });
    return res.data.data;
  },

  accept: async (id: string): Promise<RecommendationActionResponse> => {
    const res = await apiClient.patch<{ data: RecommendationActionResponse }>(
      `/recommendations/${id}/accept`,
    );
    return res.data.data;
  },

  dismiss: async (id: string): Promise<RecommendationActionResponse> => {
    const res = await apiClient.patch<{ data: RecommendationActionResponse }>(
      `/recommendations/${id}/dismiss`,
    );
    return res.data.data;
  },
};
