import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { RequestContext } from '../../common/context/request-context';
import type { AuditLogListQuery } from './dto/audit-log.schemas';
import { AUDIT_LOG_COLUMNS, mapAuditLogRow, type AuditLogDto, type AuditLogRow } from './audit-logs.mapper';

export interface AuditLogListResult {
  logs: AuditLogDto[];
  pagination: PaginationMeta;
}

export interface RecordAuditLogParams {
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  beforeData?: unknown;
  afterData?: unknown;
}

/**
 * AuditLogsService
 * ================
 * `audit_logs`(追記専用。`fn_prevent_update_delete` によりUPDATE/DELETE物理禁止)への
 * 書き込みヘルパー(`record()`)と、閲覧専用の検索API(`list()`)を提供する。
 *
 * `record()` は各業務モジュールの主要な確定アクション(仕訳確定・経費承認・
 * FBデータ出力・税務申告確定 等)のトランザクション内から、既存の `PoolClient` を
 * 渡して呼び出すことを想定している(同一トランザクション内で完結させることで、
 * 本体の操作が失敗(ROLLBACK)した場合に監査ログだけが記録される不整合を防ぐ)。
 * IPアドレスは呼び出し元に引数として持ち回らせず、`RequestContext`(ミドルウェアが
 * `req.ip` から設定済み)から内部的に取得する。
 */
@Injectable()
export class AuditLogsService {
  constructor(private readonly db: DatabaseService) {}

  async record(client: PoolClient, tenantId: string, params: RecordAuditLogParams): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
         (tenant_id, actor_user_id, action, target_type, target_id, before_data, after_data, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::inet)`,
      [
        tenantId,
        params.actorUserId,
        params.action,
        params.targetType,
        params.targetId,
        JSON.stringify(params.beforeData ?? null),
        JSON.stringify(params.afterData ?? null),
        RequestContext.getIpAddress(),
      ],
    );
  }

  async list(
    tenantId: string,
    userId: string | null,
    query: AuditLogListQuery,
  ): Promise<AuditLogListResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const conditions: string[] = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];

      if (query.target_type) {
        params.push(query.target_type);
        conditions.push(`target_type = $${params.length}`);
      }
      if (query.target_id) {
        params.push(query.target_id);
        conditions.push(`target_id = $${params.length}`);
      }
      if (query.actor_user_id) {
        params.push(query.actor_user_id);
        conditions.push(`actor_user_id = $${params.length}`);
      }
      if (query.occurred_from) {
        params.push(query.occurred_from);
        conditions.push(`occurred_at >= $${params.length}`);
      }
      if (query.occurred_to) {
        params.push(query.occurred_to);
        conditions.push(`occurred_at <= $${params.length}`);
      }

      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM audit_logs WHERE ${whereClause}`,
        params,
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const listParams = [...params, query.page_size, (query.page - 1) * query.page_size];
      const result = await client.query<AuditLogRow>(
        `SELECT ${AUDIT_LOG_COLUMNS} FROM audit_logs
         WHERE ${whereClause}
         ORDER BY occurred_at DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      return {
        logs: result.rows.map(mapAuditLogRow),
        pagination: buildPagination(query.page, query.page_size, totalCount),
      };
    });
  }
}
