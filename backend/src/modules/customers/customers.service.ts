import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import type { components } from '../../types/api.generated';
import type { CustomerCreateInput } from './dto/customer.schemas';

export type CustomerDto = components['schemas']['Customer'];

export interface CustomerListQuery {
  page: number;
  page_size: number;
  q?: string;
}

interface CustomerRow {
  id: string;
  code: string;
  name: string;
  kana_name: string | null;
  is_active: boolean;
}

function mapCustomerRow(row: CustomerRow): CustomerDto {
  return { id: row.id, code: row.code, name: row.name, kana_name: row.kana_name, is_active: row.is_active };
}

const CUSTOMER_COLUMNS = 'id, code, name, kana_name, is_active';

/** 顧客マスタCRUD(`docs/openapi.yaml` `tags: [Customers]`) */
@Injectable()
export class CustomersService {
  constructor(private readonly db: DatabaseService) {}

  async list(
    tenantId: string,
    userId: string | null,
    query: CustomerListQuery,
  ): Promise<{ customers: CustomerDto[]; pagination: PaginationMeta }> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const conditions: string[] = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];
      if (query.q) {
        params.push(`%${query.q}%`);
        conditions.push(`(name ILIKE $${params.length} OR kana_name ILIKE $${params.length})`);
      }
      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM customers WHERE ${whereClause}`,
        params,
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const listParams = [...params, query.page_size, (query.page - 1) * query.page_size];
      const result = await client.query<CustomerRow>(
        `SELECT id, code, name, kana_name, is_active
         FROM customers
         WHERE ${whereClause}
         ORDER BY code ASC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      return {
        customers: result.rows.map(mapCustomerRow),
        pagination: buildPagination(query.page, query.page_size, totalCount),
      };
    });
  }

  async findById(tenantId: string, userId: string | null, id: string): Promise<CustomerDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<CustomerRow>(
        `SELECT ${CUSTOMER_COLUMNS} FROM customers WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      const row = result.rows[0];
      if (!row) {
        throw AppException.notFound('指定された顧客が見つかりません');
      }
      return mapCustomerRow(row);
    });
  }

  async create(tenantId: string, userId: string | null, dto: CustomerCreateInput): Promise<CustomerDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<CustomerRow>(
        `INSERT INTO customers (tenant_id, code, name, kana_name)
         VALUES ($1, $2, $3, $4)
         RETURNING ${CUSTOMER_COLUMNS}`,
        [tenantId, dto.code, dto.name, dto.kana_name ?? null],
      );
      return mapCustomerRow(result.rows[0]);
    });
  }

  async update(
    tenantId: string,
    userId: string | null,
    id: string,
    dto: CustomerCreateInput,
  ): Promise<CustomerDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<CustomerRow>(
        `UPDATE customers
         SET code = $3, name = $4, kana_name = $5, updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING ${CUSTOMER_COLUMNS}`,
        [tenantId, id, dto.code, dto.name, dto.kana_name ?? null],
      );
      const row = result.rows[0];
      if (!row) {
        throw AppException.notFound('指定された顧客が見つかりません');
      }
      return mapCustomerRow(row);
    });
  }
}
