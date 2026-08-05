import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import type { components } from '../../types/api.generated';
import type { DepartmentCreateInput } from './dto/department.schemas';

export type DepartmentDto = components['schemas']['Department'];

export interface DepartmentListQuery {
  page: number;
  page_size: number;
}

interface DepartmentRow {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

function mapDepartmentRow(row: DepartmentRow): DepartmentDto {
  return { id: row.id, code: row.code, name: row.name, is_active: row.is_active };
}

/** 部門マスタCRUD(`docs/openapi.yaml` `tags: [Departments]`) */
@Injectable()
export class DepartmentsService {
  constructor(private readonly db: DatabaseService) {}

  async list(
    tenantId: string,
    userId: string | null,
    query: DepartmentListQuery,
  ): Promise<{ departments: DepartmentDto[]; pagination: PaginationMeta }> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM departments WHERE tenant_id = $1`,
        [tenantId],
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const result = await client.query<DepartmentRow>(
        `SELECT id, code, name, is_active
         FROM departments
         WHERE tenant_id = $1
         ORDER BY code ASC
         LIMIT $2 OFFSET $3`,
        [tenantId, query.page_size, (query.page - 1) * query.page_size],
      );

      return {
        departments: result.rows.map(mapDepartmentRow),
        pagination: buildPagination(query.page, query.page_size, totalCount),
      };
    });
  }

  async create(
    tenantId: string,
    userId: string | null,
    dto: DepartmentCreateInput,
  ): Promise<DepartmentDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<DepartmentRow>(
        `INSERT INTO departments (tenant_id, code, name, is_active)
         VALUES ($1, $2, $3, $4)
         RETURNING id, code, name, is_active`,
        [tenantId, dto.code, dto.name, dto.is_active],
      );
      return mapDepartmentRow(result.rows[0]);
    });
  }

  async update(
    tenantId: string,
    userId: string | null,
    id: string,
    dto: DepartmentCreateInput,
  ): Promise<DepartmentDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<DepartmentRow>(
        `UPDATE departments
         SET code = $3, name = $4, is_active = $5
         WHERE tenant_id = $1 AND id = $2
         RETURNING id, code, name, is_active`,
        [tenantId, id, dto.code, dto.name, dto.is_active],
      );
      const row = result.rows[0];
      if (!row) {
        throw AppException.notFound('指定された部門が見つかりません');
      }
      return mapDepartmentRow(row);
    });
  }
}
