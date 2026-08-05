import type { components } from '../../types/api.generated';

export type AuditLogDto = components['schemas']['AuditLog'];

export interface AuditLogRow {
  id: string;
  actor_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  before_data: unknown;
  after_data: unknown;
  ip_address: string | null;
  occurred_at: Date;
}

export function mapAuditLogRow(row: AuditLogRow): AuditLogDto {
  return {
    id: row.id,
    actor_user_id: row.actor_user_id,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    before_data: row.before_data as AuditLogDto['before_data'],
    after_data: row.after_data as AuditLogDto['after_data'],
    ip_address: row.ip_address,
    occurred_at: row.occurred_at.toISOString(),
  };
}

export const AUDIT_LOG_COLUMNS = `
  id,
  actor_user_id,
  action,
  target_type,
  target_id,
  before_data,
  after_data,
  ip_address::text AS ip_address,
  occurred_at
`;
