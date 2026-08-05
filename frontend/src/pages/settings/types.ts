import type { components } from '../../types/api.generated';

export type ExternalAccessGrant = components['schemas']['ExternalAccessGrant'];

export interface ExternalAccessGrantCreateParams {
  user_id: string;
  valid_from: string;
  valid_until: string;
  can_export: boolean;
}

export type GrantStatus = 'pending' | 'active' | 'expired';

export function grantStatus(grant: ExternalAccessGrant): GrantStatus {
  if (!grant.valid_from || !grant.valid_until) return 'expired';
  const now = Date.now();
  const from = new Date(grant.valid_from).getTime();
  const until = new Date(grant.valid_until).getTime();
  if (now < from) return 'pending';
  if (now > until) return 'expired';
  return 'active';
}

export const GRANT_STATUS_LABEL: Record<GrantStatus, string> = {
  pending: '発効前',
  active: '有効',
  expired: '失効/期限切れ',
};
