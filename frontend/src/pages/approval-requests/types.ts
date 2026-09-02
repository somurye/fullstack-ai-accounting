import type { components } from '../../types/api.generated';

export type ApprovalRequest = components['schemas']['ApprovalRequest'];
export type ApprovalHistoryEntry = components['schemas']['ApprovalHistoryEntry'];
export type ApprovalRequestStatus = components['schemas']['ApprovalRequestStatus'];
export type ApprovalTargetType =
  | 'journal_entry'
  | 'expense_report'
  | 'vendor_bill'
  | 'contract'
  | 'purchase_request';

export interface ApprovalRequestListParams {
  page?: number;
  page_size?: number;
  status?: ApprovalRequestStatus;
  target_type?: ApprovalTargetType;
  pending_for_me?: boolean;
}

export const TARGET_TYPE_LABEL: Record<ApprovalTargetType, string> = {
  journal_entry: '仕訳',
  expense_report: '経費精算',
  vendor_bill: '仕入請求書',
  contract: '契約書',
  purchase_request: '購買稟議',
};
