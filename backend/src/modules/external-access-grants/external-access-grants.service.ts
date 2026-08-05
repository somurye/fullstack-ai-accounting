import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type {
  ExternalAccessGrantCreateInput,
  ExternalAccessGrantListQuery,
} from './dto/external-access-grant.schemas';
import {
  EXTERNAL_ACCESS_GRANT_COLUMNS,
  mapExternalAccessGrantRow,
  type ExternalAccessGrantDto,
  type ExternalAccessGrantRow,
} from './external-access-grants.mapper';

export interface ExternalAccessGrantListResult {
  grants: ExternalAccessGrantDto[];
  pagination: PaginationMeta;
}

/**
 * ExternalAccessGrantsService
 * ============================
 * 税理士・監査人向けの時限アクセス許可(`external_access_grants`)の管理。
 *
 * ここで発行される許可は、`sql/001_initial_schema_all_in_one.sql` の
 * `fn_has_active_external_grant()` (SECURITY DEFINER) と、DBロール
 * `app_readonly_external` に対するRESTRICTIVE RLSポリシーによって、
 * アプリケーション層のバグを迂回しても最終的にDB側で強制される
 * (`ExternalAccessGuard` 参照)。
 */
@Injectable()
export class ExternalAccessGrantsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async list(
    tenantId: string,
    userId: string | null,
    query: ExternalAccessGrantListQuery,
  ): Promise<ExternalAccessGrantListResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM external_access_grants WHERE tenant_id = $1`,
        [tenantId],
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const result = await client.query<ExternalAccessGrantRow>(
        `SELECT ${EXTERNAL_ACCESS_GRANT_COLUMNS} FROM external_access_grants
         WHERE tenant_id = $1
         ORDER BY granted_at DESC
         LIMIT $2 OFFSET $3`,
        [tenantId, query.page_size, (query.page - 1) * query.page_size],
      );

      return {
        grants: result.rows.map(mapExternalAccessGrantRow),
        pagination: buildPagination(query.page, query.page_size, totalCount),
      };
    });
  }

  async create(
    tenantId: string,
    userId: string,
    dto: ExternalAccessGrantCreateInput,
  ): Promise<ExternalAccessGrantDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      // 対象ユーザーが実際に viewer_external ロールを保持しているかを確認する
      // (内部ユーザーへ誤って時限「外部」アクセスを発行してしまう事故を防ぐ)。
      const roleCheck = await client.query(
        `SELECT 1 FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.tenant_id = $1 AND ur.user_id = $2 AND r.code = 'viewer_external'`,
        [tenantId, dto.user_id],
      );
      if (roleCheck.rowCount === 0) {
        throw AppException.badRequest(
          '指定されたユーザーは viewer_external ロールを保持していないため、外部アクセス許可を発行できません',
        );
      }

      const inserted = await client.query<ExternalAccessGrantRow>(
        `INSERT INTO external_access_grants
           (tenant_id, user_id, valid_from, valid_until, can_export, granted_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${EXTERNAL_ACCESS_GRANT_COLUMNS}`,
        [tenantId, dto.user_id, dto.valid_from, dto.valid_until, dto.can_export, userId],
      );
      const grant = inserted.rows[0];

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'external_access_grant.granted',
        targetType: 'external_access_grant',
        targetId: grant.id,
        afterData: {
          user_id: grant.user_id,
          valid_from: grant.valid_from,
          valid_until: grant.valid_until,
          can_export: grant.can_export,
        },
      });

      return mapExternalAccessGrantRow(grant);
    });
  }

  async revoke(tenantId: string, userId: string, id: string): Promise<ExternalAccessGrantDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const before = await client.query<ExternalAccessGrantRow>(
        `SELECT ${EXTERNAL_ACCESS_GRANT_COLUMNS} FROM external_access_grants WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (before.rowCount === 0) {
        throw AppException.notFound('指定された外部アクセス許可が見つかりません');
      }

      const updated = await client.query<ExternalAccessGrantRow>(
        `UPDATE external_access_grants SET valid_until = LEAST(valid_until, now())
         WHERE tenant_id = $1 AND id = $2
         RETURNING ${EXTERNAL_ACCESS_GRANT_COLUMNS}`,
        [tenantId, id],
      );
      const grant = updated.rows[0];

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'external_access_grant.revoked',
        targetType: 'external_access_grant',
        targetId: grant.id,
        beforeData: { valid_until: before.rows[0].valid_until },
        afterData: { valid_until: grant.valid_until },
      });

      return mapExternalAccessGrantRow(grant);
    });
  }
}
