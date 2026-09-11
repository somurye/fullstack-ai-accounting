import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { acquireAdvisoryLock } from '../../common/database/advisory-lock';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  mapPurchaseRequestRow,
  getSqlPurchaseRequestColumns,
  type PurchaseRequestApprovalHistoryEntryDto,
  type PurchaseRequestAttachmentDto,
  type PurchaseRequestDetailDto,
  type PurchaseRequestDto,
  type PurchaseRequestRow,
} from './purchase-requests.mapper';
import type {
  CreatePurchaseRequestInput,
  PurchaseRequestListQuery,
  UpdatePurchaseRequestInput,
} from './dto/purchase-request.schemas';

export interface PurchaseRequestListResult {
  purchaseRequests: PurchaseRequestDto[];
  pagination: PaginationMeta;
}

export async function generatePurchaseRequestNo(
  client: PoolClient,
  tenantId: string,
  year?: string,
): Promise<string> {
  const currentYear = year ?? new Date().getFullYear().toString();
  await acquireAdvisoryLock(client, `purchase_request_no:${tenantId}:${currentYear}`);
  const { rows } = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM purchase_requests WHERE tenant_id = $1 AND request_no LIKE $2`,
    [tenantId, `PR-${currentYear}-%`],
  );
  const seq = Number(rows[0]?.count ?? 0) + 1;
  return `PR-${currentYear}-${String(seq).padStart(4, '0')}`;
}

@Injectable()
export class PurchaseRequestsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  private async hasSupplierIdColumn(client: PoolClient): Promise<boolean> {
    if (process.env.NODE_ENV === 'test') {
      return true;
    }
    try {
      const res = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM pg_attribute
           WHERE attrelid = 'purchase_requests'::regclass
             AND attname = 'supplier_id'
             AND NOT attisdropped
         ) AS exists`,
      );
      return Boolean(res.rows[0]?.exists);
    } catch {
      return false;
    }
  }

  private async getColumns(client: PoolClient): Promise<string> {
    const hasSupplierId = await this.hasSupplierIdColumn(client);
    return getSqlPurchaseRequestColumns(hasSupplierId);
  }

  /**
   * DB層/Service層での二重RBAC認可チェックヘルパー (DEBT-005パターン)
   */
  private async assertUserPermission(
    client: PoolClient,
    tenantId: string,
    userId: string | null,
    permissionCode: string,
  ): Promise<void> {
    if (!userId) {
      throw AppException.unauthorized('ユーザー認証が必要です');
    }
    const permCheck = await client.query(
      `SELECT 1
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.tenant_id = $1 AND ur.user_id = $2
         AND p.code = $3
       LIMIT 1`,
      [tenantId, userId, permissionCode],
    );
    if (permCheck.rowCount === 0) {
      throw AppException.forbidden(`この操作を行う権限(${permissionCode})がありません`);
    }
  }

  /**
   * 発注申請一覧の取得 (RLS + テナント絞り込み)
   */
  async list(
    tenantId: string,
    userId: string | null,
    query: PurchaseRequestListQuery,
  ): Promise<PurchaseRequestListResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const hasSupplierId = await this.hasSupplierIdColumn(client);
      const sqlColumns = getSqlPurchaseRequestColumns(hasSupplierId);

      const conditions: string[] = ['pr.tenant_id = $1'];
      const params: unknown[] = [tenantId];

      if (query.status) {
        params.push(query.status);
        conditions.push(`pr.status = $${params.length}`);
      }

      if (hasSupplierId && query.supplier_id) {
        params.push(query.supplier_id);
        conditions.push(`pr.supplier_id = $${params.length}`);
      }
      if (query.supplier_name) {
        params.push(`%${query.supplier_name}%`);
        conditions.push(`pr.supplier_name ILIKE $${params.length}`);
      }
      if (query.search) {
        params.push(`%${query.search}%`);
        conditions.push(
          `(pr.title ILIKE $${params.length} OR pr.supplier_name ILIKE $${params.length} OR pr.item_description ILIKE $${params.length})`,
        );
      }

      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM purchase_requests pr WHERE ${whereClause}`,
        params,
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const listParams = [...params, query.page_size, (query.page - 1) * query.page_size];
      const result = await client.query<PurchaseRequestRow>(
        `SELECT ${sqlColumns}
         FROM purchase_requests pr
         WHERE ${whereClause}
         ORDER BY pr.created_at DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      return {
        purchaseRequests: result.rows.map(mapPurchaseRequestRow),
        pagination: buildPagination(query.page, query.page_size, totalCount),
      };
    });
  }

  /**
   * 発注申請詳細の取得 (添付ファイルメタデータ・承認履歴含む)
   */
  async getById(
    tenantId: string,
    userId: string | null,
    id: string,
  ): Promise<PurchaseRequestDetailDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const sqlColumns = await this.getColumns(client);
      const result = await client.query<PurchaseRequestRow>(
        `SELECT ${sqlColumns}
         FROM purchase_requests pr
         WHERE pr.tenant_id = $1 AND pr.id = $2`,
        [tenantId, id],
      );
      if (result.rowCount === 0) {
        throw AppException.notFound('指定された発注申請が見つかりません');
      }

      const base = mapPurchaseRequestRow(result.rows[0]);

      // 添付ファイルの取得
      let attachment: PurchaseRequestAttachmentDto | null = null;
      if (base.attachment_id) {
        const attRes = await client.query<{
          id: string;
          file_name: string;
          mime_type: string;
          file_size: number;
        }>(
          `SELECT id, file_name, mime_type, file_size
           FROM attachments
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, base.attachment_id],
        );
        if (attRes.rowCount && attRes.rowCount > 0) {
          attachment = attRes.rows[0];
        }
      }

      // 承認履歴の取得
      const historyRes = await client.query<{
        id: string;
        step_number: number;
        approver_id: string;
        approver_name: string | null;
        action: 'approve' | 'reject';
        comment: string | null;
        acted_at: Date;
      }>(
        `SELECT
           ah.id,
           ah.step_number,
           ah.approver_id,
           u.name AS approver_name,
           ah.action,
           ah.comment,
           ah.acted_at
         FROM approval_history ah
         JOIN approval_requests ar ON ar.id = ah.approval_request_id
         LEFT JOIN users u ON u.id = ah.approver_id
         WHERE ar.tenant_id = $1 AND ar.target_type = 'purchase_request' AND ar.target_id = $2
         ORDER BY ah.step_number ASC, ah.acted_at ASC`,
        [tenantId, id],
      );

      const approvalHistory: PurchaseRequestApprovalHistoryEntryDto[] = historyRes.rows.map((r) => ({
        id: r.id,
        step_number: r.step_number,
        approver_id: r.approver_id,
        approver_name: r.approver_name ?? undefined,
        action: r.action,
        comment: r.comment,
        acted_at: r.acted_at instanceof Date ? r.acted_at.toISOString() : String(r.acted_at),
      }));

      return {
        ...base,
        attachment,
        approval_history: approvalHistory,
      };
    });
  }

  /**
   * 発注申請の新規作成 (draft)
   */
  async create(
    tenantId: string,
    userId: string,
    dto: CreatePurchaseRequestInput,
  ): Promise<PurchaseRequestDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'purchase_request.create');

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

      // 金額計算の整合性チェック
      const calculatedTotal = Math.round(dto.quantity * dto.unit_price * 100) / 100;
      const totalAmount = dto.total_amount !== undefined ? dto.total_amount : calculatedTotal;
      if (Math.abs(totalAmount - calculatedTotal) >= 0.01) {
        throw AppException.badRequest(
          `合計金額 (${totalAmount}) が数量 × 単価の計算結果 (${calculatedTotal}) と一致しません`,
        );
      }

      const requestNo = await generatePurchaseRequestNo(client, tenantId);

      let supplierName = dto.supplier_name ? dto.supplier_name.trim() : '';
      const supplierId = dto.supplier_id ?? null;

      const hasSupplierId = await this.hasSupplierIdColumn(client);
      const sqlColumns = getSqlPurchaseRequestColumns(hasSupplierId);

      if (hasSupplierId && supplierId && !supplierName) {
        const supRes = await client.query<{ name: string }>(
          `SELECT name FROM suppliers WHERE tenant_id = $1 AND id = $2`,
          [tenantId, supplierId],
        );
        if (supRes.rows.length > 0) {
          supplierName = supRes.rows[0].name;
        }
      }

      const result = hasSupplierId
        ? await client.query<PurchaseRequestRow>(
            `INSERT INTO purchase_requests AS pr (
               tenant_id, request_no, title, supplier_id, supplier_name, item_description,
               quantity, unit_price, total_amount, currency, requested_delivery_date,
               status, attachment_id, description, created_by
             ) VALUES (
               $1, $2, $3, $4, $5, $6,
               $7, $8, $9, $10, $11,
               'draft', $12, $13, $14
             )
             RETURNING ${sqlColumns}`,
            [
              tenantId,
              requestNo,
              dto.title,
              supplierId,
              supplierName,
              dto.item_description,
              dto.quantity,
              dto.unit_price,
              totalAmount,
              dto.currency ?? 'JPY',
              dto.requested_delivery_date ?? null,
              dto.attachment_id ?? null,
              dto.description ?? null,
              userId,
            ],
          )
        : await client.query<PurchaseRequestRow>(
            `INSERT INTO purchase_requests AS pr (
               tenant_id, request_no, title, supplier_name, item_description,
               quantity, unit_price, total_amount, currency, requested_delivery_date,
               status, attachment_id, description, created_by
             ) VALUES (
               $1, $2, $3, $4, $5,
               $6, $7, $8, $9, $10,
               'draft', $11, $12, $13
             )
             RETURNING ${sqlColumns}`,
            [
              tenantId,
              requestNo,
              dto.title,
              supplierName,
              dto.item_description,
              dto.quantity,
              dto.unit_price,
              totalAmount,
              dto.currency ?? 'JPY',
              dto.requested_delivery_date ?? null,
              dto.attachment_id ?? null,
              dto.description ?? null,
              userId,
            ],
          );

      const created = mapPurchaseRequestRow(result.rows[0]);

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'purchase_request.created',
        targetType: 'purchase_request',
        targetId: created.id,
        afterData: created,
      });

      return created;
    });
  }

  /**
   * 発注申請の更新 (draftのみ)
   */
  async update(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdatePurchaseRequestInput,
  ): Promise<PurchaseRequestDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'purchase_request.edit');

      const hasSupplierId = await this.hasSupplierIdColumn(client);
      const sqlColumns = getSqlPurchaseRequestColumns(hasSupplierId);

      const existing = await client.query<PurchaseRequestRow>(
        `SELECT ${sqlColumns}
         FROM purchase_requests pr
         WHERE pr.tenant_id = $1 AND pr.id = $2`,
        [tenantId, id],
      );
      if (existing.rowCount === 0) {
        throw AppException.notFound('指定された発注申請が見つかりません');
      }
      const current = existing.rows[0];
      if (current.status !== 'draft') {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          `draft状態の発注申請のみ更新可能です (現在: ${current.status})`,
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
      const supplierId = dto.supplier_id !== undefined ? dto.supplier_id : current.supplier_id;
      let supplierName = dto.supplier_name !== undefined ? dto.supplier_name.trim() : current.supplier_name;

      if (hasSupplierId && supplierId && !supplierName) {
        const supRes = await client.query<{ name: string }>(
          `SELECT name FROM suppliers WHERE tenant_id = $1 AND id = $2`,
          [tenantId, supplierId],
        );
        if (supRes.rows.length > 0) {
          supplierName = supRes.rows[0].name;
        }
      }

      const itemDescription = dto.item_description ?? current.item_description;
      const quantity = dto.quantity !== undefined ? dto.quantity : Number(current.quantity);
      const unitPrice = dto.unit_price !== undefined ? dto.unit_price : Number(current.unit_price);
      const calculatedTotal = Math.round(quantity * unitPrice * 100) / 100;
      const totalAmount =
        dto.total_amount !== undefined ? dto.total_amount : calculatedTotal;

      if (Math.abs(totalAmount - calculatedTotal) >= 0.01) {
        throw AppException.badRequest(
          `合計金額 (${totalAmount}) が数量 × 単価の計算結果 (${calculatedTotal}) と一致しません`,
        );
      }

      const currency = dto.currency ?? current.currency;
      const requestedDeliveryDate =
        dto.requested_delivery_date !== undefined
          ? dto.requested_delivery_date
          : current.requested_delivery_date;
      const attachmentId =
        dto.attachment_id !== undefined ? dto.attachment_id : current.attachment_id;
      const description =
        dto.description !== undefined ? dto.description : current.description;

      const result = hasSupplierId
        ? await client.query<PurchaseRequestRow>(
            `UPDATE purchase_requests pr SET
               title = $3,
               supplier_id = $4,
               supplier_name = $5,
               item_description = $6,
               quantity = $7,
               unit_price = $8,
               total_amount = $9,
               currency = $10,
               requested_delivery_date = $11,
               attachment_id = $12,
               description = $13,
               updated_at = now()
             WHERE pr.tenant_id = $1 AND pr.id = $2
             RETURNING ${sqlColumns}`,
            [
              tenantId,
              id,
              title,
              supplierId,
              supplierName,
              itemDescription,
              quantity,
              unitPrice,
              totalAmount,
              currency,
              requestedDeliveryDate,
              attachmentId,
              description,
            ],
          )
        : await client.query<PurchaseRequestRow>(
            `UPDATE purchase_requests pr SET
               title = $3,
               supplier_name = $4,
               item_description = $5,
               quantity = $6,
               unit_price = $7,
               total_amount = $8,
               currency = $9,
               requested_delivery_date = $10,
               attachment_id = $11,
               description = $12,
               updated_at = now()
             WHERE pr.tenant_id = $1 AND pr.id = $2
             RETURNING ${sqlColumns}`,
            [
              tenantId,
              id,
              title,
              supplierName,
              itemDescription,
              quantity,
              unitPrice,
              totalAmount,
              currency,
              requestedDeliveryDate,
              attachmentId,
              description,
            ],
          );

      const updated = mapPurchaseRequestRow(result.rows[0]);

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'purchase_request.updated',
        targetType: 'purchase_request',
        targetId: updated.id,
        beforeData: mapPurchaseRequestRow(current),
        afterData: updated,
      });

      return updated;
    });
  }

  /**
   * 発注申請の削除 (draftのみ物理削除)
   */
  async delete(tenantId: string, userId: string, id: string): Promise<void> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'purchase_request.edit');

      const sqlColumns = await this.getColumns(client);
      const existing = await client.query<PurchaseRequestRow>(
        `SELECT ${sqlColumns}
         FROM purchase_requests pr
         WHERE pr.tenant_id = $1 AND pr.id = $2`,
        [tenantId, id],
      );
      if (existing.rowCount === 0) {
        throw AppException.notFound('指定された発注申請が見つかりません');
      }
      const current = existing.rows[0];
      if (current.status !== 'draft') {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          `draft状態の発注申請のみ削除可能です (現在: ${current.status})`,
        );
      }

      await client.query(`DELETE FROM purchase_requests WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        id,
      ]);

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'purchase_request.deleted',
        targetType: 'purchase_request',
        targetId: id,
        beforeData: mapPurchaseRequestRow(current),
      });
    });
  }

  /**
   * 発注申請の承認申請を起票する。
   *
   * 1人テナント運用とSoDの両立設計 (contracts/general_requests踏襲):
   * - テナント内で purchase_request 向けの有効な承認ルールが存在しない場合:
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
  ): Promise<PurchaseRequestDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'purchase_request.create');

      const sqlColumns = await this.getColumns(client);
      const existing = await client.query<PurchaseRequestRow>(
        `SELECT ${sqlColumns}
         FROM purchase_requests pr
         WHERE pr.tenant_id = $1 AND pr.id = $2`,
        [tenantId, id],
      );
      if (existing.rowCount === 0) {
        throw AppException.notFound('指定された発注申請が見つかりません');
      }
      const current = existing.rows[0];
      if (current.status !== 'draft' && current.status !== 'rejected') {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          `draft または rejected 状態の発注申請のみ申請可能です (現在: ${current.status})`,
        );
      }

      // purchase_request 向けの有効な承認ルールの取得
      const rulesResult = await client.query<{
        step_number: number;
        is_explicit_auto_approve: boolean;
      }>(
        `SELECT step_number, is_explicit_auto_approve
         FROM approval_rules
         WHERE tenant_id = $1 AND target_type = 'purchase_request' AND is_active = TRUE
         ORDER BY step_number ASC`,
        [tenantId],
      );

      if (!rulesResult.rowCount || rulesResult.rowCount === 0) {
        // 承認ルールが未設定の場合はエラー (SoDの偶発的無効化を防止)
        throw AppException.badRequest(
          '発注申請の承認ルールが設定されていません。承認ルールの設定を行ってください',
        );
      }

      // 明示的な0-step自動承認ルール (is_explicit_auto_approve = TRUE) の確認 (1人テナント運用)
      const autoApproveRule = rulesResult.rows.find((r) => r.is_explicit_auto_approve);
      if (autoApproveRule) {
        const updateResult = await client.query<PurchaseRequestRow>(
          `UPDATE purchase_requests pr
           SET status = 'active', approved_at = now(), updated_at = now()
           WHERE pr.tenant_id = $1 AND pr.id = $2
           RETURNING ${sqlColumns}`,
          [tenantId, id],
        );
        const activeRequest = mapPurchaseRequestRow(updateResult.rows[0]);

        await this.auditLogs.record(client, tenantId, {
          actorUserId: userId,
          action: 'purchase_request.auto_approved',
          targetType: 'purchase_request',
          targetId: id,
          afterData: { status: 'active', auto_approved: true },
        });

        return activeRequest;
      }

      // 承認ステップ >= 1: 最大ステップ数を total_steps として pending_approval へ遷移し起票
      const totalSteps = Math.max(...rulesResult.rows.map((r) => r.step_number));
      const updateResult = await client.query<PurchaseRequestRow>(
        `UPDATE purchase_requests pr
         SET status = 'pending_approval', updated_at = now()
         WHERE pr.tenant_id = $1 AND pr.id = $2
         RETURNING ${sqlColumns}`,
        [tenantId, id],
      );
      const pendingRequest = mapPurchaseRequestRow(updateResult.rows[0]);

      await client.query(
        `INSERT INTO approval_requests (
           tenant_id, target_type, target_id, submitted_by, total_steps, current_step, status
         ) VALUES (
           $1, 'purchase_request', $2, $3, $4, 1, 'pending'
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
        action: 'purchase_request.submitted_for_approval',
        targetType: 'purchase_request',
        targetId: id,
        afterData: { status: 'pending_approval', total_steps: totalSteps },
      });

      return pendingRequest;
    });
  }

  /**
   * 発注申請の解約・取消 (activeからterminatedへの遷移)
   */
  async terminate(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<PurchaseRequestDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'purchase_request.terminate');

      const sqlColumns = await this.getColumns(client);
      const existing = await client.query<PurchaseRequestRow>(
        `SELECT ${sqlColumns}
         FROM purchase_requests pr
         WHERE pr.tenant_id = $1 AND pr.id = $2`,
        [tenantId, id],
      );
      if (existing.rowCount === 0) {
        throw AppException.notFound('指定された発注申請が見つかりません');
      }
      const current = existing.rows[0];
      if (current.status !== 'active') {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          `active状態の発注申請のみ解約・取消処理が可能です (現在: ${current.status})`,
        );
      }

      const result = await client.query<PurchaseRequestRow>(
        `UPDATE purchase_requests pr
         SET status = 'terminated', updated_at = now()
         WHERE pr.tenant_id = $1 AND pr.id = $2
         RETURNING ${sqlColumns}`,
        [tenantId, id],
      );

      const terminated = mapPurchaseRequestRow(result.rows[0]);

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'purchase_request.terminated',
        targetType: 'purchase_request',
        targetId: id,
        beforeData: { status: current.status },
        afterData: { status: 'terminated' },
      });

      return terminated;
    });
  }
}
