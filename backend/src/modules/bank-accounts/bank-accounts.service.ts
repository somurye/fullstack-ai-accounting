import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { DatabaseService } from '../../database/database.service';
import type { components } from '../../types/api.generated';
import type { BankAccountCreateInput, BankAccountListQuery } from './dto/bank-account.schemas';

export type BankAccountDto = components['schemas']['BankAccount'];

interface BankAccountRow {
  id: string;
  bank_name: string;
  bank_code: string | null;
  branch_name: string | null;
  branch_code: string | null;
  account_type: 'ordinary' | 'checking';
  account_number: string;
  account_holder_kana: string | null;
  currency_code: string;
  opening_balance: string;
  linked_account_id: string | null;
  is_active: boolean;
}

const BANK_ACCOUNT_COLUMNS =
  'id, bank_name, bank_code, branch_name, branch_code, account_type, account_number, account_holder_kana, currency_code, opening_balance, linked_account_id, is_active';

function mapBankAccountRow(row: BankAccountRow): BankAccountDto {
  return {
    id: row.id,
    bank_name: row.bank_name,
    bank_code: row.bank_code,
    branch_name: row.branch_name,
    branch_code: row.branch_code,
    account_type: row.account_type,
    account_number: row.account_number,
    account_holder_kana: row.account_holder_kana,
    currency_code: row.currency_code,
    opening_balance: Number(row.opening_balance),
    linked_account_id: row.linked_account_id,
    is_active: row.is_active,
  };
}

/** 銀行口座マスタCRUD(`docs/openapi.yaml` `tags: [BankAccounts]`) */
@Injectable()
export class BankAccountsService {
  constructor(private readonly db: DatabaseService) {}

  async list(
    tenantId: string,
    userId: string | null,
    query: BankAccountListQuery,
  ): Promise<{ bankAccounts: BankAccountDto[]; pagination: PaginationMeta }> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM bank_accounts WHERE tenant_id = $1`,
        [tenantId],
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const result = await client.query<BankAccountRow>(
        `SELECT ${BANK_ACCOUNT_COLUMNS} FROM bank_accounts
         WHERE tenant_id = $1
         ORDER BY bank_name ASC, branch_name ASC
         LIMIT $2 OFFSET $3`,
        [tenantId, query.page_size, (query.page - 1) * query.page_size],
      );

      return {
        bankAccounts: result.rows.map(mapBankAccountRow),
        pagination: buildPagination(query.page, query.page_size, totalCount),
      };
    });
  }

  async findById(tenantId: string, userId: string | null, id: string): Promise<BankAccountDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<BankAccountRow>(
        `SELECT ${BANK_ACCOUNT_COLUMNS} FROM bank_accounts WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      const row = result.rows[0];
      if (!row) {
        throw AppException.notFound('指定された銀行口座が見つかりません');
      }
      return mapBankAccountRow(row);
    });
  }

  async create(
    tenantId: string,
    userId: string | null,
    dto: BankAccountCreateInput,
  ): Promise<BankAccountDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<BankAccountRow>(
        `INSERT INTO bank_accounts (
           tenant_id, bank_name, bank_code, branch_name, branch_code, account_type,
           account_number, account_holder_kana, currency_code, opening_balance, linked_account_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING ${BANK_ACCOUNT_COLUMNS}`,
        [
          tenantId,
          dto.bank_name,
          dto.bank_code ?? null,
          dto.branch_name ?? null,
          dto.branch_code ?? null,
          dto.account_type,
          dto.account_number,
          dto.account_holder_kana ?? null,
          dto.currency_code,
          dto.opening_balance,
          dto.linked_account_id ?? null,
        ],
      );
      return mapBankAccountRow(result.rows[0]);
    });
  }

  async update(
    tenantId: string,
    userId: string | null,
    id: string,
    dto: BankAccountCreateInput,
  ): Promise<BankAccountDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<BankAccountRow>(
        `UPDATE bank_accounts
         SET bank_name = $3, bank_code = $4, branch_name = $5, branch_code = $6, account_type = $7,
             account_number = $8, account_holder_kana = $9, currency_code = $10, opening_balance = $11,
             linked_account_id = $12, updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING ${BANK_ACCOUNT_COLUMNS}`,
        [
          tenantId,
          id,
          dto.bank_name,
          dto.bank_code ?? null,
          dto.branch_name ?? null,
          dto.branch_code ?? null,
          dto.account_type,
          dto.account_number,
          dto.account_holder_kana ?? null,
          dto.currency_code,
          dto.opening_balance,
          dto.linked_account_id ?? null,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw AppException.notFound('指定された銀行口座が見つかりません');
      }
      return mapBankAccountRow(row);
    });
  }
}
