import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { parseCsv } from '../../common/csv/parse-csv';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { generateJournalEntryNo } from '../../common/journal/generate-entry-no';
import { DatabaseService } from '../../database/database.service';
import {
  AUTO_JOURNAL_RULE_COLUMNS,
  type AutoJournalRuleRow,
} from '../auto-journal-rules/auto-journal-rules.service';
import { AiSuggestionsService } from '../ai-suggestions/ai-suggestions.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { InvoicesService } from '../invoices/invoices.service';
import { VendorBillsService } from '../vendor-bills/vendor-bills.service';
import type {
  BankTransactionImportCsvFields,
  BankTransactionListQuery,
  BankTransactionMatchInput,
} from './dto/bank-transaction.schemas';
import {
  BANK_TRANSACTION_COLUMNS,
  mapBankTransactionRow,
  type BankTransactionDto,
  type BankTransactionRow,
} from './bank-transactions.mapper';

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

export interface ImportCsvResult {
  imported_count: number;
  duplicate_skipped_count: number;
  auto_matched_count: number;
  transactions: BankTransactionDto[];
}

interface ColumnMapping {
  date?: string;
  description?: string;
  amount?: string;
  deposit?: string;
  withdrawal?: string;
  balance?: string;
}

const DATE_HEADER_ALIASES = ['date', 'transaction_date', '取引日', '日付', 'お取引日'];
const DESCRIPTION_HEADER_ALIASES = ['description', '摘要', '摘要欄', '内容'];
const AMOUNT_HEADER_ALIASES = ['amount', '金額'];
const DEPOSIT_HEADER_ALIASES = ['deposit', '入金', '入金額', 'お預け入れ額', 'お預入れ額'];
const WITHDRAWAL_HEADER_ALIASES = ['withdrawal', '出金', '出金額', 'お引き出し額', 'お引出し額'];
const BALANCE_HEADER_ALIASES = ['balance', 'balance_after', '残高', '差引残高'];

function findHeader(record: Record<string, string>, explicit: string | undefined, aliases: string[]): string | null {
  if (explicit && explicit in record) return explicit;
  const keys = Object.keys(record);
  for (const alias of aliases) {
    const found = keys.find((k) => k.trim().toLowerCase() === alias.toLowerCase());
    if (found) return found;
  }
  return null;
}

function normalizeDate(raw: string): string | null {
  const trimmed = raw.trim();
  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.trim().replace(/[,¥\s]/g, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * BankTransactionsService
 * ========================
 * `docs/openapi.yaml` `tags: [BankTransactions]` を実装する。
 *
 * `POST /bank-transactions/{id}/match` は仕様上 `target_type`/`target_id` による
 * 既存レコードへの手動紐付けのみを定義しているが、本タスクで要求された
 * 「自動仕訳ルール評価 → 不適合時はpgvector類似度検索によるAI提案フォールバック」を
 * 同エンドポイントの後方互換な拡張として実装する。詳細は
 * `dto/bank-transaction.schemas.ts` の `bankTransactionMatchSchema` コメント参照。
 */
@Injectable()
export class BankTransactionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
    private readonly aiSuggestions: AiSuggestionsService,
    private readonly invoicesService: InvoicesService,
    private readonly vendorBillsService: VendorBillsService,
  ) {}

  async list(
    tenantId: string,
    userId: string | null,
    query: BankTransactionListQuery,
  ): Promise<{ transactions: BankTransactionDto[]; pagination: PaginationMeta }> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const conditions: string[] = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];

      if (query.bank_account_id) {
        params.push(query.bank_account_id);
        conditions.push(`bank_account_id = $${params.length}`);
      }
      if (query.match_status) {
        params.push(query.match_status);
        conditions.push(`match_status = $${params.length}`);
      }
      if (query.transaction_date_from) {
        params.push(query.transaction_date_from);
        conditions.push(`transaction_date >= $${params.length}`);
      }
      if (query.transaction_date_to) {
        params.push(query.transaction_date_to);
        conditions.push(`transaction_date <= $${params.length}`);
      }
      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM bank_transactions WHERE ${whereClause}`,
        params,
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const listParams = [...params, query.page_size, (query.page - 1) * query.page_size];
      const result = await client.query<BankTransactionRow>(
        `SELECT ${BANK_TRANSACTION_COLUMNS} FROM bank_transactions
         WHERE ${whereClause}
         ORDER BY transaction_date DESC, imported_at DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      return {
        transactions: result.rows.map(mapBankTransactionRow),
        pagination: buildPagination(query.page, query.page_size, totalCount),
      };
    });
  }

  async findById(tenantId: string, userId: string | null, id: string): Promise<BankTransactionDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const row = await this.fetchRow(client, tenantId, id);
      if (!row) {
        throw AppException.notFound('指定された銀行明細が見つかりません');
      }
      return mapBankTransactionRow(row);
    });
  }

  // --------------------------------------------------------------------------
  // CSV取込
  // --------------------------------------------------------------------------

  async importCsv(
    tenantId: string,
    userId: string,
    file: UploadedFileLike,
    fields: BankTransactionImportCsvFields,
  ): Promise<ImportCsvResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const bankAccountResult = await client.query<{ id: string; linked_account_id: string | null }>(
        `SELECT id, linked_account_id FROM bank_accounts WHERE tenant_id = $1 AND id = $2`,
        [tenantId, fields.bank_account_id],
      );
      if (bankAccountResult.rowCount === 0) {
        throw AppException.badRequest('指定された銀行口座が見つかりません');
      }

      const mapping = await this.resolveColumnMapping(client, tenantId, fields);
      const records = parseCsv(file.buffer.toString('utf8'));
      if (records.length === 0) {
        throw AppException.badRequest('CSVファイルに取込可能な明細行がありません', [
          { message: 'ヘッダー行の後に1件以上の明細行が必要です' },
        ]);
      }

      let importedCount = 0;
      let duplicateSkippedCount = 0;
      let autoMatchedCount = 0;
      const insertedTransactions: BankTransactionDto[] = [];

      for (const record of records) {
        const dateHeader = findHeader(record, mapping.date, DATE_HEADER_ALIASES);
        const descriptionHeader = findHeader(record, mapping.description, DESCRIPTION_HEADER_ALIASES);
        const amountHeader = findHeader(record, mapping.amount, AMOUNT_HEADER_ALIASES);
        const depositHeader = findHeader(record, mapping.deposit, DEPOSIT_HEADER_ALIASES);
        const withdrawalHeader = findHeader(record, mapping.withdrawal, WITHDRAWAL_HEADER_ALIASES);
        const balanceHeader = findHeader(record, mapping.balance, BALANCE_HEADER_ALIASES);

        if (!dateHeader) {
          throw AppException.badRequest(
            'CSVから取引日の列を特定できませんでした(date/取引日 等の列名、またはimport_profile_idの指定が必要です)',
          );
        }
        const transactionDate = normalizeDate(record[dateHeader]);
        if (!transactionDate) continue; // 空行・合計行等はスキップする

        let amount: number | null = null;
        if (amountHeader && record[amountHeader]) {
          amount = parseAmount(record[amountHeader]);
        } else {
          const deposit = depositHeader ? (parseAmount(record[depositHeader]) ?? 0) : 0;
          const withdrawal = withdrawalHeader ? (parseAmount(record[withdrawalHeader]) ?? 0) : 0;
          if (deposit !== 0 || withdrawal !== 0) {
            amount = deposit - Math.abs(withdrawal);
          }
        }
        if (amount === null || amount === 0) continue;

        const description = descriptionHeader ? record[descriptionHeader] || null : null;
        const balanceAfter = balanceHeader ? parseAmount(record[balanceHeader]) : null;

        const importHash = createHash('sha256')
          .update(`${fields.bank_account_id}|${transactionDate}|${amount}|${description ?? ''}`)
          .digest('hex');

        const insertResult = await client.query<BankTransactionRow>(
          `INSERT INTO bank_transactions
             (tenant_id, bank_account_id, transaction_date, description, amount, balance_after, import_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (bank_account_id, import_hash) DO NOTHING
           RETURNING ${BANK_TRANSACTION_COLUMNS}`,
          [tenantId, fields.bank_account_id, transactionDate, description, amount, balanceAfter, importHash],
        );

        if (insertResult.rowCount === 0) {
          duplicateSkippedCount++;
          continue;
        }

        importedCount++;
        let row = insertResult.rows[0];

        const ruleMatch = await this.tryAutoMatchByRules(client, tenantId, userId, row);
        if (ruleMatch) {
          autoMatchedCount++;
          row = ruleMatch;
        }
        insertedTransactions.push(mapBankTransactionRow(row));
      }

      return {
        imported_count: importedCount,
        duplicate_skipped_count: duplicateSkippedCount,
        auto_matched_count: autoMatchedCount,
        transactions: insertedTransactions,
      };
    });
  }

  private async resolveColumnMapping(
    client: PoolClient,
    tenantId: string,
    fields: BankTransactionImportCsvFields,
  ): Promise<ColumnMapping> {
    if (!fields.import_profile_id) return {};
    const result = await client.query<{ column_mapping: ColumnMapping }>(
      `SELECT column_mapping FROM bank_import_profiles
       WHERE tenant_id = $1 AND id = $2 AND bank_account_id = $3 AND is_active = TRUE`,
      [tenantId, fields.import_profile_id, fields.bank_account_id],
    );
    if (result.rowCount === 0) {
      throw AppException.badRequest('指定された取込プロファイル(import_profile_id)が見つかりません');
    }
    return result.rows[0].column_mapping ?? {};
  }

  // --------------------------------------------------------------------------
  // マッチング(手動紐付け / ルールエンジン / AI提案)
  // --------------------------------------------------------------------------

  async match(
    tenantId: string,
    userId: string,
    id: string,
    dto: BankTransactionMatchInput,
  ): Promise<BankTransactionDto> {
    const precheck = await this.db.transaction(tenantId, userId, async (client) => {
      const row = await this.fetchRow(client, tenantId, id);
      if (!row) throw AppException.notFound('指定された銀行明細が見つかりません');
      if (row.match_status !== 'unmatched') {
        throw AppException.conflict('ALREADY_MATCHED', 'この銀行明細は既に消込済みです');
      }
      return row;
    });

    // invoice/vendor_bill への手動紐付けは、それぞれの入金消込ロジック(自身のトランザクション内で
    // 仕訳作成・請求書ステータス更新まで一括で行う)をそのまま再利用する
    // (invoices/vendor-bills モジュールに同一ロジックを重複実装しないため)。
    // このため本メソッド全体を1トランザクションに包むことはできない。代わりに
    // `matchToArDocument` 内で先にCASにより明細を「claimed」状態へ遷移させてから
    // recordPaymentを呼び出すことで、二重の消込仕訳(=二重入金計上)を防止する
    // (詳細は `matchToArDocument` のコメント参照)。
    if (dto.target_type === 'invoice' || dto.target_type === 'vendor_bill') {
      return this.matchToArDocument(tenantId, userId, precheck, dto.target_type, dto.target_id as string);
    }

    return this.db.transaction(tenantId, userId, async (client) => {
      const tx = await this.fetchRowForUpdate(client, tenantId, id);
      if (!tx) throw AppException.notFound('指定された銀行明細が見つかりません');
      if (tx.match_status !== 'unmatched') {
        throw AppException.conflict('ALREADY_MATCHED', 'この銀行明細は既に消込済みです');
      }

      if (dto.target_type === 'journal_entry') {
        const je = await client.query<{ id: string; status: string }>(
          `SELECT id, status FROM journal_entries WHERE tenant_id = $1 AND id = $2`,
          [tenantId, dto.target_id],
        );
        if (je.rowCount === 0) {
          throw AppException.badRequest('指定された仕訳(journal_entry)が見つかりません');
        }
        if (je.rows[0].status !== 'posted') {
          throw AppException.conflict(
            'INVALID_STATE_TRANSITION',
            '確定済み(posted)の仕訳のみ銀行明細と紐付けできます',
          );
        }
        await this.applyMatch(client, tenantId, userId, tx.id, 'manually_matched', je.rows[0].id, {
          mode: 'journal_entry',
          target_id: dto.target_id,
        });
        return mapBankTransactionRow((await this.fetchRow(client, tenantId, tx.id))!);
      }

      const bankAccountResult = await client.query<{ linked_account_id: string | null }>(
        `SELECT linked_account_id FROM bank_accounts WHERE tenant_id = $1 AND id = $2`,
        [tenantId, tx.bank_account_id],
      );
      const linkedAccountId = bankAccountResult.rows[0]?.linked_account_id ?? null;

      if (dto.account_id) {
        if (!linkedAccountId) {
          throw AppException.badRequest(
            'この銀行口座には対応する現金預金勘定(linked_account_id)が設定されていないため消込仕訳を作成できません',
          );
        }
        const journalEntryId = await this.createSettlementJournalEntry(
          client,
          tenantId,
          userId,
          tx,
          dto.account_id,
          linkedAccountId,
          'manual',
          null,
        );
        await this.applyMatch(client, tenantId, userId, tx.id, 'manually_matched', journalEntryId, {
          mode: 'account_id',
          account_id: dto.account_id,
        });
        return mapBankTransactionRow((await this.fetchRow(client, tenantId, tx.id))!);
      }

      // 自動仕訳ルール評価 → 不適合ならAI提案(pgvector類似度検索)を生成する
      const matched = await this.tryAutoMatchByRules(client, tenantId, userId, tx);
      if (matched) {
        return mapBankTransactionRow(matched);
      }

      if (tx.description) {
        await this.aiSuggestions.generateBankTransactionSuggestion(client, tenantId, tx.id, tx.description);
      }
      return mapBankTransactionRow((await this.fetchRow(client, tenantId, tx.id))!);
    });
  }

  private async matchToArDocument(
    tenantId: string,
    userId: string,
    row: BankTransactionRow,
    targetType: 'invoice' | 'vendor_bill',
    targetId: string,
  ): Promise<BankTransactionDto> {
    // `recordPayment` は自身のトランザクション内で仕訳作成まで完結するため、
    // ここで先に明細をCASで 'unmatched' → 'manually_matched' へ claim してから
    // recordPaymentを呼び出す。claim自体がアトミックなので、同一明細に対する
    // 同時マッチングリクエストは片方がここで ALREADY_MATCHED として弾かれ、
    // 二重の消込仕訳(二重入金計上)が作られることはない。
    // (claim後にrecordPaymentが失敗した場合はclaimを解放し、明細をunmatchedへ戻す)
    await this.claimForMatch(tenantId, userId, row.id);

    const paymentDto = {
      payment_date: row.transaction_date,
      amount: Math.abs(Number(row.amount)),
      bank_transaction_id: row.id,
    };

    let journalEntryId: string | null | undefined;
    try {
      journalEntryId =
        targetType === 'invoice'
          ? (await this.invoicesService.recordPayment(tenantId, userId, targetId, paymentDto)).journal_entry_id
          : (await this.vendorBillsService.recordPayment(tenantId, userId, targetId, paymentDto))
              .journal_entry_id;

      if (!journalEntryId) {
        throw AppException.badRequest('消込仕訳の作成に失敗しました');
      }
    } catch (err) {
      await this.releaseClaim(tenantId, userId, row.id);
      throw err;
    }

    return this.db.transaction(tenantId, userId, async (client) => {
      await client.query(
        `UPDATE bank_transactions SET matched_journal_entry_id = $3 WHERE tenant_id = $1 AND id = $2`,
        [tenantId, row.id, journalEntryId],
      );
      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'bank_transaction.matched',
        targetType: 'bank_transaction',
        targetId: row.id,
        afterData: {
          match_status: 'manually_matched',
          journal_entry_id: journalEntryId,
          mode: targetType,
          target_id: targetId,
        },
      });
      return mapBankTransactionRow((await this.fetchRow(client, tenantId, row.id))!);
    });
  }

  /** CASで明細を 'unmatched' → 'manually_matched' へ排他確保する。既に確保済みならALREADY_MATCHEDを投げる。 */
  private async claimForMatch(tenantId: string, userId: string, id: string): Promise<void> {
    await this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query(
        `UPDATE bank_transactions SET match_status = 'manually_matched'
         WHERE tenant_id = $1 AND id = $2 AND match_status = 'unmatched'`,
        [tenantId, id],
      );
      if (result.rowCount === 0) {
        throw AppException.conflict('ALREADY_MATCHED', 'この銀行明細は既に消込済みです');
      }
    });
  }

  /** recordPayment失敗時、claim済みの明細をunmatchedへ戻す(仕訳が未作成のため安全に戻せる)。 */
  private async releaseClaim(tenantId: string, userId: string, id: string): Promise<void> {
    await this.db.transaction(tenantId, userId, async (client) => {
      await client.query(
        `UPDATE bank_transactions SET match_status = 'unmatched'
         WHERE tenant_id = $1 AND id = $2 AND match_status = 'manually_matched' AND matched_journal_entry_id IS NULL`,
        [tenantId, id],
      );
    });
  }

  /**
   * 有効な自動仕訳ルール(source='bank')を優先度順に評価し、最初に適合したルールで
   * 消込仕訳を自動作成する。銀行口座に `linked_account_id` が未設定、または適合する
   * ルールが存在しない場合は `null` を返す(呼び出し側は自身の処理を継続する)。
   *
   * 【ルール評価の規約】(schemas参照)
   *   - priorityは昇順(値が小さいほど優先)で評価する。
   *   - 入金(amount>0)にはcredit_account_id、出金(amount<0)にはdebit_account_idを
   *     相手勘定として使用する。該当する側が未設定のルールはスキップする。
   */
  private async tryAutoMatchByRules(
    client: PoolClient,
    tenantId: string,
    userId: string,
    tx: BankTransactionRow,
  ): Promise<BankTransactionRow | null> {
    const bankAccountResult = await client.query<{ linked_account_id: string | null }>(
      `SELECT linked_account_id FROM bank_accounts WHERE tenant_id = $1 AND id = $2`,
      [tenantId, tx.bank_account_id],
    );
    const linkedAccountId = bankAccountResult.rows[0]?.linked_account_id ?? null;
    if (!linkedAccountId) return null;

    const amount = Number(tx.amount);
    const rulesResult = await client.query<AutoJournalRuleRow>(
      `SELECT ${AUTO_JOURNAL_RULE_COLUMNS} FROM auto_journal_rules
       WHERE tenant_id = $1 AND source = 'bank' AND is_active = TRUE
       ORDER BY priority ASC, created_at ASC`,
      [tenantId],
    );

    for (const rule of rulesResult.rows) {
      if (!this.ruleMatches(rule, tx.description, amount)) continue;
      const counterAccountId = amount > 0 ? rule.credit_account_id : rule.debit_account_id;
      if (!counterAccountId) continue;

      const journalEntryId = await this.createSettlementJournalEntry(
        client,
        tenantId,
        userId,
        tx,
        counterAccountId,
        linkedAccountId,
        'bank_auto_rule',
        rule.id,
      );
      await this.applyMatch(client, tenantId, userId, tx.id, 'auto_matched', journalEntryId, {
        mode: 'auto_journal_rule',
        rule_id: rule.id,
        rule_name: rule.rule_name,
      });
      return (await this.fetchRow(client, tenantId, tx.id))!;
    }
    return null;
  }

  private ruleMatches(rule: AutoJournalRuleRow, description: string | null, amount: number): boolean {
    const absAmount = Math.abs(amount);
    if (rule.min_amount !== null && absAmount < Number(rule.min_amount)) return false;
    if (rule.max_amount !== null && absAmount > Number(rule.max_amount)) return false;

    const text = description ?? '';
    if (!rule.match_pattern) return true;
    try {
      return new RegExp(rule.match_pattern, 'i').test(text);
    } catch {
      return text.toLowerCase().includes(rule.match_pattern.toLowerCase());
    }
  }

  /**
   * 入金: 借方=銀行(資産増加) / 貸方=相手科目
   * 出金: 借方=相手科目 / 貸方=銀行(資産減少)
   * のいずれか2行構成のposted仕訳を作成し、生成されたjournal_entry.idを返す。
   */
  private async createSettlementJournalEntry(
    client: PoolClient,
    tenantId: string,
    userId: string,
    tx: BankTransactionRow,
    counterAccountId: string,
    bankLinkedAccountId: string,
    sourceType: string,
    sourceId: string | null,
  ): Promise<string> {
    const amount = Math.abs(Number(tx.amount));
    const isDeposit = Number(tx.amount) > 0;
    const entryNo = await generateJournalEntryNo(client, tenantId, tx.transaction_date);
    const description = tx.description ?? '銀行明細消込';

    const jeInsert = await client.query<{ id: string }>(
      `INSERT INTO journal_entries
         (tenant_id, entry_no, entry_date, description, status, source_type, source_id, created_by)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7)
       RETURNING id`,
      [tenantId, entryNo, tx.transaction_date, description, sourceType, sourceId, userId],
    );
    const journalEntryId = jeInsert.rows[0].id;

    const debitAccountId = isDeposit ? bankLinkedAccountId : counterAccountId;
    const creditAccountId = isDeposit ? counterAccountId : bankLinkedAccountId;

    await client.query(
      `INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount)
       VALUES ($1, $2, 1, $3, 'debit', $4)`,
      [tenantId, journalEntryId, debitAccountId, amount],
    );
    await client.query(
      `INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount)
       VALUES ($1, $2, 2, $3, 'credit', $4)`,
      [tenantId, journalEntryId, creditAccountId, amount],
    );
    await client.query(
      `UPDATE journal_entries SET status = 'posted', posted_by = $3 WHERE tenant_id = $1 AND id = $2`,
      [tenantId, journalEntryId, userId],
    );

    return journalEntryId;
  }

  private async applyMatch(
    client: PoolClient,
    tenantId: string,
    userId: string,
    bankTransactionId: string,
    matchStatus: 'auto_matched' | 'manually_matched',
    journalEntryId: string,
    auditDetail: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `UPDATE bank_transactions
       SET match_status = $3, matched_journal_entry_id = $4
       WHERE tenant_id = $1 AND id = $2 AND match_status = 'unmatched'`,
      [tenantId, bankTransactionId, matchStatus, journalEntryId],
    );
    await this.auditLogs.record(client, tenantId, {
      actorUserId: userId,
      action: 'bank_transaction.matched',
      targetType: 'bank_transaction',
      targetId: bankTransactionId,
      afterData: { match_status: matchStatus, journal_entry_id: journalEntryId, ...auditDetail },
    });
  }

  private async fetchRow(
    client: PoolClient,
    tenantId: string,
    id: string,
  ): Promise<BankTransactionRow | null> {
    const result = await client.query<BankTransactionRow>(
      `SELECT ${BANK_TRANSACTION_COLUMNS} FROM bank_transactions WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return result.rows[0] ?? null;
  }

  private async fetchRowForUpdate(
    client: PoolClient,
    tenantId: string,
    id: string,
  ): Promise<BankTransactionRow | null> {
    const result = await client.query<BankTransactionRow>(
      `SELECT ${BANK_TRANSACTION_COLUMNS} FROM bank_transactions WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, id],
    );
    return result.rows[0] ?? null;
  }
}
