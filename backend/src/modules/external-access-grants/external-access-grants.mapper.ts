import type { components } from '../../types/api.generated';

export type ExternalAccessGrantDto = components['schemas']['ExternalAccessGrant'];

export interface ExternalAccessGrantRow {
  id: string;
  user_id: string;
  valid_from: Date;
  valid_until: Date;
  can_export: boolean;
  granted_by: string;
  granted_at: Date;
}

export function mapExternalAccessGrantRow(row: ExternalAccessGrantRow): ExternalAccessGrantDto {
  return {
    id: row.id,
    user_id: row.user_id,
    valid_from: row.valid_from.toISOString(),
    valid_until: row.valid_until.toISOString(),
    can_export: row.can_export,
    granted_by: row.granted_by,
    granted_at: row.granted_at.toISOString(),
  };
}

export const EXTERNAL_ACCESS_GRANT_COLUMNS = `
  id,
  user_id,
  valid_from,
  valid_until,
  can_export,
  granted_by,
  granted_at
`;
