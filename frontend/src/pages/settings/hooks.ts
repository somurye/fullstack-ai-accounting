import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import { createExternalAccessGrant, fetchExternalAccessGrants, revokeExternalAccessGrant } from './api';
import type { ExternalAccessGrantCreateParams } from './types';

const EXTERNAL_ACCESS_GRANTS_KEY = 'external-access-grants';

export function useExternalAccessGrants() {
  return useQuery({
    queryKey: [EXTERNAL_ACCESS_GRANTS_KEY, 'list'],
    queryFn: () => fetchExternalAccessGrants(),
  });
}

export function useCreateExternalAccessGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: ExternalAccessGrantCreateParams) => createExternalAccessGrant(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [EXTERNAL_ACCESS_GRANTS_KEY] });
      toast.success('時限アクセス許可を発行しました');
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useRevokeExternalAccessGrant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeExternalAccessGrant(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [EXTERNAL_ACCESS_GRANTS_KEY] });
      toast.success('時限アクセス許可を即時失効させました');
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}
