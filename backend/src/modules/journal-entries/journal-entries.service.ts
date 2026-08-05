import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { generateJournalEntryNo } from '../../common/journal/generate-entry-no';
import { AiSuggestionsService } from '../ai-suggestions/ai-suggestions.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type {
  JournalEntryCreateInput,
  JournalEntryLineCreateInput,
  JournalEntryListQuery,
  JournalEntryReverseInput,
  JournalEntryUpdateInput,
  JournalEntryVoidInput,
} from './dto/journal-entry.schemas';
import {
  mapJournalEntryLineRow,
  mapJournalEntryRow,
  SQL_COLUMNS,
  type JournalEntryDto,
  type JournalEntryLineDto,
  type JournalEntryLineRow,
  type JournalEntryRow,
} from './journal-entries.mapper';

export interface JournalEntryListResult {
  entries: JournalEntryDto[];
  pagination: PaginationMeta;
}

/**
 * JournalEntriesService
 * =====================
 * 仕訳(journal_entries / journal_entry_lines)に対するCRUD + 業務アクション
 * (post/void/reverse)を生SQLで実装する。
 *
 * 状態遷移の正当性(draft以外の編集禁止・貸借一致・void時間窓・追記専用性)は
 * 可能な限り `sql/001_initial_schema_all_in_one.sql` のDBトリガーに委ね、
 * 本サービスは「どのUPDATE/INSERT文を実行するか」の組み立てに専念する
 * (トリガー由来のPostgreSQLエラーは `HttpExceptionFilter` + `pg-error-mapper`
 *  が自動的にAPIエラーへ変換するため、本サービスでの try/catch は不要)。
 *
 * ただし、DBトリガーが状態を検証しないケース(void/reverseはpostedの仕訳にのみ
 * 許可されるべきだが、トリガー側はdraftからのvoid遷移を妨げない、reverseは
 * 新規INSERTのみで元仕訳のUPDATEを伴わないためトリガーが一切介在しない)は、
 * アプリケーション層で明示的に事前検証している。
 */
@Injectable()
export class JournalEntriesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly aiSuggestions: AiSuggestionsService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async list(
    tenantId: string,
    userId: string | null,
    query: JournalEntryListQuery,
  ): Promise<JournalEntryListResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const conditions: string[] = ['je.tenant_id = $1'];
      const params: unknown[] = [tenantId];

      if (query.status) {
        params.push(query.status);
        conditions.push(`je.status = $${params.length}`);
      }
      if (query.entry_date_from) {
        params.push(query.entry_date_from);
        conditions.push(`je.entry_date >= $${params.length}`);
      }
      if (query.entry_date_to) {
        params.push(query.entry_date_to);
        conditions.push(`je.entry_date <= $${params.length}`);
      }
      if (query.source_type) {
        params.push(query.source_type);
        conditions.push(`je.source_type = $${params.length}`);
      }
      if (query.account_id) {
        params.push(query.account_id);
        conditions.push(
          `EXISTS (SELECT 1 FROM journal_entry_lines jel WHERE jel.tenant_id = $1 AND jel.journal_entry_id = je.id AND jel.account_id = $${params.length})`,
        );
      }

      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM journal_entries je WHERE ${whereClause}`,
        params,
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const page = query.page;
      const pageSize = query.page_size;
      const offset = (page - 1) * pageSize;
      const listParams = [...params, pageSize, offset];

      const entriesResult = await client.query<JournalEntryRow>(
        `SELECT ${SQL_COLUMNS.journalEntry}
         FROM journal_entries je
         WHERE ${whereClause}
         ORDER BY je.entry_date DESC, je.entry_no DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      const entryIds = entriesResult.rows.map((row) => row.id);
      const linesByEntryId = await this.fetchLinesForEntries(client, tenantId, entryIds);

      const entries = entriesResult.rows.map((row) =>
        mapJournalEntryRow(row, linesByEntryId.get(row.id) ?? []),
      );

      return { entries, pagination: buildPagination(page, pageSize, totalCount) };
    });
  }

  async findById(tenantId: string, userId: string | null, id: string): Promise<JournalEntryDto> {
    return this.db.transaction(tenantId, userId, (client) => this.fetchEntry(client, tenantId, id));
  }

  async create(
    tenantId: string,
    userId: string,
    dto: JournalEntryCreateInput,
  ): Promise<JournalEntryDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const entryNo = await generateJournalEntryNo(client, tenantId, dto.entry_date);

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO journal_entries
           (tenant_id, entry_no, entry_date, fiscal_period_id, description, status, source_type, currency_code, exchange_rate, created_by)
         VALUES ($1, $2, $3, $4, $5, 'draft', 'manual', $6, $7, $8)
         RETURNING id`,
        [
          tenantId,
          entryNo,
          dto.entry_date,
          dto.fiscal_period_id ?? null,
          dto.description ?? null,
          dto.currency_code,
          dto.exchange_rate,
          userId,
        ],
      );
      const entryId = inserted.rows[0].id;

      await this.insertLines(client, tenantId, entryId, dto.lines);
      await this.maybeGenerateAiSuggestion(client, tenantId, entryId, dto);

      return this.fetchEntry(client, tenantId, entryId);
    });
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    dto: JournalEntryUpdateInput,
  ): Promise<JournalEntryDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      // entry_date/descriptionが未指定でもUPDATE自体は常に発行し、
      // `trg_guard_journal_entry_transition` トリガーがdraft以外を一貫して拒否できるようにする。
      const updated = await client.query<{ id: string }>(
        `UPDATE journal_entries
         SET entry_date = COALESCE($3, entry_date),
             description = COALESCE($4, description)
         WHERE tenant_id = $1 AND id = $2
         RETURNING id`,
        [tenantId, id, dto.entry_date ?? null, dto.description ?? null],
      );
      if (updated.rowCount === 0) {
        throw AppException.notFound('指定された仕訳が見つかりません');
      }

      if (dto.lines) {
        await client.query(
          `DELETE FROM journal_entry_lines WHERE tenant_id = $1 AND journal_entry_id = $2`,
          [tenantId, id],
        );
        await this.insertLines(client, tenantId, id, dto.lines);
      }

      return this.fetchEntry(client, tenantId, id);
    });
  }

  /**
   * 仕訳を確定する。`approval_rules`(target_type='journal_entry')に有効な承認ルールが
   * 存在する場合は、`vendor-bills`モジュールと同じ方針で直接postedにはせず、
   * 先に`pending_approval`へ遷移させ承認依頼(`approval_requests`)を作成する
   * (`docs/openapi.yaml` の `POST /journal-entries/{id}/post` に明記された挙動)。
   * 全承認完了後の`posted`遷移は `approval-requests` モジュールが担う。
   *
   * 承認ルールが1件も無い場合は「承認不要」として即座にpostedへ確定する
   * (この場合も監査証跡として`approval_requests`に`approved`済みの1レコードを残す。
   * `vendor-bills.service.ts` の `submit()` と同じ設計判断)。
   */
  async post(tenantId: string, userId: string, id: string): Promise<JournalEntryDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      // `FOR UPDATE`により、同じ仕訳への同時 `addLine()` 呼び出しと直列化する。
      // `journal_entry_lines` のINSERTはDBトリガーで保護されない(コメント参照)ため、
      // 「addLineがdraftと判定した直後にpost()がposted化する」TOCTOUを
      // アプリ層の行ロックで防止する必要がある。
      const current = await client.query<{ status: string }>(
        `SELECT status FROM journal_entries WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, id],
      );
      if (current.rowCount === 0) {
        throw AppException.notFound('指定された仕訳が見つかりません');
      }
      if (current.rows[0].status !== 'draft') {
        throw AppException.conflict('INVALID_STATE_TRANSITION', 'draft状態の仕訳のみ確定できます');
      }

      const activeRules = await client.query<{ max_step: number }>(
        `SELECT COALESCE(MAX(step_number), 0)::int AS max_step FROM approval_rules
         WHERE tenant_id = $1 AND target_type = 'journal_entry' AND is_active = TRUE`,
        [tenantId],
      );
      const totalSteps = activeRules.rows[0].max_step;

      if (totalSteps === 0) {
        await client.query(
          `UPDATE journal_entries SET status = 'posted', posted_by = $3 WHERE tenant_id = $1 AND id = $2`,
          [tenantId, id, userId],
        );
        await client.query(
          `INSERT INTO approval_requests (tenant_id, target_type, target_id, submitted_by, total_steps, current_step, status)
           VALUES ($1, 'journal_entry', $2, $3, 1, 1, 'approved')`,
          [tenantId, id, userId],
        );

        await this.auditLogs.record(client, tenantId, {
          actorUserId: userId,
          action: 'journal_entry.posted',
          targetType: 'journal_entry',
          targetId: id,
          afterData: { status: 'posted' },
        });
      } else {
        await client.query(
          `UPDATE journal_entries SET status = 'pending_approval' WHERE tenant_id = $1 AND id = $2`,
          [tenantId, id],
        );
        await client.query(
          `INSERT INTO approval_requests (tenant_id, target_type, target_id, submitted_by, total_steps, current_step, status)
           VALUES ($1, 'journal_entry', $2, $3, $4, 1, 'pending')`,
          [tenantId, id, userId, totalSteps],
        );

        await this.auditLogs.record(client, tenantId, {
          actorUserId: userId,
          action: 'journal_entry.submitted',
          targetType: 'journal_entry',
          targetId: id,
          afterData: { status: 'pending_approval' },
        });
      }

      return this.fetchEntry(client, tenantId, id);
    });
  }

  async listLines(
    tenantId: string,
    userId: string | null,
    id: string,
  ): Promise<JournalEntryLineDto[]> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const entryResult = await client.query(
        `SELECT id FROM journal_entries WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (entryResult.rowCount === 0) {
        throw AppException.notFound('指定された仕訳が見つかりません');
      }
      const linesResult = await client.query<JournalEntryLineRow>(
        `SELECT ${SQL_COLUMNS.journalEntryLine}
         FROM journal_entry_lines
         WHERE tenant_id = $1 AND journal_entry_id = $2
         ORDER BY line_no ASC`,
        [tenantId, id],
      );
      return linesResult.rows.map(mapJournalEntryLineRow);
    });
  }

  /**
   * 仕訳明細を1行追加する(draft状態のみ)。`journal_entry_lines`のINSERTには
   * `fn_prevent_modify_nondraft_journal_lines`トリガーが適用されない(UPDATE/DELETEのみ対象)ため、
   * draft判定はここで明示的に行う。
   */
  async addLine(
    tenantId: string,
    userId: string,
    id: string,
    dto: JournalEntryLineCreateInput,
  ): Promise<JournalEntryLineDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      // `FOR UPDATE`により、同じ仕訳への同時 `post()` 呼び出しと直列化する(上記コメント参照)。
      const entryResult = await client.query<{ status: string }>(
        `SELECT status FROM journal_entries WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, id],
      );
      if (entryResult.rowCount === 0) {
        throw AppException.notFound('指定された仕訳が見つかりません');
      }
      if (entryResult.rows[0].status !== 'draft') {
        throw AppException.conflict('INVALID_STATE_TRANSITION', 'draft状態の仕訳のみ明細を追加できます');
      }

      const nextLineNoResult = await client.query<{ next_line_no: number }>(
        `SELECT COALESCE(MAX(line_no), 0)::int + 1 AS next_line_no
         FROM journal_entry_lines WHERE tenant_id = $1 AND journal_entry_id = $2`,
        [tenantId, id],
      );
      const lineNo = nextLineNoResult.rows[0].next_line_no;

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO journal_entry_lines
           (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount, tax_category_id, department_id, customer_id, vendor_id, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          tenantId,
          id,
          lineNo,
          dto.account_id,
          dto.debit_credit,
          dto.amount,
          dto.tax_category_id ?? null,
          dto.department_id ?? null,
          dto.customer_id ?? null,
          dto.vendor_id ?? null,
          dto.description ?? null,
        ],
      );

      const lineResult = await client.query<JournalEntryLineRow>(
        `SELECT ${SQL_COLUMNS.journalEntryLine} FROM journal_entry_lines WHERE tenant_id = $1 AND id = $2`,
        [tenantId, inserted.rows[0].id],
      );
      return mapJournalEntryLineRow(lineResult.rows[0]);
    });
  }

  /**
   * 仕訳明細を1行削除する。draft以外は`fn_prevent_modify_nondraft_journal_lines`トリガーが
   * DELETEを拒否する(`APPEND_ONLY_VIOLATION`へマッピング)ため、アプリ層での事前検証は行わない。
   */
  async deleteLine(tenantId: string, userId: string, id: string, lineId: string): Promise<void> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query(
        `DELETE FROM journal_entry_lines WHERE tenant_id = $1 AND journal_entry_id = $2 AND id = $3`,
        [tenantId, id, lineId],
      );
      if (result.rowCount === 0) {
        throw AppException.notFound('指定された仕訳明細が見つかりません');
      }
    });
  }

  async voidEntry(
    tenantId: string,
    userId: string,
    id: string,
    _dto: JournalEntryVoidInput,
  ): Promise<JournalEntryDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const current = await client.query<{ status: string }>(
        `SELECT status FROM journal_entries WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (current.rowCount === 0) {
        throw AppException.notFound('指定された仕訳が見つかりません');
      }
      // DBトリガーはdraftからのvoid遷移を妨げないため、確定済み(posted)であることをここで検証する。
      if (current.rows[0].status !== 'posted') {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          '確定済み(posted)の仕訳のみvoid(即時取消)できます',
        );
      }

      await client.query(
        `UPDATE journal_entries
         SET status = 'voided', voided_by = $3, voided_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id, userId],
      );

      return this.fetchEntry(client, tenantId, id);
    });
  }

  async reverse(
    tenantId: string,
    userId: string,
    id: string,
    dto: JournalEntryReverseInput,
  ): Promise<JournalEntryDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const original = await client.query<{ status: string }>(
        `SELECT status FROM journal_entries WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (original.rowCount === 0) {
        throw AppException.notFound('指定された仕訳が見つかりません');
      }
      // reverseは元仕訳をUPDATEしないためDBトリガーが一切介在しない。ここで確定済みであることを検証する。
      if (original.rows[0].status !== 'posted') {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          '確定済み(posted)の仕訳のみ反対仕訳を起票できます',
        );
      }

      const originalLines = await client.query<JournalEntryLineRow>(
        `SELECT ${SQL_COLUMNS.journalEntryLine}
         FROM journal_entry_lines
         WHERE tenant_id = $1 AND journal_entry_id = $2
         ORDER BY line_no ASC`,
        [tenantId, id],
      );

      const entryDate = dto.entry_date ?? new Date().toISOString().slice(0, 10);
      const entryNo = await generateJournalEntryNo(client, tenantId, entryDate);

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO journal_entries
           (tenant_id, entry_no, entry_date, description, status, source_type, source_id, reversal_of_entry_id, created_by)
         VALUES ($1, $2, $3, $4, 'draft', 'reversal', $5, $5, $6)
         RETURNING id`,
        [tenantId, entryNo, entryDate, dto.reason, id, userId],
      );
      const newEntryId = inserted.rows[0].id;

      let lineNo = 1;
      for (const line of originalLines.rows) {
        const flippedDebitCredit = line.debit_credit === 'debit' ? 'credit' : 'debit';
        await client.query(
          `INSERT INTO journal_entry_lines
             (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount, tax_category_id, tax_amount, department_id, customer_id, vendor_id, description)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            tenantId,
            newEntryId,
            lineNo++,
            line.account_id,
            flippedDebitCredit,
            line.amount,
            line.tax_category_id,
            line.tax_amount,
            line.department_id,
            line.customer_id,
            line.vendor_id,
            line.description,
          ],
        );
      }

      return this.fetchEntry(client, tenantId, newEntryId);
    });
  }

  // --------------------------------------------------------------------------
  // 内部ヘルパー
  // --------------------------------------------------------------------------

  private async fetchEntry(
    client: PoolClient,
    tenantId: string,
    id: string,
  ): Promise<JournalEntryDto> {
    const entryResult = await client.query<JournalEntryRow>(
      `SELECT ${SQL_COLUMNS.journalEntry} FROM journal_entries je WHERE je.tenant_id = $1 AND je.id = $2`,
      [tenantId, id],
    );
    const entryRow = entryResult.rows[0];
    if (!entryRow) {
      throw AppException.notFound('指定された仕訳が見つかりません');
    }

    const linesResult = await client.query<JournalEntryLineRow>(
      `SELECT ${SQL_COLUMNS.journalEntryLine}
       FROM journal_entry_lines
       WHERE tenant_id = $1 AND journal_entry_id = $2
       ORDER BY line_no ASC`,
      [tenantId, id],
    );

    return mapJournalEntryRow(entryRow, linesResult.rows.map(mapJournalEntryLineRow));
  }

  private async fetchLinesForEntries(
    client: PoolClient,
    tenantId: string,
    entryIds: string[],
  ): Promise<Map<string, JournalEntryLineDto[]>> {
    const linesByEntryId = new Map<string, JournalEntryLineDto[]>();
    if (entryIds.length === 0) {
      return linesByEntryId;
    }

    const linesResult = await client.query<JournalEntryLineRow>(
      `SELECT ${SQL_COLUMNS.journalEntryLine}
       FROM journal_entry_lines
       WHERE tenant_id = $1 AND journal_entry_id = ANY($2::uuid[])
       ORDER BY journal_entry_id, line_no ASC`,
      [tenantId, entryIds],
    );

    for (const row of linesResult.rows) {
      const list = linesByEntryId.get(row.journal_entry_id) ?? [];
      list.push(mapJournalEntryLineRow(row));
      linesByEntryId.set(row.journal_entry_id, list);
    }
    return linesByEntryId;
  }

  /**
   * 新規草案仕訳のうち、最も金額の大きい明細行を「主たる分類対象」とみなし、
   * 過去の確定仕訳との類似度検索エンジン(AiSuggestionsService)による科目再提案を
   * 起動する。ユーザーが選択済みの科目とAIの一致度が高い場合(=指摘なし)は
   * 提案自体が生成されない(AiSuggestionsService側の判定)。
   */
  private async maybeGenerateAiSuggestion(
    client: PoolClient,
    tenantId: string,
    entryId: string,
    dto: JournalEntryCreateInput,
  ): Promise<void> {
    if (dto.lines.length === 0) return;

    let maxLine = dto.lines[0];
    let maxLineNo = 1;
    dto.lines.forEach((line, index) => {
      if (line.amount > maxLine.amount) {
        maxLine = line;
        maxLineNo = index + 1;
      }
    });

    const accountResult = await client.query<{ account_type: string }>(
      `SELECT account_type FROM accounts WHERE tenant_id = $1 AND id = $2`,
      [tenantId, maxLine.account_id],
    );
    const accountType = accountResult.rows[0]?.account_type;
    if (!accountType) return;

    const queryText = maxLine.description ?? dto.description ?? '';
    await this.aiSuggestions.generateJournalEntrySuggestion(
      client,
      tenantId,
      entryId,
      maxLineNo,
      accountType,
      maxLine.account_id,
      queryText,
    );
  }

  private async insertLines(
    client: PoolClient,
    tenantId: string,
    journalEntryId: string,
    lines: JournalEntryCreateInput['lines'],
  ): Promise<void> {
    let lineNo = 1;
    for (const line of lines) {
      await client.query(
        `INSERT INTO journal_entry_lines
           (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount, tax_category_id, department_id, customer_id, vendor_id, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          tenantId,
          journalEntryId,
          lineNo++,
          line.account_id,
          line.debit_credit,
          line.amount,
          line.tax_category_id ?? null,
          line.department_id ?? null,
          line.customer_id ?? null,
          line.vendor_id ?? null,
          line.description ?? null,
        ],
      );
    }
  }
}
