import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import type { components } from '../../types/api.generated';
import type { AccountCreateInput, AccountUpdateInput } from './dto/account.schemas';

export type AccountDto = components['schemas']['Account'];

export interface AccountListQuery {
  page: number;
  page_size: number;
  account_type?: string;
  is_active?: boolean;
}

interface AccountRow {
  id: string;
  code: string;
  name: string;
  category_id: string | null;
  account_type: string;
  normal_balance: 'debit' | 'credit';
  parent_account_id: string | null;
  default_tax_category_code: string | null;
  allow_manual_entry: boolean;
  is_active: boolean;
}

function mapAccountRow(row: AccountRow): AccountDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category_id: row.category_id,
    account_type: row.account_type as AccountDto['account_type'],
    normal_balance: row.normal_balance,
    parent_account_id: row.parent_account_id,
    default_tax_category_code: row.default_tax_category_code,
    allow_manual_entry: row.allow_manual_entry,
    is_active: row.is_active,
  };
}

const ACCOUNT_COLUMNS =
  'id, code, name, category_id, account_type, normal_balance, parent_account_id, default_tax_category_code, allow_manual_entry, is_active';

/** `docs/openapi.yaml` `tags: [Accounts]` の勘定科目マスタCRUDを実装する */
@Injectable()
export class AccountsService {
  constructor(private readonly db: DatabaseService) {}

  async list(
    tenantId: string,
    userId: string | null,
    query: AccountListQuery,
  ): Promise<{ accounts: AccountDto[]; pagination: PaginationMeta }> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const conditions: string[] = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];

      if (query.account_type) {
        params.push(query.account_type);
        conditions.push(`account_type = $${params.length}`);
      }
      if (query.is_active !== undefined) {
        params.push(query.is_active);
        conditions.push(`is_active = $${params.length}`);
      }

      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM accounts WHERE ${whereClause}`,
        params,
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const listParams = [...params, query.page_size, (query.page - 1) * query.page_size];
      const result = await client.query<AccountRow>(
        `SELECT id, code, name, category_id, account_type, normal_balance, parent_account_id, default_tax_category_code, allow_manual_entry, is_active
         FROM accounts
         WHERE ${whereClause}
         ORDER BY code ASC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      return {
        accounts: result.rows.map(mapAccountRow),
        pagination: buildPagination(query.page, query.page_size, totalCount),
      };
    });
  }

  async findById(tenantId: string, userId: string | null, id: string): Promise<AccountDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<AccountRow>(
        `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      const row = result.rows[0];
      if (!row) {
        throw AppException.notFound('指定された勘定科目が見つかりません');
      }
      return mapAccountRow(row);
    });
  }

  async create(tenantId: string, userId: string | null, dto: AccountCreateInput): Promise<AccountDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<AccountRow>(
        `INSERT INTO accounts (
           tenant_id, code, name, category_id, account_type, normal_balance,
           parent_account_id, default_tax_category_code, allow_manual_entry
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${ACCOUNT_COLUMNS}`,
        [
          tenantId,
          dto.code,
          dto.name,
          dto.category_id ?? null,
          dto.account_type,
          dto.normal_balance,
          dto.parent_account_id ?? null,
          dto.default_tax_category_code ?? null,
          dto.allow_manual_entry,
        ],
      );
      return mapAccountRow(result.rows[0]);
    });
  }

  async update(
    tenantId: string,
    userId: string | null,
    id: string,
    dto: AccountUpdateInput,
  ): Promise<AccountDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM accounts WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (existing.rowCount === 0) {
        throw AppException.notFound('指定された勘定科目が見つかりません');
      }

      const setClauses: string[] = [];
      const params: unknown[] = [tenantId, id];

      if (dto.name !== undefined) {
        params.push(dto.name);
        setClauses.push(`name = $${params.length}`);
      }
      if (dto.category_id !== undefined) {
        params.push(dto.category_id);
        setClauses.push(`category_id = $${params.length}`);
      }
      if (dto.allow_manual_entry !== undefined) {
        params.push(dto.allow_manual_entry);
        setClauses.push(`allow_manual_entry = $${params.length}`);
      }
      if (dto.is_active !== undefined) {
        params.push(dto.is_active);
        setClauses.push(`is_active = $${params.length}`);
      }
      setClauses.push('updated_at = now()');

      const result = await client.query<AccountRow>(
        `UPDATE accounts SET ${setClauses.join(', ')}
         WHERE tenant_id = $1 AND id = $2
         RETURNING ${ACCOUNT_COLUMNS}`,
        params,
      );
      return mapAccountRow(result.rows[0]);
    });
  }
}
