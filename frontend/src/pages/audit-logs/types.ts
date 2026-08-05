import type { components } from '../../types/api.generated';

export type AuditLog = components['schemas']['AuditLog'];

export interface AuditLogListParams {
  page?: number;
  page_size?: number;
  target_type?: string;
  target_id?: string;
  actor_user_id?: string;
  occurred_from?: string;
  occurred_to?: string;
}

/** アクション名からバッジの色味を分類するための簡易ヒント */
export function actionSeverity(action: string): 'neutral' | 'positive' | 'warning' {
  if (action.includes('reject') || action.includes('revoked') || action.includes('void')) {
    return 'warning';
  }
  if (
    action.includes('posted') ||
    action.includes('approved') ||
    action.includes('issued') ||
    action.includes('finalized') ||
    action.includes('exported')
  ) {
    return 'positive';
  }
  return 'neutral';
}
