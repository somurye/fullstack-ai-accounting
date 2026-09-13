import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type {
  EmployeeCreateInput,
  EmployeeListQuery,
  EmployeeUpdateInput,
} from './dto/employee.schemas';
import {
  mapEmployeeRow,
  type EmployeeDto,
  type EmployeeRow,
} from './employees.mapper';

export interface EmployeeListResult {
  employees: EmployeeDto[];
  pagination: PaginationMeta;
}

@Injectable()
export class EmployeesService {
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
   * 従業員一覧取得 (RLS + テナント絞り込み)
   */
  async list(
    tenantId: string,
    userId: string | null,
    query: EmployeeListQuery,
  ): Promise<EmployeeListResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'employee.view');

      const conditions: string[] = ['e.tenant_id = $1'];
      const params: unknown[] = [tenantId];

      if (query.status) {
        params.push(query.status);
        conditions.push(`e.status = $${params.length}`);
      }

      if (query.department_id) {
        params.push(query.department_id);
        conditions.push(`e.department_id = $${params.length}`);
      }

      if (query.search) {
        params.push(`%${query.search}%`);
        const idx = params.length;
        conditions.push(`(e.name ILIKE $${idx} OR e.employee_no ILIKE $${idx})`);
      }

      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM employees e
         WHERE ${whereClause}`,
        params,
      );
      const totalCount = parseInt(countResult.rows[0]?.count ?? '0', 10);

      const page = query.page ?? 1;
      const limit = query.limit ?? 20;
      const offset = (page - 1) * limit;
      const dataParams = [...params, limit, offset];
      const dataResult = await client.query<EmployeeRow>(
        `SELECT e.*, d.name AS department_name
         FROM employees e
         LEFT JOIN departments d ON d.id = e.department_id
         WHERE ${whereClause}
         ORDER BY e.employee_no ASC
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams,
      );

      const employees = dataResult.rows.map(mapEmployeeRow);
      const pagination = buildPagination(page, limit, totalCount);

      return { employees, pagination };
    });
  }

  /**
   * 従業員詳細取得
   */
  async getById(
    tenantId: string,
    userId: string | null,
    id: string,
  ): Promise<EmployeeDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'employee.view');

      const result = await client.query<EmployeeRow>(
        `SELECT e.*, d.name AS department_name
         FROM employees e
         LEFT JOIN departments d ON d.id = e.department_id
         WHERE e.tenant_id = $1 AND e.id = $2
         LIMIT 1`,
        [tenantId, id],
      );

      const row = result.rows[0];
      if (!row) {
        throw AppException.notFound('指定された従業員が見つかりません');
      }

      return mapEmployeeRow(row);
    });
  }

  /**
   * 従業員新規登録
   */
  async create(
    tenantId: string,
    userId: string | null,
    input: EmployeeCreateInput,
  ): Promise<EmployeeDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'employee.create');

      // 社員番号の重複チェック
      const dupCheck = await client.query(
        `SELECT id FROM employees WHERE tenant_id = $1 AND employee_no = $2 LIMIT 1`,
        [tenantId, input.employee_no],
      );
      if ((dupCheck.rowCount ?? 0) > 0) {
        throw AppException.badRequest(`社員番号「${input.employee_no}」は既に使用されています`);
      }

      const insertResult = await client.query<EmployeeRow>(
        `INSERT INTO employees (
           tenant_id, user_id, employee_no, name, department_id,
           hire_date, employment_type, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          tenantId,
          input.user_id ?? null,
          input.employee_no,
          input.name,
          input.department_id ?? null,
          input.hire_date,
          input.employment_type,
          input.status,
        ],
      );

      const created = insertResult.rows[0];
      if (!created) {
        throw AppException.badRequest('従業員の登録に失敗しました');
      }

      // 部門名取得
      let departmentName: string | null = null;
      if (created.department_id) {
        const deptRes = await client.query<{ name: string }>(
          `SELECT name FROM departments WHERE id = $1`,
          [created.department_id],
        );
        departmentName = deptRes.rows[0]?.name ?? null;
      }
      created.department_name = departmentName;

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'employee.created',
        targetType: 'employee',
        targetId: created.id,
        afterData: {
          employee_no: created.employee_no,
          name: created.name,
          status: created.status,
        },
      });

      return mapEmployeeRow(created);
    });
  }

  /**
   * 従業員更新
   */
  async update(
    tenantId: string,
    userId: string | null,
    id: string,
    input: EmployeeUpdateInput,
  ): Promise<EmployeeDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'employee.edit');

      const existingRes = await client.query<EmployeeRow>(
        `SELECT * FROM employees WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, id],
      );
      const existing = existingRes.rows[0];
      if (!existing) {
        throw AppException.notFound('指定された従業員が見つかりません');
      }

      const sets: string[] = ['updated_at = now()'];
      const params: unknown[] = [tenantId, id];

      if (input.name !== undefined) {
        params.push(input.name);
        sets.push(`name = $${params.length}`);
      }
      if (input.user_id !== undefined) {
        params.push(input.user_id);
        sets.push(`user_id = $${params.length}`);
      }
      if (input.department_id !== undefined) {
        params.push(input.department_id);
        sets.push(`department_id = $${params.length}`);
      }
      if (input.hire_date !== undefined) {
        params.push(input.hire_date);
        sets.push(`hire_date = $${params.length}`);
      }
      if (input.employment_type !== undefined) {
        params.push(input.employment_type);
        sets.push(`employment_type = $${params.length}`);
      }
      if (input.status !== undefined) {
        params.push(input.status);
        sets.push(`status = $${params.length}`);
      }

      const updateResult = await client.query<EmployeeRow>(
        `UPDATE employees
         SET ${sets.join(', ')}
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        params,
      );

      const updated = updateResult.rows[0];
      if (!updated) {
        throw AppException.badRequest('従業員の更新に失敗しました');
      }

      let departmentName: string | null = null;
      if (updated.department_id) {
        const deptRes = await client.query<{ name: string }>(
          `SELECT name FROM departments WHERE id = $1`,
          [updated.department_id],
        );
        departmentName = deptRes.rows[0]?.name ?? null;
      }
      updated.department_name = departmentName;

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'employee.updated',
        targetType: 'employee',
        targetId: updated.id,
        beforeData: {
          name: existing.name,
          status: existing.status,
        },
        afterData: {
          name: updated.name,
          status: updated.status,
        },
      });

      return mapEmployeeRow(updated);
    });
  }
}
