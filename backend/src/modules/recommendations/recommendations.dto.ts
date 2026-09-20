export type RecommendationStatus = 'new' | 'shown' | 'accepted' | 'dismissed';

export type RecommendationType =
  | 'contract_renewal_pending'
  | 'approval_stale'
  | 'quotation_follow_up';

export type RecommendationDomain =
  | 'contracts'
  | 'approval_requests'
  | 'quotations';

export interface RecommendationDto {
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

export interface RecommendationListQueryDto {
  status?: RecommendationStatus;
  target_domain?: RecommendationDomain;
}

export interface RecommendationActionResponseDto {
  recommendation: RecommendationDto;
  message: string;
  next_action_url: string | null;
}
