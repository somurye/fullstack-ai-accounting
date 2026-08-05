import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';

/**
 * ExpenseCategoryDto
 * `docs/openapi.yaml` にはExpenseCategoryのスキーマ/エンドポイントが定義されていないが、
 * 経費精算フォームの費目カテゴリ選択、および経費申請の先行仕訳自動起票時の
 * 借方科目解決(`default_account_id`)に必要なため、最小限の一覧取得APIとして追加する。
 */
export interface ExpenseCategoryDto {
  id: string;
  code: string;
  name: string;
  default_account_id: string | null;
  requires_receipt: boolean;
  monthly_limit_amount: number | null;
  is_active: boolean;
}

export interface ExpenseCategoryListQuery {
  page: number;
  page_size: number;
}

interface ExpenseCategoryRow {
  id: string;
  code: string;
  name: string;
  default_account_id: string | null;
  requires_receipt: boolean;
  monthly_limit_amount: string | null;
  is_active: boolean;
}

function mapExpenseCategoryRow(row: ExpenseCategoryRow): ExpenseCategoryDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    default_account_id: row.default_account_id,
    requires_receipt: row.requires_receipt,
    monthly_limit_amount: row.monthly_limit_amount !== null ? Number(row.monthly_limit_amount) : null,
    is_active: row.is_active,
  };
}

@Injectable()
export class ExpenseCategoriesService {
  constructor(private readonly db: DatabaseService) {}

  async list(
    tenantId: string,
    userId: string | null,
    query: ExpenseCategoryListQuery,
  ): Promise<{ categories: ExpenseCategoryDto[]; pagination: PaginationMeta }> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM expense_categories WHERE tenant_id = $1`,
        [tenantId],
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const result = await client.query<ExpenseCategoryRow>(
        `SELECT id, code, name, default_account_id, requires_receipt, monthly_limit_amount, is_active
         FROM expense_categories
         WHERE tenant_id = $1
         ORDER BY code ASC
         LIMIT $2 OFFSET $3`,
        [tenantId, query.page_size, (query.page - 1) * query.page_size],
      );

      return {
        categories: result.rows.map(mapExpenseCategoryRow),
        pagination: buildPagination(query.page, query.page_size, totalCount),
      };
    });
  }
}
