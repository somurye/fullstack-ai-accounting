import { apiClient } from '../../lib/apiClient';
import type { components } from '../../types/api.generated';
import type { ApprovalRequest, ApprovalRequestListParams } from './types';

type Meta = components['schemas']['Meta'];

export interface ApprovalRequestListResult {
  requests: ApprovalRequest[];
  meta: Meta | undefined;
}

export async function fetchApprovalRequests(
  params: ApprovalRequestListParams,
): Promise<ApprovalRequestListResult> {
  const { data } = await apiClient.get<{ success: true; data: ApprovalRequest[]; meta?: Meta }>(
    '/approval-requests',
    { params },
  );
  return { requests: data.data ?? [], meta: data.meta };
}

export async function fetchApprovalRequest(id: string): Promise<ApprovalRequest> {
  const { data } = await apiClient.get<{ success: true; data: ApprovalRequest }>(`/approval-requests/${id}`);
  if (!data.data) throw new Error('承認依頼の取得に失敗しました');
  return data.data;
}

export async function approveApprovalRequest(id: string, comment?: string): Promise<ApprovalRequest> {
  const { data } = await apiClient.post<{ success: true; data: ApprovalRequest }>(
    `/approval-requests/${id}/approve`,
    { comment },
  );
  if (!data.data) throw new Error('承認に失敗しました');
  return data.data;
}

export async function rejectApprovalRequest(id: string, comment: string): Promise<ApprovalRequest> {
  const { data } = await apiClient.post<{ success: true; data: ApprovalRequest }>(
    `/approval-requests/${id}/reject`,
    { comment },
  );
  if (!data.data) throw new Error('却下に失敗しました');
  return data.data;
}
