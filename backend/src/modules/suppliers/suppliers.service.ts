import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type {
  SupplierCreateInput,
  SupplierListQuery,
  SupplierUpdateInput,
} from './dto/supplier.schemas';
import {
  mapSupplierRow,
  SUPPLIER_COLUMNS,
  type SupplierDto,
  type SupplierRow,
} from './suppliers.mapper';

export interface SupplierListResult {
  suppliers: SupplierDto[];
  pagination: PaginationMeta;
}

@Injectable()
export class SuppliersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
  ) {}

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
    if ((permCheck.rowCount ?? 0) === 0) {
      throw AppException.forbidden(`この操作を行う権限(${permissionCode})がありません`);
    }
  }

  /**
   * サプライヤー一覧取得 (RLS + テナント絞り込み)
   */
  async list(
    tenantId: string,
    userId: string | null,
    query: SupplierListQuery,
  ): Promise<SupplierListResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      // 閲覧権限確認 (二重防御)
      await this.assertUserPermission(client, tenantId, userId, 'supplier.view');

      const conditions: string[] = ['s.tenant_id = $1'];
      const params: unknown[] = [tenantId];

      if (query.status) {
        params.push(query.status);
        conditions.push(`s.status = $${params.length}`);
      }

      if (query.search) {
        params.push(`%${query.search}%`);
        const idx = params.length;
        conditions.push(
          `(s.name ILIKE $${idx} OR s.contact_name ILIKE $${idx} OR s.contact_email ILIKE $${idx})`,
        );
      }

      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM suppliers s WHERE ${whereClause}`,
        params,
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const listParams = [...params, query.page_size, (query.page - 1) * query.page_size];
      const rowsResult = await client.query<SupplierRow>(
        `SELECT ${SUPPLIER_COLUMNS}
         FROM suppliers s
         WHERE ${whereClause}
         ORDER BY s.created_at DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      return {
        suppliers: rowsResult.rows.map(mapSupplierRow),
        pagination: buildPagination(query.page, query.page_size, totalCount),
      };
    });
  }

  /**
   * サプライヤー詳細取得
   */
  async getById(tenantId: string, userId: string | null, id: string): Promise<SupplierDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'supplier.view');

      const { rows } = await client.query<SupplierRow>(
        `SELECT ${SUPPLIER_COLUMNS}
         FROM suppliers s
         WHERE s.tenant_id = $1 AND s.id = $2`,
        [tenantId, id],
      );

      if (rows.length === 0) {
        throw AppException.notFound('サプライヤーが見つかりません');
      }

      return mapSupplierRow(rows[0]);
    });
  }

  /**
   * サプライヤー新規登録
   */
  async create(
    tenantId: string,
    userId: string,
    input: SupplierCreateInput,
  ): Promise<SupplierDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'supplier.create');

      // 同名サプライヤーの重複確認
      const dupCheck = await client.query<{ id: string }>(
        `SELECT id FROM suppliers WHERE tenant_id = $1 AND name = $2 LIMIT 1`,
        [tenantId, input.name],
      );
      if (dupCheck.rows.length > 0) {
        throw AppException.conflict('SUPPLIER_NAME_DUPLICATE', `同名のサプライヤー「${input.name}」は既に登録されています`);
      }

      const { rows } = await client.query<SupplierRow>(
        `INSERT INTO suppliers AS s (
           tenant_id, name, contact_name, contact_email,
           contact_phone, payment_terms, status, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${SUPPLIER_COLUMNS}`,
        [
          tenantId,
          input.name,
          input.contact_name ?? null,
          input.contact_email ?? null,
          input.contact_phone ?? null,
          input.payment_terms ?? null,
          input.status ?? 'active',
          userId,
        ],
      );

      const created = mapSupplierRow(rows[0]);

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'supplier.created',
        targetType: 'supplier',
        targetId: created.id,
        afterData: {
          name: created.name,
          contact_name: created.contact_name,
          status: created.status,
        },
      });

      return created;
    });
  }

  /**
   * サプライヤー情報更新
   */
  async update(
    tenantId: string,
    userId: string,
    id: string,
    input: SupplierUpdateInput,
  ): Promise<SupplierDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'supplier.edit');

      // 存在確認
      const existingRes = await client.query<SupplierRow>(
        `SELECT ${SUPPLIER_COLUMNS} FROM suppliers s WHERE s.tenant_id = $1 AND s.id = $2 FOR UPDATE`,
        [tenantId, id],
      );
      if (existingRes.rows.length === 0) {
        throw AppException.notFound('サプライヤーが見つかりません');
      }
      const existing = existingRes.rows[0];

      // 名前変更時の重複確認
      if (input.name && input.name !== existing.name) {
        const dupCheck = await client.query<{ id: string }>(
          `SELECT id FROM suppliers WHERE tenant_id = $1 AND name = $2 AND id != $3 LIMIT 1`,
          [tenantId, input.name, id],
        );
        if (dupCheck.rows.length > 0) {
          throw AppException.conflict('SUPPLIER_NAME_DUPLICATE', `同名のサプライヤー「${input.name}」は既に登録されています`);
        }
      }

      const newName = input.name ?? existing.name;
      const newContactName = input.contact_name !== undefined ? input.contact_name : existing.contact_name;
      const newContactEmail = input.contact_email !== undefined ? input.contact_email : existing.contact_email;
      const newContactPhone = input.contact_phone !== undefined ? input.contact_phone : existing.contact_phone;
      const newPaymentTerms = input.payment_terms !== undefined ? input.payment_terms : existing.payment_terms;
      const newStatus = input.status ?? existing.status;

      const { rows } = await client.query<SupplierRow>(
        `UPDATE suppliers s
         SET name = $3,
             contact_name = $4,
             contact_email = $5,
             contact_phone = $6,
             payment_terms = $7,
             status = $8,
             updated_at = now()
         WHERE s.tenant_id = $1 AND s.id = $2
         RETURNING ${SUPPLIER_COLUMNS}`,
        [
          tenantId,
          id,
          newName,
          newContactName,
          newContactEmail,
          newContactPhone,
          newPaymentTerms,
          newStatus,
        ],
      );

      const updated = mapSupplierRow(rows[0]);

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'supplier.updated',
        targetType: 'supplier',
        targetId: updated.id,
        beforeData: {
          name: existing.name,
          contact_name: existing.contact_name,
          status: existing.status,
        },
        afterData: {
          name: updated.name,
          contact_name: updated.contact_name,
          status: updated.status,
        },
      });

      return updated;
    });
  }
}
