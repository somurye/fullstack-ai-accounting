import { apiClient } from '../../lib/apiClient';
import type { components } from '../../types/api.generated';
import type { AuditLog, AuditLogListParams } from './types';

type Meta = components['schemas']['Meta'];

export interface AuditLogListResult {
  logs: AuditLog[];
  meta: Meta | undefined;
}

export async function fetchAuditLogs(params: AuditLogListParams): Promise<AuditLogListResult> {
  const { data } = await apiClient.get<{ success: true; data: AuditLog[]; meta?: Meta }>(
    '/audit-logs',
    { params },
  );
  return { logs: data.data ?? [], meta: data.meta };
}
