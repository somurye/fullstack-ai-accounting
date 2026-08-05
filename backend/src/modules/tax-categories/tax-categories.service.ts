import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import type { components } from '../../types/api.generated';
import type { TaxCategoryCreateInput } from './dto/tax-category.schemas';

export type TaxCategoryDto = components['schemas']['TaxCategory'];

export interface TaxCategoryListQuery {
  page: number;
  page_size: number;
}

interface TaxCategoryRow {
  id: string;
  code: string;
  name: string;
  tax_type: string;
  tax_rate: string;
  is_reduced_rate: boolean;
  is_active: boolean;
}

function mapTaxCategoryRow(row: TaxCategoryRow): TaxCategoryDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    tax_type: row.tax_type as TaxCategoryDto['tax_type'],
    tax_rate: Number(row.tax_rate),
    is_reduced_rate: row.is_reduced_rate,
    is_active: row.is_active,
  };
}

const TAX_CATEGORY_COLUMNS = 'id, code, name, tax_type, tax_rate, is_reduced_rate, is_active';

/** 税区分マスタCRUD(`docs/openapi.yaml` `tags: [TaxCategories]`) */
@Injectable()
export class TaxCategoriesService {
  constructor(private readonly db: DatabaseService) {}

  async list(
    tenantId: string,
    userId: string | null,
    query: TaxCategoryListQuery,
  ): Promise<{ taxCategories: TaxCategoryDto[]; pagination: PaginationMeta }> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM tax_categories WHERE tenant_id = $1`,
        [tenantId],
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const result = await client.query<TaxCategoryRow>(
        `SELECT id, code, name, tax_type, tax_rate, is_reduced_rate, is_active
         FROM tax_categories
         WHERE tenant_id = $1
         ORDER BY code ASC
         LIMIT $2 OFFSET $3`,
        [tenantId, query.page_size, (query.page - 1) * query.page_size],
      );

      return {
        taxCategories: result.rows.map(mapTaxCategoryRow),
        pagination: buildPagination(query.page, query.page_size, totalCount),
      };
    });
  }

  async findById(tenantId: string, userId: string | null, id: string): Promise<TaxCategoryDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<TaxCategoryRow>(
        `SELECT ${TAX_CATEGORY_COLUMNS} FROM tax_categories WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      const row = result.rows[0];
      if (!row) {
        throw AppException.notFound('指定された税区分が見つかりません');
      }
      return mapTaxCategoryRow(row);
    });
  }

  async create(
    tenantId: string,
    userId: string | null,
    dto: TaxCategoryCreateInput,
  ): Promise<TaxCategoryDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<TaxCategoryRow>(
        `INSERT INTO tax_categories (tenant_id, code, name, tax_type, tax_rate, is_reduced_rate)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${TAX_CATEGORY_COLUMNS}`,
        [tenantId, dto.code, dto.name, dto.tax_type, dto.tax_rate, dto.is_reduced_rate],
      );
      return mapTaxCategoryRow(result.rows[0]);
    });
  }

  async update(
    tenantId: string,
    userId: string | null,
    id: string,
    dto: TaxCategoryCreateInput,
  ): Promise<TaxCategoryDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<TaxCategoryRow>(
        `UPDATE tax_categories
         SET code = $3, name = $4, tax_type = $5, tax_rate = $6, is_reduced_rate = $7
         WHERE tenant_id = $1 AND id = $2
         RETURNING ${TAX_CATEGORY_COLUMNS}`,
        [tenantId, id, dto.code, dto.name, dto.tax_type, dto.tax_rate, dto.is_reduced_rate],
      );
      const row = result.rows[0];
      if (!row) {
        throw AppException.notFound('指定された税区分が見つかりません');
      }
      return mapTaxCategoryRow(row);
    });
  }
}
