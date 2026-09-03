import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { acquireAdvisoryLock } from '../../common/database/advisory-lock';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { computeTextEmbedding, PSEUDO_EMBEDDING_MODEL, toVectorLiteral } from './embedding';
import {
  validateConfidenceScores,
  type AiSuggestionListQuery,
  type AiSuggestionRejectInput,
} from './dto/ai-suggestion.schemas';
import {
  AI_SUGGESTION_COLUMNS,
  mapAiSuggestionRow,
  type AiSuggestionDto,
  type AiSuggestionPayload,
  type AiSuggestionRow,
  type SuggestedField,
} from './ai-suggestions.mapper';

export interface AiSuggestionListResult {
  suggestions: AiSuggestionDto[];
  pagination: PaginationMeta;
}

export interface AccountCandidate {
  accountId: string;
  code: string;
  name: string;
  score: number;
}

const NEIGHBOR_LIMIT = 5;
const CANDIDATE_LIMIT = 3;

function round3(n: number): number {
  return Math.round(Math.max(0, Math.min(1, n)) * 1000) / 1000;
}

/**
 * AiSuggestionsService
 * ====================
 * AI提案(`ai_suggestions`)の検索・判定に加え、過去の確定仕訳(`journal_entry_embeddings`)を
 * pgvectorのコサイン距離で検索して勘定科目候補を算出する類似度検索エンジンを提供する。
 *
 * 【`ai_suggestions` は追記専用(UPDATE/DELETE禁止)であることへの対応】
 * `sql/001_initial_schema_all_in_one.sql` の `fn_prevent_update_delete` が
 * `ai_suggestions` へのUPDATE/DELETEを常に例外で拒否するため、`accept`/`reject` は
 * 既存行の `accepted` 列を書き換えるのではなく、**同一の
 * (target_type, target_id, suggestion_type) をキーとする新しい行を追記する**ことで
 * 「判定確定」を表現する(`consumption_tax_return_lines` の再計算バッチと同じ設計思想)。
 * 元の行(`accepted IS NULL`)はAIが最初に提示した内容の不変な記録として残り続け、
 * 判定結果は新しく追記された行(`accepted IS NOT NULL`)側で参照する。
 * 同一グループ内に `accepted IS NOT NULL` の行が既に存在する場合は「判定済み」とみなし、
 * 再度の accept/reject は 409 で拒否する。
 */
@Injectable()
export class AiSuggestionsService {
  constructor(private readonly db: DatabaseService) {}

  async list(
    tenantId: string,
    userId: string | null,
    query: AiSuggestionListQuery,
  ): Promise<AiSuggestionListResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const conditions: string[] = ['s.tenant_id = $1'];
      const params: unknown[] = [tenantId];

      if (query.target_type) {
        params.push(query.target_type);
        conditions.push(`s.target_type = $${params.length}`);
      }
      if (query.target_id) {
        params.push(query.target_id);
        conditions.push(`s.target_id = $${params.length}`);
      }
      if (query.suggestion_type) {
        params.push(query.suggestion_type);
        conditions.push(`s.suggestion_type = $${params.length}`);
      }

      if (query.accepted === undefined) {
        // openapi.yamlの記述通り「未判定のみ取得する場合は指定しない」がデフォルト挙動。
        // 判定確定は新規追記で表現されるため、「未判定」とは単に accepted IS NULL では
        // 不十分で、「同一グループに判定済み行が存在しない」ことまで確認する必要がある。
        conditions.push('s.accepted IS NULL');
        conditions.push(`NOT EXISTS (
          SELECT 1 FROM ai_suggestions s2
          WHERE s2.tenant_id = s.tenant_id
            AND s2.target_type = s.target_type
            AND s2.target_id = s.target_id
            AND s2.suggestion_type = s.suggestion_type
            AND s2.accepted IS NOT NULL
        )`);
      } else {
        params.push(query.accepted);
        conditions.push(`s.accepted = $${params.length}`);
      }

      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM ai_suggestions s WHERE ${whereClause}`,
        params,
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const listParams = [...params, query.page_size, (query.page - 1) * query.page_size];
      const result = await client.query<AiSuggestionRow>(
        `SELECT ${AI_SUGGESTION_COLUMNS} FROM ai_suggestions s
         WHERE ${whereClause}
         ORDER BY s.created_at DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      return {
        suggestions: result.rows.map(mapAiSuggestionRow),
        pagination: buildPagination(query.page, query.page_size, totalCount),
      };
    });
  }

  async findById(tenantId: string, userId: string | null, id: string): Promise<AiSuggestionDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const row = await this.fetchRawById(client, tenantId, id);
      if (!row) {
        throw AppException.notFound('指定されたAI提案が見つかりません');
      }
      return mapAiSuggestionRow(row);
    });
  }

  async accept(tenantId: string, userId: string, id: string): Promise<AiSuggestionDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const suggestion = await this.fetchRawById(client, tenantId, id);
      if (!suggestion) {
        throw AppException.notFound('指定されたAI提案が見つかりません');
      }
      // 同一提案グループ(target_type/target_id/suggestion_type)への同時
      // accept/reject呼び出しを直列化する。`isAlreadyDecided`はREAD COMMITTEDの
      // 単純なSELECTのため、ロック無しでは2つの同時トランザクションがどちらも
      // 「未判定」と読み取り、両方とも判定行を追記できてしまう(二重判定)。
      await this.lockDecisionGroup(client, tenantId, suggestion);
      if (await this.isAlreadyDecided(client, tenantId, suggestion)) {
        throw AppException.conflict('ALREADY_DECIDED', 'このAI提案は既に判定済みです');
      }

      // 対象の草案レコードへ候補内容を反映する決定的ロジック。対象が既にdraft以外へ
      // 遷移している場合はここで 409 CONFLICT を投げる(openapi.yaml記載の挙動)。
      await this.applySuggestion(client, tenantId, suggestion);

      const decided = await this.insertDecisionRow(client, tenantId, suggestion, true, null);
      return mapAiSuggestionRow(decided);
    });
  }

  async reject(
    tenantId: string,
    userId: string,
    id: string,
    dto: AiSuggestionRejectInput,
  ): Promise<AiSuggestionDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const suggestion = await this.fetchRawById(client, tenantId, id);
      if (!suggestion) {
        throw AppException.notFound('指定されたAI提案が見つかりません');
      }
      await this.lockDecisionGroup(client, tenantId, suggestion);
      if (await this.isAlreadyDecided(client, tenantId, suggestion)) {
        throw AppException.conflict('ALREADY_DECIDED', 'このAI提案は既に判定済みです');
      }

      const decided = await this.insertDecisionRow(
        client,
        tenantId,
        suggestion,
        false,
        dto.reason ?? null,
      );
      return mapAiSuggestionRow(decided);
    });
  }

  /** 同一提案グループへのaccept/reject同時呼び出しを直列化するアドバイザリロック。 */
  private async lockDecisionGroup(
    client: PoolClient,
    tenantId: string,
    suggestion: AiSuggestionRow,
  ): Promise<void> {
    await acquireAdvisoryLock(
      client,
      `ai_suggestion_decision:${tenantId}:${suggestion.target_type}:${suggestion.target_id}:${suggestion.suggestion_type}`,
    );
  }

  // ============================================================================
  // 類似度検索エンジン ＆ 提案自動生成(他モジュールから呼び出す公開API)
  // ============================================================================

  /**
   * 新規の草案仕訳(journal_entries)のうち、最も金額の大きい明細行を「主たる分類対象」とみなし、
   * 過去の確定仕訳との類似度検索により勘定科目を再提案する。AIの提案がユーザー入力済みの
   * 科目と一致する場合は(=指摘すべき内容がないため)提案を生成しない。
   */
  async generateJournalEntrySuggestion(
    client: PoolClient,
    tenantId: string,
    journalEntryId: string,
    lineNo: number,
    accountType: string,
    currentAccountId: string,
    queryText: string,
  ): Promise<void> {
    if (!queryText.trim()) return;

    const candidates = await this.findAccountCandidates(client, tenantId, queryText, [accountType]);
    if (candidates.length === 0) return;

    const top = candidates[0];
    if (top.accountId === currentAccountId) return;

    await this.insertSuggestion(client, tenantId, 'journal_entry', journalEntryId, 'account_code', {
      suggested_account_code: top.code,
      target_line_no: lineNo,
      candidates: candidates.map((c) => ({ code: c.code, name: c.name, score: round3(c.score) })),
    }, round3(top.score));
  }

  /**
   * 銀行明細(bank_transactions)に対し、自動仕訳ルールが適合しなかった場合のフォールバックとして、
   * 過去の確定仕訳との類似度検索により相手勘定科目を提案する(`bank-transactions.service.ts` の
   * `match()` 未指定呼び出し時に使用)。account_typeによる絞り込みは行わない
   * (銀行明細の相手勘定は収益・費用に限らず資産・負債にもなり得るため)。
   */
  async generateBankTransactionSuggestion(
    client: PoolClient,
    tenantId: string,
    bankTransactionId: string,
    queryText: string,
  ): Promise<void> {
    if (!queryText.trim()) return;

    const candidates = await this.findAccountCandidates(client, tenantId, queryText, [
      'asset',
      'liability',
      'equity',
      'revenue',
      'expense',
    ]);
    if (candidates.length === 0) return;

    const top = candidates[0];

    await this.insertSuggestion(client, tenantId, 'bank_transaction', bankTransactionId, 'account_code', {
      suggested_account_code: top.code,
      candidates: candidates.map((c) => ({ code: c.code, name: c.name, score: round3(c.score) })),
    }, round3(top.score));
  }

  /**
   * 新規の経費明細行(expense_report_lines)に対し、過去の確定仕訳との類似度検索により
   * 費目カテゴリの借方科目(expense_categories.default_account_id)を再提案する。
   */
  async generateExpenseLineSuggestion(
    client: PoolClient,
    tenantId: string,
    expenseReportLineId: string,
    currentAccountId: string,
    queryText: string,
  ): Promise<void> {
    if (!queryText.trim()) return;

    const candidates = await this.filterToExpenseCategoryAccounts(
      client,
      tenantId,
      await this.findAccountCandidates(client, tenantId, queryText, ['expense']),
    );
    if (candidates.length === 0) return;

    const top = candidates[0];
    if (top.accountId === currentAccountId) return;

    await this.insertSuggestion(
      client,
      tenantId,
      'expense_report_line',
      expenseReportLineId,
      'account_code',
      {
        suggested_account_code: top.code,
        candidates: candidates.map((c) => ({ code: c.code, name: c.name, score: round3(c.score) })),
      },
      round3(top.score),
    );
  }

  /**
   * 契約書テキストから主要条項を抽出して構造化提案 JSON (`suggested_fields`) を生成する。
   * AIゲートウェイの契約書初期プロンプト/ルールエンジンに対応。
   */
  extractContractTerms(rawText: string): {
    suggested_fields: Record<string, SuggestedField>;
    confidenceScore: number;
  } {
    const fields: Record<string, SuggestedField> = {};
    const text = rawText.trim();
    let totalScore = 0;
    let fieldCount = 0;

    // 1. タイトル (例: 秘密保持契約書, 業務委託契約書)
    const titleMatch = text.match(/(.{2,25}契約書|.{2,25}規約|覚書|合意書)/);
    if (titleMatch) {
      fields.contract_title = {
        value: titleMatch[1].trim(),
        confidence: 0.95,
        rationale: '文書冒頭または表題パターンから契約書名を抽出',
      };
      totalScore += 0.95;
      fieldCount++;
    }

    // 2. 当事者 (甲 / 乙)
    const parties: string[] = [];
    const kouMatch = text.match(/甲[：:\s]+([^\n,、(（]+)/);
    const otsuMatch = text.match(/乙[：:\s]+([^\n,、(（]+)/);
    if (kouMatch) parties.push(`甲: ${kouMatch[1].trim()}`);
    if (otsuMatch) parties.push(`乙: ${otsuMatch[1].trim()}`);
    if (parties.length > 0) {
      fields.contract_parties = {
        value: parties.join(' / '),
        confidence: 0.85,
        rationale: '契約当事者(甲/乙)の定義箇所から抽出',
      };
      totalScore += 0.85;
      fieldCount++;
    }

    // 3. 契約期間 (開始日・終了日)
    const dateRangeMatch = text.match(/(\d{4}[年\-/]\d{1,2}[月\-/]\d{1,2}日?)\s*(?:から|〜|～|-)\s*(\d{4}[年\-/]\d{1,2}[月\-/]\d{1,2}日?)/);
    if (dateRangeMatch) {
      const normalizeDate = (dStr: string): string => {
        const cleaned = dStr.replace(/年|月/g, '-').replace(/日/g, '').trim();
        const parts = cleaned.split(/[\/\-]/).map((p) => p.padStart(2, '0'));
        if (parts.length === 3) return `${parts[0]}-${parts[1]}-${parts[2]}`;
        return dStr;
      };
      fields.contract_start_date = {
        value: normalizeDate(dateRangeMatch[1]),
        confidence: 0.9,
        rationale: '契約期間条項から開始日を抽出',
      };
      fields.contract_end_date = {
        value: normalizeDate(dateRangeMatch[2]),
        confidence: 0.9,
        rationale: '契約期間条項から終了日を抽出',
      };
      totalScore += 1.8;
      fieldCount += 2;
    }

    // 4. 契約金額 (委託料・月額等)
    const amountMatch = text.match(/(?:金額|月額|委託料|代金|対価)[：:\s]*[¥￥]?\s*([\d,]+)\s*円?/);
    if (amountMatch) {
      const num = Number(amountMatch[1].replace(/,/g, ''));
      if (!Number.isNaN(num)) {
        fields.contract_amount = {
          value: num,
          confidence: 0.85,
          rationale: '金額・委託料記載箇所から数値を抽出',
        };
        totalScore += 0.85;
        fieldCount++;
      }
    }

    // 5. 自動更新条項の有無
    const autoRenewalMatch = text.match(/(自動(?:的)?に(?:更新|延長)|異議がないときは.*同一条件で.*更新)/);
    if (autoRenewalMatch) {
      fields.auto_renewal = {
        value: true,
        confidence: 0.9,
        rationale: '期間満了時の自動更新条項パターンを検出',
      };
      totalScore += 0.9;
      fieldCount++;
    } else if (text.includes('自動更新は行わない') || text.includes('更新しない')) {
      fields.auto_renewal = {
        value: false,
        confidence: 0.85,
        rationale: '更新なしの明記を検出',
      };
      totalScore += 0.85;
      fieldCount++;
    }

    // 6. 準拠法・管轄裁判所
    const courtMatch = text.match(/([^\s]+(?:地方裁判所|簡易裁判所))/);
    if (courtMatch) {
      fields.governing_law_jurisdiction = {
        value: `日本法 / ${courtMatch[1]}`,
        confidence: 0.8,
        rationale: '合意管轄条項から管轄裁判所を抽出',
      };
      totalScore += 0.8;
      fieldCount++;
    }

    // 7. 解約予告通知期間
    const noticeMatch = text.match(/(\d+)\s*(?:日|か月|ヶ月|カ月|ケ月)前までに.*(?:通知|申し出|解約)/);
    if (noticeMatch) {
      const unit = noticeMatch[0].includes('日') ? '日' : 'ヶ月';
      const num = Number(noticeMatch[1]);
      const days = unit === 'ヶ月' ? num * 30 : num;
      fields.notice_period_days = {
        value: days,
        confidence: 0.85,
        rationale: `中途解約予告期間 (${noticeMatch[0]}) より日数換算`,
      };
      totalScore += 0.85;
      fieldCount++;
    }

    const avgScore = fieldCount > 0 ? round3(totalScore / fieldCount) : 0.5;
    return {
      suggested_fields: fields,
      confidenceScore: avgScore,
    };
  }

  /**
   * 契約書PDF等の文書テキストから条項を抽出し、`ai_suggestions`へ隔離保存する
   * (`target_type='contract'`, `suggestion_type='contract_terms'`)。
   * 原則1(AI提案の隔離領域遵守)に従い、確定データ(contractsテーブル等)へは一切書き込まない。
   */
  async generateContractSuggestion(
    client: PoolClient,
    tenantId: string,
    targetId: string,
    contractText: string,
    modelName: string = 'contract-extractor-v1',
  ): Promise<AiSuggestionDto> {
    const { suggested_fields, confidenceScore } = this.extractContractTerms(contractText);
    validateConfidenceScores(confidenceScore, suggested_fields);

    const payload: AiSuggestionPayload = {
      document_type: 'contract',
      suggested_fields,
    };

    const result = await client.query<AiSuggestionRow>(
      `INSERT INTO ai_suggestions
         (tenant_id, target_type, target_id, suggestion_type, payload, confidence_score, model_name, accepted)
       VALUES ($1, 'contract', $2, 'contract_terms', $3::jsonb, $4, $5, NULL)
       RETURNING ${AI_SUGGESTION_COLUMNS}`,
      [tenantId, targetId, JSON.stringify(payload), confidenceScore, modelName],
    );
    return mapAiSuggestionRow(result.rows[0]);
  }

  /**
   * 任意の文書種別・対象に対する汎用構造化提案を`ai_suggestions`へ隔離保存する。
   * ガードレール原則に従い、確定用テーブルへの直接書き込みは一切行わない。
   */
  async generateGenericSuggestion(
    client: PoolClient,
    tenantId: string,
    targetType: string,
    targetId: string,
    suggestionType: string,
    documentType: string,
    suggestedFields: Record<string, SuggestedField>,
    confidenceScore: number,
    modelName: string,
  ): Promise<AiSuggestionDto> {
    validateConfidenceScores(confidenceScore, suggestedFields);

    const payload: AiSuggestionPayload = {
      document_type: documentType,
      suggested_fields: suggestedFields,
    };

    const result = await client.query<AiSuggestionRow>(
      `INSERT INTO ai_suggestions
         (tenant_id, target_type, target_id, suggestion_type, payload, confidence_score, model_name, accepted)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NULL)
       RETURNING ${AI_SUGGESTION_COLUMNS}`,
      [tenantId, targetType, targetId, suggestionType, JSON.stringify(payload), confidenceScore, modelName],
    );
    return mapAiSuggestionRow(result.rows[0]);
  }

  /**
   * レシートOCR(Vision AI)による抽出結果を`ai_suggestions`へ追記保存する
   * (`target_type='expense_report'`, `suggestion_type='ocr'`)。原則1(AI提案の隔離領域遵守)に
   * 従い、確定データ(expense_reports/expense_report_lines)へは一切書き込まない。
   */
  async generateOcrSuggestion(
    client: PoolClient,
    tenantId: string,
    expenseReportId: string,
    payload: AiSuggestionPayload,
    confidenceScore: number,
    modelName: string,
  ): Promise<AiSuggestionDto> {
    validateConfidenceScores(confidenceScore, payload.suggested_fields);

    const result = await client.query<AiSuggestionRow>(
      `INSERT INTO ai_suggestions
         (tenant_id, target_type, target_id, suggestion_type, payload, confidence_score, model_name, accepted)
       VALUES ($1, 'expense_report', $2, 'ocr', $3::jsonb, $4, $5, NULL)
       RETURNING ${AI_SUGGESTION_COLUMNS}`,
      [tenantId, expenseReportId, JSON.stringify(payload), confidenceScore, modelName],
    );
    return mapAiSuggestionRow(result.rows[0]);
  }

  /**
   * OCR抽出したテキスト(店舗名等)から、費目カテゴリ科目(expense_categories.default_account_id)の
   * 最有力候補を1件返す(`expense_report_lines`がまだ存在しない撮影時点でも呼び出せる公開API)。
   */
  async findTopExpenseAccountCandidate(
    client: PoolClient,
    tenantId: string,
    queryText: string,
  ): Promise<AccountCandidate | null> {
    if (!queryText.trim()) return null;
    const candidates = await this.filterToExpenseCategoryAccounts(
      client,
      tenantId,
      await this.findAccountCandidates(client, tenantId, queryText, ['expense']),
    );
    return candidates[0] ?? null;
  }

  /**
   * 経費明細(expense_report_lines.category_id)への反映は必ず`expense_categories`経由
   * (`default_account_id`)で行われる(`applyToExpenseReportLine`参照)ため、候補を
   * 「いずれかの費目カテゴリのdefault_account_idとして実際に登録されている科目」のみに
   * 絞り込む。役員報酬・減価償却費・外注費のような、費目カテゴリに一切紐付いていない
   * 費用科目(給与・固定資産・仕入計上等、他モジュールが直接account_idを指定して起票する科目)が
   * 類似度スコア上位に来てしまうと、accept()時に
   * 「対応する費目カテゴリが見つかりません」で失敗する提案を生成してしまうため
   * (この提案が"却下"ではなく"受理不能な提案"になるのはAI提案機能として不適切)、
   * 生成時点で候補から除外する。
   */
  private async filterToExpenseCategoryAccounts(
    client: PoolClient,
    tenantId: string,
    candidates: AccountCandidate[],
  ): Promise<AccountCandidate[]> {
    if (candidates.length === 0) return candidates;
    const result = await client.query<{ default_account_id: string }>(
      `SELECT DISTINCT default_account_id FROM expense_categories
       WHERE tenant_id = $1 AND default_account_id = ANY($2::uuid[])`,
      [tenantId, candidates.map((c) => c.accountId)],
    );
    const eligible = new Set(result.rows.map((r) => r.default_account_id));
    return candidates.filter((c) => eligible.has(c.accountId));
  }

  // --------------------------------------------------------------------------
  // 内部ヘルパー: 類似度検索
  // --------------------------------------------------------------------------

  /**
   * `journal_entry_embeddings` に未反映の確定仕訳(posted)があれば、この場でベクトルを
   * 計算して補完する(遅延バックフィル)。仕訳の確定処理(post/approve等)は
   * journal-entries/expense-reports/vendor-bills/invoices/fixed-assetsなど複数モジュールに
   * 分散しているため、各モジュールへ埋め込み生成フックを個別に配線するのではなく、
   * 類似度検索の実行時にこの場で自己修復的に補完する設計とした
   * (母集団は毎回最新化されるため、常に取りこぼしがない)。
   */
  private async ensureEmbeddingsBackfilled(client: PoolClient, tenantId: string): Promise<void> {
    const missing = await client.query<{ id: string; description: string | null }>(
      `SELECT je.id, je.description
       FROM journal_entries je
       WHERE je.tenant_id = $1 AND je.status = 'posted'
         AND NOT EXISTS (
           SELECT 1 FROM journal_entry_embeddings e
           WHERE e.tenant_id = je.tenant_id AND e.journal_entry_id = je.id
         )`,
      [tenantId],
    );

    for (const row of missing.rows) {
      const text = row.description ?? '';
      if (!text.trim()) continue; // 摘要が空の仕訳は類似検索の母集団として意味を持たない
      const vector = computeTextEmbedding(text);
      await client.query(
        `INSERT INTO journal_entry_embeddings (tenant_id, journal_entry_id, embedding, model_name)
         VALUES ($1, $2, $3::vector, $4)
         ON CONFLICT (journal_entry_id) DO NOTHING`,
        [tenantId, row.id, toVectorLiteral(vector), PSEUDO_EMBEDDING_MODEL],
      );
    }
  }

  private async findAccountCandidates(
    client: PoolClient,
    tenantId: string,
    queryText: string,
    accountTypeFilter: string[],
  ): Promise<AccountCandidate[]> {
    await this.ensureEmbeddingsBackfilled(client, tenantId);

    const queryVector = toVectorLiteral(computeTextEmbedding(queryText));

    // `<=>` はpgvectorのコサイン距離演算子(0=完全一致 〜 2=正反対)。
    const neighbors = await client.query<{ journal_entry_id: string; distance: string }>(
      `SELECT e.journal_entry_id, (e.embedding <=> $1::vector) AS distance
       FROM journal_entry_embeddings e
       JOIN journal_entries je ON je.tenant_id = e.tenant_id AND je.id = e.journal_entry_id
       WHERE e.tenant_id = $2 AND je.status = 'posted'
       ORDER BY e.embedding <=> $1::vector
       LIMIT ${NEIGHBOR_LIMIT}`,
      [queryVector, tenantId],
    );
    if (neighbors.rowCount === 0) return [];

    const distanceByEntry = new Map(
      neighbors.rows.map((r) => [r.journal_entry_id, Number(r.distance)]),
    );
    const entryIds = neighbors.rows.map((r) => r.journal_entry_id);

    const lines = await client.query<{
      journal_entry_id: string;
      account_id: string;
      code: string;
      name: string;
      account_type: string;
    }>(
      `SELECT jel.journal_entry_id, a.id AS account_id, a.code, a.name, a.account_type
       FROM journal_entry_lines jel
       JOIN accounts a ON a.tenant_id = jel.tenant_id AND a.id = jel.account_id
       WHERE jel.tenant_id = $1 AND jel.journal_entry_id = ANY($2::uuid[])`,
      [tenantId, entryIds],
    );

    const candidateByAccount = new Map<string, AccountCandidate>();
    for (const line of lines.rows) {
      if (!accountTypeFilter.includes(line.account_type)) continue;
      const distance = distanceByEntry.get(line.journal_entry_id) ?? 2;
      // コサイン距離(0〜2)を類似度スコア(0〜1)へ変換する。
      const score = round3(1 - distance / 2);
      const existing = candidateByAccount.get(line.account_id);
      if (!existing || score > existing.score) {
        candidateByAccount.set(line.account_id, {
          accountId: line.account_id,
          code: line.code,
          name: line.name,
          score,
        });
      }
    }

    return [...candidateByAccount.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, CANDIDATE_LIMIT);
  }

  private async insertSuggestion(
    client: PoolClient,
    tenantId: string,
    targetType: string,
    targetId: string,
    suggestionType: string,
    payload: AiSuggestionPayload,
    confidenceScore: number,
  ): Promise<void> {
    await client.query(
      `INSERT INTO ai_suggestions
         (tenant_id, target_type, target_id, suggestion_type, payload, confidence_score, model_name, accepted)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NULL)`,
      [
        tenantId,
        targetType,
        targetId,
        suggestionType,
        JSON.stringify(payload),
        confidenceScore,
        PSEUDO_EMBEDDING_MODEL,
      ],
    );
  }

  // --------------------------------------------------------------------------
  // 内部ヘルパー: 判定(accept/reject)
  // --------------------------------------------------------------------------

  private async fetchRawById(
    client: PoolClient,
    tenantId: string,
    id: string,
  ): Promise<AiSuggestionRow | null> {
    const result = await client.query<AiSuggestionRow>(
      `SELECT ${AI_SUGGESTION_COLUMNS} FROM ai_suggestions WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return result.rows[0] ?? null;
  }

  private async isAlreadyDecided(
    client: PoolClient,
    tenantId: string,
    suggestion: AiSuggestionRow,
  ): Promise<boolean> {
    if (suggestion.accepted !== null) return true;
    const result = await client.query(
      `SELECT 1 FROM ai_suggestions
       WHERE tenant_id = $1 AND target_type = $2 AND target_id = $3 AND suggestion_type = $4
         AND accepted IS NOT NULL
       LIMIT 1`,
      [tenantId, suggestion.target_type, suggestion.target_id, suggestion.suggestion_type],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async insertDecisionRow(
    client: PoolClient,
    tenantId: string,
    suggestion: AiSuggestionRow,
    accepted: boolean,
    reason: string | null,
  ): Promise<AiSuggestionRow> {
    const payload: AiSuggestionPayload = {
      ...suggestion.payload,
      ...(reason !== null ? { rejection_reason: reason } : {}),
    };
    const result = await client.query<AiSuggestionRow>(
      `INSERT INTO ai_suggestions
         (tenant_id, target_type, target_id, suggestion_type, payload, confidence_score, model_name, accepted)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       RETURNING ${AI_SUGGESTION_COLUMNS}`,
      [
        tenantId,
        suggestion.target_type,
        suggestion.target_id,
        suggestion.suggestion_type,
        JSON.stringify(payload),
        suggestion.confidence_score,
        suggestion.model_name,
        accepted,
      ],
    );
    return result.rows[0];
  }

  /**
   * 提案payloadの内容を対象の草案レコードへ反映する決定的ロジック。
   * `suggestion_type = 'account_code'` のみサポートする(MVPスコープ)。
   */
  private async applySuggestion(
    client: PoolClient,
    tenantId: string,
    suggestion: AiSuggestionRow,
  ): Promise<void> {
    if (suggestion.suggestion_type === 'ocr') {
      // OCR提案の「反映」はフロントエンドがフォーム項目へ転記する形で完結しており、
      // 確定データ(expense_reports/expense_report_lines)への書き込みはここでは行わない
      // (原則1: AI提案は隔離領域から確定データへ直接書き込まない)。
      // accept()呼び出しは判定行の追記のみを目的とする。
      return;
    }
    if (suggestion.suggestion_type !== 'account_code') {
      throw AppException.badRequest(
        `未対応の提案種別(suggestion_type: ${suggestion.suggestion_type})のため自動反映できません`,
      );
    }
    const code = suggestion.payload.suggested_account_code;
    if (!code) {
      throw AppException.badRequest('この提案には反映可能な勘定科目コードが含まれていません');
    }
    const accountId = await this.resolveAccountIdByCode(client, tenantId, code);

    if (suggestion.target_type === 'journal_entry') {
      await this.applyToJournalEntry(client, tenantId, suggestion, accountId);
      return;
    }
    if (suggestion.target_type === 'expense_report_line') {
      await this.applyToExpenseReportLine(client, tenantId, suggestion, accountId);
      return;
    }
    throw AppException.badRequest(
      `未対応の対象種別(target_type: ${suggestion.target_type})のため自動反映できません`,
    );
  }

  private async applyToJournalEntry(
    client: PoolClient,
    tenantId: string,
    suggestion: AiSuggestionRow,
    accountId: string,
  ): Promise<void> {
    const je = await client.query<{ status: string }>(
      `SELECT status FROM journal_entries WHERE tenant_id = $1 AND id = $2`,
      [tenantId, suggestion.target_id],
    );
    if (je.rowCount === 0) {
      throw AppException.notFound('提案対象の仕訳が見つかりません');
    }
    if (je.rows[0].status !== 'draft') {
      throw AppException.conflict(
        'TARGET_NOT_DRAFT',
        '対象の仕訳は既にdraft以外の状態へ遷移しているため、この提案を反映できません',
      );
    }

    const lineNo = suggestion.payload.target_line_no;
    if (!lineNo) {
      throw AppException.badRequest('この提案には反映対象の明細行(target_line_no)が含まれていません');
    }
    const updated = await client.query(
      `UPDATE journal_entry_lines SET account_id = $3
       WHERE tenant_id = $1 AND journal_entry_id = $2 AND line_no = $4`,
      [tenantId, suggestion.target_id, accountId, lineNo],
    );
    if (updated.rowCount === 0) {
      throw AppException.notFound('反映対象の仕訳明細行が見つかりません');
    }
  }

  private async applyToExpenseReportLine(
    client: PoolClient,
    tenantId: string,
    suggestion: AiSuggestionRow,
    accountId: string,
  ): Promise<void> {
    const line = await client.query<{ expense_report_id: string; line_no: number }>(
      `SELECT expense_report_id, line_no FROM expense_report_lines WHERE tenant_id = $1 AND id = $2`,
      [tenantId, suggestion.target_id],
    );
    if (line.rowCount === 0) {
      throw AppException.notFound('提案対象の経費明細が見つかりません');
    }
    const { expense_report_id: reportId, line_no: expenseLineNo } = line.rows[0];

    const report = await client.query<{ status: string; journal_entry_id: string | null }>(
      `SELECT status, journal_entry_id FROM expense_reports WHERE tenant_id = $1 AND id = $2`,
      [tenantId, reportId],
    );
    if (report.rowCount === 0 || !['submitted', 'in_review'].includes(report.rows[0].status)) {
      throw AppException.conflict(
        'TARGET_NOT_DRAFT',
        '対象の経費精算申請は既に承認/却下されているため、この提案を反映できません',
      );
    }

    const category = await client.query<{ id: string }>(
      `SELECT id FROM expense_categories WHERE tenant_id = $1 AND default_account_id = $2`,
      [tenantId, accountId],
    );
    if (category.rowCount === 0) {
      throw AppException.badRequest(
        `提案された勘定科目(id: ${accountId})に対応する費目カテゴリ(expense_categories.default_account_id)が見つかりません`,
      );
    }

    await client.query(
      `UPDATE expense_report_lines SET category_id = $3 WHERE tenant_id = $1 AND id = $2`,
      [tenantId, suggestion.target_id, category.rows[0].id],
    );

    // 経費精算作成時に明細1行ごとへ対応する形で先行起票したdraft仕訳(借方=費目科目,
    // 貸方=支払方法別科目)についても、借方科目を同じ内容へ同期させる
    // (expense-reports.service.ts の insertLines と対称に、明細行nは
    //  仕訳明細行 2n-1(借方)/2n(貸方) に対応する)。
    if (report.rows[0].journal_entry_id) {
      const jeLineNo = expenseLineNo * 2 - 1;
      await client.query(
        `UPDATE journal_entry_lines SET account_id = $3
         WHERE tenant_id = $1 AND journal_entry_id = $2 AND line_no = $4`,
        [tenantId, report.rows[0].journal_entry_id, accountId, jeLineNo],
      );
    }
  }

  private async resolveAccountIdByCode(
    client: PoolClient,
    tenantId: string,
    code: string,
  ): Promise<string> {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM accounts WHERE tenant_id = $1 AND code = $2`,
      [tenantId, code],
    );
    const account = result.rows[0];
    if (!account) {
      throw AppException.badRequest(`提案された勘定科目コード(${code})が勘定科目マスタに存在しません`);
    }
    return account.id;
  }
}
