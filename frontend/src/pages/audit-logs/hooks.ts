import { useQuery } from '@tanstack/react-query';
import { fetchAuditLogs } from './api';
import type { AuditLogListParams } from './types';

const AUDIT_LOGS_KEY = 'audit-logs';

export function useAuditLogs(params: AuditLogListParams) {
  return useQuery({
    queryKey: [AUDIT_LOGS_KEY, 'list', params],
    queryFn: () => fetchAuditLogs(params),
  });
}
