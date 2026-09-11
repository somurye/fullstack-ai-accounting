import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { acquireAdvisoryLock } from '../../common/database/advisory-lock';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { DatabaseService } from '../../database/database.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type {
  CreateGeneralRequestInput,
  GeneralRequestListQuery,
  UpdateGeneralRequestInput,
} from './dto/general-request.schemas';
import {
  mapGeneralRequestRow,
  SQL_GENERAL_REQUEST_COLUMNS,
  type GeneralRequestDto,
  type GeneralRequestRow,
} from './general-requests.mapper';

export interface GeneralRequestListResult {
  data: GeneralRequestDto[];
  pagination: PaginationMeta;
}

export async function generateRequestNo(
  client: PoolClient,
  tenantId: string,
  yearMonth?: string,
): Promise<string> {
  const currentYm =
    yearMonth ??
    (() => {
      const d = new Date();
      const y = d.getFullYear().toString();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      return `${y}${m}`;
    })();
  await acquireAdvisoryLock(client, `general_request_no:${tenantId}:${currentYm}`);
  const { rows } = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM general_requests WHERE tenant_id = $1 AND request_no LIKE $2`,
    [tenantId, `REQ-${currentYm}-%`],
  );
  const seq = Number(rows[0]?.count ?? 0) + 1;
  return `REQ-${currentYm}-${String(seq).padStart(4, '0')}`;
}

@Injectable()
export class GeneralRequestsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * 稟議一覧の取得
   */
  async list(
    tenantId: string,
    userId: string | null,
    query: GeneralRequestListQuery,
  ): Promise<GeneralRequestListResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const conditions: string[] = ['gr.tenant_id = $1'];
      const params: unknown[] = [tenantId];

      if (query.status) {
        params.push(query.status);
        conditions.push(`gr.status = $${params.length}`);
      }
      if (query.category) {
        params.push(query.category);
        conditions.push(`gr.category = $${params.length}`);
      }
      if (query.search) {
        params.push(`%${query.search}%`);
        conditions.push(
          `(gr.title ILIKE $${params.length} OR gr.description ILIKE $${params.length})`,
        );
      }

      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM general_requests gr WHERE ${whereClause}`,
        params,
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const listParams = [...params, query.page_size, (query.page - 1) * query.page_size];
      const result = await client.query<GeneralRequestRow>(
        `SELECT ${SQL_GENERAL_REQUEST_COLUMNS}
         FROM general_requests gr
         WHERE ${whereClause}
         ORDER BY gr.created_at DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      return {
        data: result.rows.map(mapGeneralRequestRow),
        pagination: buildPagination(query.page, query.page_size, totalCount),
      };
    });
  }

  /**
   * 稟議詳細の取得
   */
  async getById(
    tenantId: string,
    userId: string | null,
    id: string,
  ): Promise<GeneralRequestDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<GeneralRequestRow>(
        `SELECT ${SQL_GENERAL_REQUEST_COLUMNS}
         FROM general_requests gr
         WHERE gr.tenant_id = $1 AND gr.id = $2`,
        [tenantId, id],
      );
      if (result.rowCount === 0) {
        throw AppException.notFound('指定された稟議申請が見つかりません');
      }
      return mapGeneralRequestRow(result.rows[0]);
    });
  }

  /**
   * 稟議の新規作成 (draft)
   */
  async create(
    tenantId: string,
    userId: string,
    dto: CreateGeneralRequestInput,
  ): Promise<GeneralRequestDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      // 添付ファイルの存在確認 (指定時)
      if (dto.attachment_id) {
        const attCheck = await client.query(
          `SELECT 1 FROM attachments WHERE tenant_id = $1 AND id = $2`,
          [tenantId, dto.attachment_id],
        );
        if (attCheck.rowCount === 0) {
          throw AppException.badRequest('指定された添付ファイルが存在しません');
        }
      }

      const requestNo = await generateRequestNo(client, tenantId);

      const result = await client.query<GeneralRequestRow>(
        `INSERT INTO general_requests AS gr (
           tenant_id, request_no, title, description, category,
           amount, attachment_id, status, created_by
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, 'draft', $8
         )
         RETURNING ${SQL_GENERAL_REQUEST_COLUMNS}`,
        [
          tenantId,
          requestNo,
          dto.title,
          dto.description,
          dto.category ?? 'general',
          dto.amount ?? null,
          dto.attachment_id ?? null,
          userId,
        ],
      );

      const created = mapGeneralRequestRow(result.rows[0]);

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'general_request.created',
        targetType: 'general_request',
        targetId: created.id,
        afterData: created,
      });

      return created;
    });
  }

  /**
   * 稟議の更新 (draftのみ)
   */
  async update(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdateGeneralRequestInput,
  ): Promise<GeneralRequestDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const existing = await client.query<GeneralRequestRow>(
        `SELECT ${SQL_GENERAL_REQUEST_COLUMNS}
         FROM general_requests gr
         WHERE gr.tenant_id = $1 AND gr.id = $2`,
        [tenantId, id],
      );
      if (existing.rowCount === 0) {
        throw AppException.notFound('指定された稟議申請が見つかりません');
      }
      const current = existing.rows[0];
      if (current.status !== 'draft') {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          `draft状態の稟議申請のみ更新可能です (現在: ${current.status})`,
        );
      }

      if (dto.attachment_id !== undefined && dto.attachment_id !== null) {
        const attCheck = await client.query(
          `SELECT 1 FROM attachments WHERE tenant_id = $1 AND id = $2`,
          [tenantId, dto.attachment_id],
        );
        if (attCheck.rowCount === 0) {
          throw AppException.badRequest('指定された添付ファイルが存在しません');
        }
      }

      const title = dto.title ?? current.title;
      const description = dto.description ?? current.description;
      const category = dto.category ?? current.category;
      const amount = dto.amount !== undefined ? dto.amount : current.amount;
      const attachmentId =
        dto.attachment_id !== undefined ? dto.attachment_id : current.attachment_id;

      const result = await client.query<GeneralRequestRow>(
        `UPDATE general_requests gr SET
           title = $3,
           description = $4,
           category = $5,
           amount = $6,
           attachment_id = $7,
           updated_at = now()
         WHERE gr.tenant_id = $1 AND gr.id = $2
         RETURNING ${SQL_GENERAL_REQUEST_COLUMNS}`,
        [tenantId, id, title, description, category, amount, attachmentId],
      );

      const updated = mapGeneralRequestRow(result.rows[0]);

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'general_request.updated',
        targetType: 'general_request',
        targetId: updated.id,
        beforeData: mapGeneralRequestRow(current),
        afterData: updated,
      });

      return updated;
    });
  }

  /**
   * 稟議の削除 (draftのみ物理削除)
   */
  async delete(tenantId: string, userId: string, id: string): Promise<void> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const existing = await client.query<GeneralRequestRow>(
        `SELECT ${SQL_GENERAL_REQUEST_COLUMNS}
         FROM general_requests gr
         WHERE gr.tenant_id = $1 AND gr.id = $2`,
        [tenantId, id],
      );
      if (existing.rowCount === 0) {
        throw AppException.notFound('指定された稟議申請が見つかりません');
      }
      const current = existing.rows[0];
      if (current.status !== 'draft') {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          `draft状態の稟議申請のみ削除可能です (現在: ${current.status})`,
        );
      }

      await client.query(`DELETE FROM general_requests WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        id,
      ]);

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'general_request.deleted',
        targetType: 'general_request',
        targetId: id,
        beforeData: mapGeneralRequestRow(current),
      });
    });
  }

  /**
   * 稟議の承認申請を起票する。
   *
   * 1人テナント運用とSoDの両立設計 (contractsと同様の安全設計):
   * - テナント内で general_request 向けの有効な承認ルールが存在しない場合:
   *   SoDの偶発的無効化を防止するためエラー (AppException.badRequest) を送出する。
   * - 明示的な0-step自動承認ルール (is_explicit_auto_approve = TRUE) の場合:
   *   即座に active 化し approved_at を記録する。
   * - 承認ステップ数が 1 以上のルールが存在する場合:
   *   pending_approval へ遷移させ、approval_requests を起票する。
   *   申請者自身による承認は DB トリガー fn_prevent_self_approval により厳格に遮断される。
   */
  async submitForApproval(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<GeneralRequestDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const existing = await client.query<GeneralRequestRow>(
        `SELECT ${SQL_GENERAL_REQUEST_COLUMNS}
         FROM general_requests gr
         WHERE gr.tenant_id = $1 AND gr.id = $2`,
        [tenantId, id],
      );
      if (existing.rowCount === 0) {
        throw AppException.notFound('指定された稟議申請が見つかりません');
      }
      const current = existing.rows[0];
      if (current.status !== 'draft' && current.status !== 'rejected') {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          `draft または rejected 状態の稟議申請のみ申請可能です (現在: ${current.status})`,
        );
      }

      // general_request 向けの有効な承認ルールの取得
      const rulesResult = await client.query<{
        step_number: number;
        is_explicit_auto_approve: boolean;
      }>(
        `SELECT step_number, is_explicit_auto_approve
         FROM approval_rules
         WHERE tenant_id = $1 AND target_type = 'general_request' AND is_active = TRUE
         ORDER BY step_number ASC`,
        [tenantId],
      );

      if (!rulesResult.rowCount || rulesResult.rowCount === 0) {
        // 承認ルールが未設定の場合はエラー (SoDの偶発的無効化を防止)
        throw AppException.badRequest(
          '稟議の承認ルールが設定されていません。承認ルールの設定を行ってください',
        );
      }

      // 明示的な0-step自動承認ルール (is_explicit_auto_approve = TRUE) の確認
      const autoApproveRule = rulesResult.rows.find((r) => r.is_explicit_auto_approve);
      if (autoApproveRule) {
        const updateResult = await client.query<GeneralRequestRow>(
          `UPDATE general_requests gr
           SET status = 'active', approved_at = now(), updated_at = now()
           WHERE gr.tenant_id = $1 AND gr.id = $2
           RETURNING ${SQL_GENERAL_REQUEST_COLUMNS}`,
          [tenantId, id],
        );
        const activeRequest = mapGeneralRequestRow(updateResult.rows[0]);

        await this.auditLogs.record(client, tenantId, {
          actorUserId: userId,
          action: 'general_request.auto_approved',
          targetType: 'general_request',
          targetId: id,
          afterData: { status: 'active', auto_approved: true },
        });

        return activeRequest;
      }

      // 承認ステップ >= 1: 最大ステップ数を total_steps として pending_approval へ遷移し起票
      const totalSteps = Math.max(...rulesResult.rows.map((r) => r.step_number));
      const updateResult = await client.query<GeneralRequestRow>(
        `UPDATE general_requests gr
         SET status = 'pending_approval', updated_at = now()
         WHERE gr.tenant_id = $1 AND gr.id = $2
         RETURNING ${SQL_GENERAL_REQUEST_COLUMNS}`,
        [tenantId, id],
      );
      const pendingRequest = mapGeneralRequestRow(updateResult.rows[0]);

      // approval_requests を作成または更新 (rejectedからの再申請にも対応)
      await client.query(
        `INSERT INTO approval_requests (
           tenant_id, target_type, target_id, submitted_by, total_steps, current_step, status
         ) VALUES (
           $1, 'general_request', $2, $3, $4, 1, 'pending'
         )
         ON CONFLICT (target_type, target_id)
         DO UPDATE SET
           status = 'pending',
           current_step = 1,
           submitted_by = $3,
           updated_at = now()`,
        [tenantId, id, userId, totalSteps],
      );

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'general_request.submitted_for_approval',
        targetType: 'general_request',
        targetId: id,
        afterData: { status: 'pending_approval', total_steps: totalSteps },
      });

      return pendingRequest;
    });
  }
}
