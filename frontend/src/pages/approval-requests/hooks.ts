import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import { approveApprovalRequest, fetchApprovalRequests, rejectApprovalRequest } from './api';
import type { ApprovalRequest, ApprovalRequestListParams, ApprovalTargetType } from './types';

const APPROVAL_REQUESTS_KEY = 'approval-requests';

// approval_requests.target_type から、承認/却下によりステータスが変わる
// 対象リソース自身のReact Queryキーへのマッピング。承認/却下は
// approval_requests と対象リソース(journal-entries/expense-reports/vendor-bills)を
// またぐ操作のため、対象リソース側のキャッシュも明示的に無効化する必要がある。
const TARGET_TYPE_QUERY_KEY: Record<ApprovalTargetType, string> = {
  journal_entry: 'journal-entries',
  expense_report: 'expense-reports',
  vendor_bill: 'vendor-bills',
  contract: 'contracts',
  purchase_request: 'purchase-requests',
  general_request: 'general-requests',
};

function invalidateApprovalSideEffects(
  queryClient: ReturnType<typeof useQueryClient>,
  record: ApprovalRequest,
) {
  queryClient.invalidateQueries({ queryKey: [APPROVAL_REQUESTS_KEY] });
  if (record.target_type) {
    queryClient.invalidateQueries({ queryKey: [TARGET_TYPE_QUERY_KEY[record.target_type]] });
    // 承認完了は対象の仕訳をposted化しうる(journal_entry自体の承認、または
    // expense_report/vendor_billに紐づくdraft仕訳の確定)ため、レポート集計も無効化する。
    queryClient.invalidateQueries({ queryKey: ['reports'] });
  }
  if (record.target_type && record.target_id) {
    queryClient.invalidateQueries({ queryKey: ['approval-target', record.target_type, record.target_id] });
  }
}

export function useApprovalRequests(params: ApprovalRequestListParams) {
  return useQuery({
    queryKey: [APPROVAL_REQUESTS_KEY, 'list', params],
    queryFn: () => fetchApprovalRequests(params),
  });
}

export function useApproveApprovalRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, comment }: { id: string; comment?: string }) => approveApprovalRequest(id, comment),
    onSuccess: (record) => {
      invalidateApprovalSideEffects(queryClient, record);
      toast.success(record.status === 'approved' ? '承認しました(全ステップ完了)' : '承認しました(次の承認者へ)');
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}

export function useRejectApprovalRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) => rejectApprovalRequest(id, comment),
    onSuccess: (record) => {
      invalidateApprovalSideEffects(queryClient, record);
      toast.success('却下しました');
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}
