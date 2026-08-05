import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { DatabaseService } from '../../database/database.service';
import type { components } from '../../types/api.generated';
import type {
  AutoJournalRuleCreateInput,
  AutoJournalRuleListQuery,
} from './dto/auto-journal-rule.schemas';

export type AutoJournalRuleDto = components['schemas']['AutoJournalRule'];

export interface AutoJournalRuleRow {
  id: string;
  rule_name: string;
  priority: number;
  source: 'bank' | 'card';
  match_pattern: string;
  min_amount: string | null;
  max_amount: string | null;
  debit_account_id: string | null;
  credit_account_id: string | null;
  is_active: boolean;
}

export const AUTO_JOURNAL_RULE_COLUMNS =
  'id, rule_name, priority, source, match_pattern, min_amount, max_amount, debit_account_id, credit_account_id, is_active';

export function mapAutoJournalRuleRow(row: AutoJournalRuleRow): AutoJournalRuleDto {
  return {
    id: row.id,
    rule_name: row.rule_name,
    priority: row.priority,
    source: row.source,
    match_pattern: row.match_pattern,
    min_amount: row.min_amount !== null ? Number(row.min_amount) : null,
    max_amount: row.max_amount !== null ? Number(row.max_amount) : null,
    debit_account_id: row.debit_account_id,
    credit_account_id: row.credit_account_id,
    is_active: row.is_active,
  };
}

/**
 * AutoJournalRulesService
 * =======================
 * 自動仕訳ルール(`docs/openapi.yaml` `tags: [AutoJournalRules]`)のCRUD。
 * ルール自体の評価ロジック(明細への適用)は `bank-transactions.service.ts` の
 * `tryAutoMatchByRules` が担う(ルールマスタの管理と評価実行を関心事として分離)。
 */
@Injectable()
export class AutoJournalRulesService {
  constructor(private readonly db: DatabaseService) {}

  async list(
    tenantId: string,
    userId: string | null,
    query: AutoJournalRuleListQuery,
  ): Promise<{ rules: AutoJournalRuleDto[]; pagination: PaginationMeta }> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const conditions: string[] = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];

      if (query.source) {
        params.push(query.source);
        conditions.push(`source = $${params.length}`);
      }
      if (query.is_active !== undefined) {
        params.push(query.is_active);
        conditions.push(`is_active = $${params.length}`);
      }
      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM auto_journal_rules WHERE ${whereClause}`,
        params,
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const listParams = [...params, query.page_size, (query.page - 1) * query.page_size];
      const result = await client.query<AutoJournalRuleRow>(
        `SELECT ${AUTO_JOURNAL_RULE_COLUMNS} FROM auto_journal_rules
         WHERE ${whereClause}
         ORDER BY priority ASC, created_at ASC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      return {
        rules: result.rows.map(mapAutoJournalRuleRow),
        pagination: buildPagination(query.page, query.page_size, totalCount),
      };
    });
  }

  async create(
    tenantId: string,
    userId: string | null,
    dto: AutoJournalRuleCreateInput,
  ): Promise<AutoJournalRuleDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<AutoJournalRuleRow>(
        `INSERT INTO auto_journal_rules (
           tenant_id, rule_name, priority, source, match_pattern, min_amount, max_amount,
           debit_account_id, credit_account_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${AUTO_JOURNAL_RULE_COLUMNS}`,
        [
          tenantId,
          dto.rule_name,
          dto.priority,
          dto.source,
          dto.match_pattern,
          dto.min_amount ?? null,
          dto.max_amount ?? null,
          dto.debit_account_id ?? null,
          dto.credit_account_id ?? null,
        ],
      );
      return mapAutoJournalRuleRow(result.rows[0]);
    });
  }

  async update(
    tenantId: string,
    userId: string | null,
    id: string,
    dto: AutoJournalRuleCreateInput,
  ): Promise<AutoJournalRuleDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<AutoJournalRuleRow>(
        `UPDATE auto_journal_rules
         SET rule_name = $3, priority = $4, source = $5, match_pattern = $6, min_amount = $7,
             max_amount = $8, debit_account_id = $9, credit_account_id = $10
         WHERE tenant_id = $1 AND id = $2
         RETURNING ${AUTO_JOURNAL_RULE_COLUMNS}`,
        [
          tenantId,
          id,
          dto.rule_name,
          dto.priority,
          dto.source,
          dto.match_pattern,
          dto.min_amount ?? null,
          dto.max_amount ?? null,
          dto.debit_account_id ?? null,
          dto.credit_account_id ?? null,
        ],
      );
      const row = result.rows[0];
      if (!row) {
        throw AppException.notFound('指定された自動仕訳ルールが見つかりません');
      }
      return mapAutoJournalRuleRow(row);
    });
  }

  /** 物理削除は行わず `is_active = false` へ更新する(`docs/openapi.yaml` 記載の挙動)。 */
  async deactivate(tenantId: string, userId: string | null, id: string): Promise<void> {
    await this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query(
        `UPDATE auto_journal_rules SET is_active = FALSE WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (result.rowCount === 0) {
        throw AppException.notFound('指定された自動仕訳ルールが見つかりません');
      }
    });
  }
}
