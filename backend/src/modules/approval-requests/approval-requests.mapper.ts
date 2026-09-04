import type { components } from '../../types/api.generated';

export type ApprovalRequestDto = components['schemas']['ApprovalRequest'];
export type ApprovalHistoryEntryDto = components['schemas']['ApprovalHistoryEntry'];

export interface ApprovalRequestRow {
  id: string;
  target_type:
    | 'journal_entry'
    | 'expense_report'
    | 'vendor_bill'
    | 'contract'
    | 'purchase_request'
    | 'general_request';
  target_id: string;
  submitted_by: string;
  total_steps: number;
  current_step: number;
  status: 'pending' | 'approved' | 'rejected';
}

export interface ApprovalHistoryRow {
  id: string;
  step_number: number;
  approver_id: string;
  action: 'approve' | 'reject';
  comment: string | null;
  acted_at: Date;
}

export const APPROVAL_REQUEST_COLUMNS =
  'id, target_type, target_id, submitted_by, total_steps, current_step, status';

export const APPROVAL_HISTORY_COLUMNS = 'id, step_number, approver_id, action, comment, acted_at';

export function mapApprovalHistoryRow(row: ApprovalHistoryRow): ApprovalHistoryEntryDto {
  return {
    id: row.id,
    step_number: row.step_number,
    approver_id: row.approver_id,
    action: row.action,
    comment: row.comment,
    acted_at: row.acted_at.toISOString(),
  };
}

export function mapApprovalRequestRow(
  row: ApprovalRequestRow,
  history: ApprovalHistoryEntryDto[],
): ApprovalRequestDto {
  return {
    id: row.id,
    target_type: row.target_type,
    target_id: row.target_id,
    submitted_by: row.submitted_by,
    total_steps: row.total_steps,
    current_step: row.current_step,
    status: row.status,
    history,
  };
}
