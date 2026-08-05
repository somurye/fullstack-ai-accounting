import { apiClient } from '../../lib/apiClient';
import type { components } from '../../types/api.generated';
import type { ExternalAccessGrant, ExternalAccessGrantCreateParams } from './types';

type Meta = components['schemas']['Meta'];

export interface ExternalAccessGrantListResult {
  grants: ExternalAccessGrant[];
  meta: Meta | undefined;
}

export async function fetchExternalAccessGrants(): Promise<ExternalAccessGrantListResult> {
  const { data } = await apiClient.get<{ success: true; data: ExternalAccessGrant[]; meta?: Meta }>(
    '/external-access-grants',
    { params: { page_size: 100 } },
  );
  return { grants: data.data ?? [], meta: data.meta };
}

export async function createExternalAccessGrant(
  params: ExternalAccessGrantCreateParams,
): Promise<ExternalAccessGrant> {
  const { data } = await apiClient.post<{ success: true; data: ExternalAccessGrant; meta?: Meta }>(
    '/external-access-grants',
    params,
  );
  if (!data.data) throw new Error('時限アクセス許可の発行に失敗しました');
  return data.data;
}

export async function revokeExternalAccessGrant(id: string): Promise<ExternalAccessGrant> {
  const { data } = await apiClient.post<{ success: true; data: ExternalAccessGrant; meta?: Meta }>(
    `/external-access-grants/${id}/revoke`,
  );
  if (!data.data) throw new Error('時限アクセス許可の失効に失敗しました');
  return data.data;
}
