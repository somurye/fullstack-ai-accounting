import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { acquireAdvisoryLock } from '../../common/database/advisory-lock';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AiSuggestionsService } from '../ai-suggestions/ai-suggestions.service';
import type { AiSuggestionDto } from '../ai-suggestions/ai-suggestions.mapper';
import {
  chunkContractText,
  computeTextEmbedding,
  PSEUDO_EMBEDDING_MODEL,
  toVectorLiteral,
} from '../ai-suggestions/embedding';
import {
  mapContractRow,
  mapSimilarContractRow,
  SQL_CONTRACT_COLUMNS,
  type ContractApprovalHistoryEntryDto,
  type ContractAttachmentDto,
  type ContractDetailDto,
  type ContractDto,
  type ContractRow,
  type SimilarContractDto,
  type SimilarContractRow,
} from './contracts.mapper';
import type {
  ContractCreateInput,
  ContractListQuery,
  ContractUpdateInput,
  ExtractContractTermsInput,
  SearchSimilarContractsQuery,
  SimilarContractsQuery,
} from './dto/contract.schemas';
import type { ContractKpiDto } from '../executive-dashboard/executive-dashboard.dto';
import { extractTextFromPdfFile } from './utils/pdf-text-extractor';

export interface ContractListResult {
  contracts: ContractDto[];
  pagination: PaginationMeta;
}

/**
 * 全文類似検索の対象とする確定済み契約ステータス定義 (P1-T6-FIX)。
 * 未承認（draft, pending_approval）や不成立（rejected）の機微な契約本文が
 * 社内検索経由で露出するのを防ぐため、確定済み（active）契約のみを対象とする。
 * ※ 解約済み（terminated）や満了（expired）などの過去契約の検索対象化は、
 *   業務ニーズに応じた将来の拡張オプション（include_inactive等）としてDEBT候補として記録。
 */
export const CONFIRMED_SEARCH_CONTRACT_STATUSES = ['active'] as const;
export type ConfirmedSearchContractStatus = (typeof CONFIRMED_SEARCH_CONTRACT_STATUSES)[number];

export async function generateContractNo(
  client: PoolClient,
  tenantId: string,
  year?: string,
): Promise<string> {
  const currentYear = year ?? new Date().getFullYear().toString();
  await acquireAdvisoryLock(client, `contract_no:${tenantId}:${currentYear}`);
  const { rows } = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM contracts WHERE tenant_id = $1 AND contract_no LIKE $2`,
    [tenantId, `CNT-${currentYear}-%`],
  );
  const seq = Number(rows[0]?.count ?? 0) + 1;
  return `CNT-${currentYear}-${String(seq).padStart(4, '0')}`;
}

@Injectable()
export class ContractsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
    private readonly aiSuggestions: AiSuggestionsService,
  ) {}

  async list(
    tenantId: string,
    userId: string | null,
    query: ContractListQuery,
  ): Promise<ContractListResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const conditions: string[] = ['c.tenant_id = $1'];
      const params: unknown[] = [tenantId];

      if (query.status) {
        params.push(query.status);
        conditions.push(`c.status = $${params.length}`);
      }
      if (query.contract_type) {
        params.push(query.contract_type);
        conditions.push(`c.contract_type = $${params.length}`);
      }
      if (query.counterparty_name) {
        params.push(`%${query.counterparty_name}%`);
        conditions.push(`c.counterparty_name ILIKE $${params.length}`);
      }
      if (query.start_date_from) {
        params.push(query.start_date_from);
        conditions.push(`c.start_date >= $${params.length}`);
      }
      if (query.start_date_to) {
        params.push(query.start_date_to);
        conditions.push(`c.start_date <= $${params.length}`);
      }
      if (query.end_date_from) {
        params.push(query.end_date_from);
        conditions.push(`c.end_date >= $${params.length}`);
      }
      if (query.end_date_to) {
        params.push(query.end_date_to);
        conditions.push(`c.end_date <= $${params.length}`);
      }

      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM contracts c WHERE ${whereClause}`,
        params,
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const listParams = [...params, query.page_size, (query.page - 1) * query.page_size];
      const result = await client.query<ContractRow>(
        `SELECT ${SQL_CONTRACT_COLUMNS}
         FROM contracts c
         WHERE ${whereClause}
         ORDER BY c.created_at DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      return {
        contracts: result.rows.map(mapContractRow),
        pagination: buildPagination(query.page, query.page_size, totalCount),
      };
    });
  }

  async getById(
    tenantId: string,
    userId: string | null,
    id: string,
  ): Promise<ContractDetailDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<ContractRow>(
        `SELECT ${SQL_CONTRACT_COLUMNS} FROM contracts c WHERE c.tenant_id = $1 AND c.id = $2`,
        [tenantId, id],
      );
      if (result.rowCount === 0) {
        throw AppException.notFound('指定された契約書が見つかりません');
      }

      const contractDto = mapContractRow(result.rows[0]);

      // 添付ファイル情報の取得
      let attachment: ContractAttachmentDto | null = null;
      if (contractDto.attachment_id) {
        const attResult = await client.query<{
          id: string;
          file_name: string;
          mime_type: string;
          document_category: string;
        }>(
          `SELECT id, file_name, mime_type, document_category FROM attachments WHERE tenant_id = $1 AND id = $2`,
          [tenantId, contractDto.attachment_id],
        );
        if (attResult.rowCount && attResult.rowCount > 0) {
          attachment = attResult.rows[0];
        }
      }

      // 承認履歴の取得
      const historyResult = await client.query<{
        id: string;
        step_number: number;
        approver_id: string;
        action: string;
        comment: string | null;
        acted_at: Date;
      }>(
        `SELECT ah.id, ah.step_number, ah.approver_id, ah.action, ah.comment, ah.acted_at
         FROM approval_history ah
         JOIN approval_requests ar ON ar.id = ah.approval_request_id
         WHERE ar.tenant_id = $1 AND ar.target_type = 'contract' AND ar.target_id = $2
         ORDER BY ah.acted_at ASC`,
        [tenantId, id],
      );

      const approvalHistory: ContractApprovalHistoryEntryDto[] = historyResult.rows.map(
        (h) => ({
          id: h.id,
          step_number: h.step_number,
          approver_id: h.approver_id,
          action: h.action as 'approve' | 'reject',
          comment: h.comment,
          acted_at: h.acted_at instanceof Date ? h.acted_at.toISOString() : String(h.acted_at),
        }),
      );

      return {
        ...contractDto,
        attachment,
        approval_history: approvalHistory,
      };
    });
  }

  async create(
    tenantId: string,
    userId: string,
    dto: ContractCreateInput,
  ): Promise<ContractDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      // テキスト抽出 (指定された extracted_text を優先、なければ attachment から抽出)
      let extractedText: string | null = dto.extracted_text ?? null;

      // 添付ファイルの存在確認(指定時)
      if (dto.attachment_id) {
        const attCheck = await client.query<{
          storage_path: string;
          mime_type: string;
          document_category: string;
        }>(
          `SELECT storage_path, mime_type, document_category FROM attachments WHERE tenant_id = $1 AND id = $2`,
          [tenantId, dto.attachment_id],
        );
        if (attCheck.rowCount === 0) {
          throw AppException.badRequest('指定された添付ファイルが存在しません');
        }

        if (!extractedText && attCheck.rows && attCheck.rows.length > 0 && attCheck.rows[0].storage_path) {
          const att = attCheck.rows[0];
          try {
            extractedText = await extractTextFromPdfFile(att.storage_path);
          } catch {
            // テキスト抽出に失敗した場合でも契約作成自体は妨げない
            extractedText = null;
          }
        }
      }

      // 起草元AI提案の存在確認(指定時)
      if (dto.source_suggestion_id) {
        const sugCheck = await client.query(
          `SELECT 1 FROM ai_suggestions WHERE tenant_id = $1 AND id = $2`,
          [tenantId, dto.source_suggestion_id],
        );
        if (sugCheck.rowCount === 0) {
          throw AppException.badRequest('指定された起草元AI提案が存在しません');
        }
      }

      const contractNo = await generateContractNo(client, tenantId);

      const result = await client.query<ContractRow>(
        `INSERT INTO contracts AS c (
           tenant_id, contract_no, title, counterparty_name, contract_type,
           contract_amount, currency, start_date, end_date, auto_renewal,
           renewal_notice_days, status, attachment_id, source_suggestion_id, description,
           extracted_text, created_by
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8, $9, $10,
           $11, 'draft', $12, $13, $14,
           $15, $16
         )
         RETURNING ${SQL_CONTRACT_COLUMNS}`,
        [
          tenantId,
          contractNo,
          dto.title,
          dto.counterparty_name,
          dto.contract_type,
          dto.contract_amount ?? null,
          dto.currency ?? 'JPY',
          dto.start_date,
          dto.end_date ?? null,
          dto.auto_renewal ?? false,
          dto.renewal_notice_days ?? 30,
          dto.attachment_id ?? null,
          dto.source_suggestion_id ?? null,
          dto.description ?? null,
          extractedText,
          userId,
        ],
      );

      const created = mapContractRow(result.rows[0]);

      // 契約書本文の embedding をチャンク分割して保存
      if (extractedText) {
        await this.syncContractEmbeddings(client, tenantId, created.id, extractedText);
      }

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'contract.created',
        targetType: 'contract',
        targetId: created.id,
        afterData: {
          contract_no: created.contract_no,
          title: created.title,
          counterparty_name: created.counterparty_name,
          contract_amount: created.contract_amount,
          source_suggestion_id: created.source_suggestion_id,
        },
      });

      return created;
    });
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    dto: ContractUpdateInput,
  ): Promise<ContractDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const existing = await client.query<ContractRow>(
        `SELECT ${SQL_CONTRACT_COLUMNS} FROM contracts c WHERE c.tenant_id = $1 AND c.id = $2`,
        [tenantId, id],
      );
      if (existing.rowCount === 0) {
        throw AppException.notFound('指定された契約書が見つかりません');
      }

      const current = existing.rows[0];
      if (current.status !== 'draft') {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          `draft状態の契約書のみ更新可能です (現在: ${current.status})`,
        );
      }

      if (dto.attachment_id) {
        const attCheck = await client.query(
          `SELECT 1 FROM attachments WHERE tenant_id = $1 AND id = $2`,
          [tenantId, dto.attachment_id],
        );
        if (attCheck.rowCount === 0) {
          throw AppException.badRequest('指定された添付ファイルが存在しません');
        }
      }

      const title = dto.title ?? current.title;
      const counterpartyName = dto.counterparty_name ?? current.counterparty_name;
      const contractType = dto.contract_type ?? current.contract_type;
      const contractAmount =
        dto.contract_amount !== undefined
          ? dto.contract_amount
          : current.contract_amount !== null
            ? Number(current.contract_amount)
            : null;
      const currency = dto.currency ?? current.currency;
      const startDate = dto.start_date ?? current.start_date;
      const endDate =
        dto.end_date !== undefined ? dto.end_date : current.end_date;
      const autoRenewal =
        dto.auto_renewal !== undefined ? dto.auto_renewal : current.auto_renewal;
      const renewalNoticeDays =
        dto.renewal_notice_days !== undefined
          ? dto.renewal_notice_days
          : current.renewal_notice_days;
      const attachmentId =
        dto.attachment_id !== undefined ? dto.attachment_id : current.attachment_id;
      const description =
        dto.description !== undefined ? dto.description : current.description;

      let extractedText =
        dto.extracted_text !== undefined ? dto.extracted_text : current.extracted_text;
      if (
        dto.extracted_text === undefined &&
        dto.attachment_id &&
        dto.attachment_id !== current.attachment_id
      ) {
        const attFileResult = await client.query<{ storage_path: string }>(
          `SELECT storage_path FROM attachments WHERE tenant_id = $1 AND id = $2`,
          [tenantId, dto.attachment_id],
        );
        if (attFileResult.rowCount && attFileResult.rowCount > 0) {
          try {
            extractedText = await extractTextFromPdfFile(attFileResult.rows[0].storage_path);
          } catch {
            extractedText = null;
          }
        }
      }

      const result = await client.query<ContractRow>(
        `UPDATE contracts c SET
           title = $3,
           counterparty_name = $4,
           contract_type = $5,
           contract_amount = $6,
           currency = $7,
           start_date = $8,
           end_date = $9,
           auto_renewal = $10,
           renewal_notice_days = $11,
           attachment_id = $12,
           description = $13,
           extracted_text = $14,
           updated_at = now()
         WHERE c.tenant_id = $1 AND c.id = $2
         RETURNING ${SQL_CONTRACT_COLUMNS}`,
        [
          tenantId,
          id,
          title,
          counterpartyName,
          contractType,
          contractAmount,
          currency,
          startDate,
          endDate,
          autoRenewal,
          renewalNoticeDays,
          attachmentId,
          description,
          extractedText,
        ],
      );

      const updated = mapContractRow(result.rows[0]);

      // 本文に変更があった場合、embedding を再生成
      if (extractedText !== current.extracted_text) {
        await this.syncContractEmbeddings(client, tenantId, id, extractedText);
      }

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'contract.updated',
        targetType: 'contract',
        targetId: updated.id,
        beforeData: mapContractRow(current),
        afterData: updated,
      });

      return updated;
    });
  }

  async delete(tenantId: string, userId: string, id: string): Promise<void> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const existing = await client.query<ContractRow>(
        `SELECT ${SQL_CONTRACT_COLUMNS} FROM contracts c WHERE c.tenant_id = $1 AND c.id = $2`,
        [tenantId, id],
      );
      if (existing.rowCount === 0) {
        throw AppException.notFound('指定された契約書が見つかりません');
      }
      const current = existing.rows[0];
      if (current.status !== 'draft') {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          `draft状態の契約書のみ削除可能です (現在: ${current.status})`,
        );
      }

      await client.query(`DELETE FROM contracts WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        id,
      ]);

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'contract.deleted',
        targetType: 'contract',
        targetId: id,
        beforeData: mapContractRow(current),
      });
    });
  }

  /**
   * 契約書の承認申請を起票する。
   *
   * 1人テナント運用とSoDの両立設計:
   * - テナント内で contract 向けの有効な承認ルールが存在しない、または承認ステップ数が 0 の場合:
   *   「承認者不在」による自己承認ブロックを回避するため、即座に active（自動承認）へ遷移させる。
   * - 承認ステップ数が 1 以上のルールが存在する場合:
   *   pending_approval へ遷移させ、approval_requests を起票する。
   *   申請者自身による承認は DB トリガー fn_prevent_self_approval により厳格に遮断される。
   */
  async submitForApproval(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<ContractDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const existing = await client.query<ContractRow>(
        `SELECT ${SQL_CONTRACT_COLUMNS} FROM contracts c WHERE c.tenant_id = $1 AND c.id = $2`,
        [tenantId, id],
      );
      if (existing.rowCount === 0) {
        throw AppException.notFound('指定された契約書が見つかりません');
      }
      const current = existing.rows[0];
      if (current.status !== 'draft' && current.status !== 'rejected') {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          `draft または rejected 状態の契約書のみ申請可能です (現在: ${current.status})`,
        );
      }

      // 契約書向けの有効な承認ルールの取得
      const rulesResult = await client.query<{
        step_number: number;
        is_explicit_auto_approve: boolean;
      }>(
        `SELECT step_number, is_explicit_auto_approve
         FROM approval_rules
         WHERE tenant_id = $1 AND target_type = 'contract' AND is_active = TRUE
         ORDER BY step_number ASC`,
        [tenantId],
      );

      if (!rulesResult.rowCount || rulesResult.rowCount === 0) {
        // 承認ルールが未設定の場合はエラー (SoDの偶発的無効化を防止)
        throw AppException.badRequest(
          '契約書の承認ルールが設定されていません。承認ルールの設定を行ってください',
        );
      }

      // 明示的な0-step自動承認ルール (is_explicit_auto_approve = TRUE) の確認 (1人テナント運用)
      const autoApproveRule = rulesResult.rows.find((r) => r.is_explicit_auto_approve);
      if (autoApproveRule) {
        // 1人テナント向け明示的自動承認: 即座に active 化
        const updateResult = await client.query<ContractRow>(
          `UPDATE contracts c
           SET status = 'active', approved_at = now(), updated_at = now()
           WHERE c.tenant_id = $1 AND c.id = $2
           RETURNING ${SQL_CONTRACT_COLUMNS}`,
          [tenantId, id],
        );
        const activeContract = mapContractRow(updateResult.rows[0]);

        await this.auditLogs.record(client, tenantId, {
          actorUserId: userId,
          action: 'contract.auto_approved',
          targetType: 'contract',
          targetId: id,
          afterData: { status: 'active', auto_approved: true },
        });

        return activeContract;
      }

      // 承認ステップ >= 1: 最大ステップ数を total_steps として pending_approval へ遷移し起票
      const totalSteps = Math.max(...rulesResult.rows.map((r) => r.step_number));
      const updateResult = await client.query<ContractRow>(
        `UPDATE contracts c
         SET status = 'pending_approval', updated_at = now()
         WHERE c.tenant_id = $1 AND c.id = $2
         RETURNING ${SQL_CONTRACT_COLUMNS}`,
        [tenantId, id],
      );
      const pendingContract = mapContractRow(updateResult.rows[0]);

      // approval_requests を作成または更新 (rejectedからの再申請にも対応)
      await client.query(
        `INSERT INTO approval_requests (
           tenant_id, target_type, target_id, submitted_by, total_steps, current_step, status
         ) VALUES (
           $1, 'contract', $2, $3, $4, 1, 'pending'
         )
         ON CONFLICT (target_type, target_id)
         DO UPDATE SET
           status = 'pending',
           current_step = 1,
           submitted_by = $3,
           updated_at = now()`,
        [tenantId, id, userId, totalSteps],
      );

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'contract.submitted_for_approval',
        targetType: 'contract',
        targetId: id,
        afterData: { status: 'pending_approval', total_steps: totalSteps },
      });

      return pendingContract;
    });
  }

  /**
   * 契約書を解約(terminated)状態へ遷移させる。
   * active 状態の契約書のみ解約可能。
   */
  async terminate(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<ContractDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const existing = await client.query<ContractRow>(
        `SELECT ${SQL_CONTRACT_COLUMNS} FROM contracts c WHERE c.tenant_id = $1 AND c.id = $2`,
        [tenantId, id],
      );
      if (existing.rowCount === 0) {
        throw AppException.notFound('指定された契約書が見つかりません');
      }

      const current = existing.rows[0];
      if (current.status !== 'active') {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          `active状態の契約書のみ解約処理が可能です (現在: ${current.status})`,
        );
      }

      const result = await client.query<ContractRow>(
        `UPDATE contracts c
         SET status = 'terminated', updated_at = now()
         WHERE c.tenant_id = $1 AND c.id = $2
         RETURNING ${SQL_CONTRACT_COLUMNS}`,
        [tenantId, id],
      );

      const terminated = mapContractRow(result.rows[0]);

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'contract.terminated',
        targetType: 'contract',
        targetId: id,
        beforeData: { status: current.status },
        afterData: { status: 'terminated' },
      });

      return terminated;
    });
  }

  /**
   * 契約書添付ファイル (attachments document_category='contract') から条項をAI抽出し、
   * ai_suggestions に隔離保存して提案DTOを返却する。
   * 【原則遵守】contracts テーブルへの確定書き込みは一切行わない。
   */
  async extractTerms(
    tenantId: string,
    userId: string,
    input: ExtractContractTermsInput,
  ): Promise<AiSuggestionDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      // 1. attachment_id の存在確認 & テナント分離 & document_category 検証
      const attResult = await client.query<{
        id: string;
        tenant_id: string;
        file_name: string;
        document_category: string;
        storage_path: string;
        mime_type: string;
      }>(
        `SELECT id, tenant_id, file_name, document_category, storage_path, mime_type
         FROM attachments
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, input.attachment_id],
      );

      if (attResult.rowCount === 0) {
        throw AppException.notFound('指定された契約書添付ファイルが見つかりません');
      }

      const attachment = attResult.rows[0];
      if (attachment.document_category !== 'contract') {
        throw AppException.badRequest(
          `契約書以外の添付ファイル(category: ${attachment.document_category})からは契約条項を抽出できません`,
        );
      }

      // 2. 抽出対象テキストの取得 (実PDFからのテキスト抽出)
      // raw_text が明示的に指定されている場合はそれを優先し (テスト・デバッグ用)、
      // 指定がない場合は attachments.storage_path の実PDFファイルからテキストを抽出する。
      // 固定ダミー文章へのフォールバックは一切行わない。
      let contractText: string;
      if (input.raw_text?.trim()) {
        contractText = input.raw_text.trim();
      } else {
        contractText = await extractTextFromPdfFile(attachment.storage_path);
      }

      // 3. AI提案生成 (DEBT-003: modelName='contract-extractor-v1', provider='rule_engine')
      // target_type='contract', target_id=attachment.id (contracts.id 未生成のため一時的に attachment_id で紐付け)
      const suggestion = await this.aiSuggestions.generateContractSuggestion(
        client,
        tenantId,
        attachment.id,
        contractText,
        'contract-extractor-v1',
        'rule_engine',
      );

      // 4. 監査ログ記録
      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'contract.terms_extracted',
        targetType: 'attachment',
        targetId: attachment.id,
        afterData: {
          suggestion_id: suggestion.id,
          model_name: suggestion.model_name,
          provider: suggestion.provider,
        },
      });

      return suggestion;
    });
  }

  /**
   * 契約書本文のチャンク分割および contract_embeddings への保存・再生成を行う。
   */
  async syncContractEmbeddings(
    client: PoolClient,
    tenantId: string,
    contractId: string,
    text: string | null,
  ): Promise<void> {
    await client.query(
      `DELETE FROM contract_embeddings WHERE tenant_id = $1 AND contract_id = $2`,
      [tenantId, contractId],
    );
    if (!text || !text.trim()) return;

    const chunks = chunkContractText(text);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const vector = computeTextEmbedding(chunk);
      await client.query(
        `INSERT INTO contract_embeddings (
           tenant_id, contract_id, chunk_index, chunk_text, embedding, model_name
         ) VALUES ($1, $2, $3, $4, $5::vector, $6)`,
        [tenantId, contractId, i, chunk, toVectorLiteral(vector), PSEUDO_EMBEDDING_MODEL],
      );
    }
  }

  /**
   * 指定契約に類似する他契約を検索する (P1-T6)。
   * RLS + アプリケーション層 (tenant_id = $1, contract_id != $2) の二重絞り込みを実施。
   */
  async findSimilarContractsById(
    tenantId: string,
    userId: string | null,
    contractId: string,
    query: SimilarContractsQuery,
  ): Promise<SimilarContractDto[]> {
    return this.db.transaction(tenantId, userId, async (client) => {
      // 対象契約の存在確認
      const targetCheck = await client.query<{ id: string }>(
        `SELECT id FROM contracts WHERE tenant_id = $1 AND id = $2`,
        [tenantId, contractId],
      );
      if (targetCheck.rowCount === 0) {
        throw AppException.notFound('指定された契約書が見つかりません');
      }

      const targetChunks = await client.query<{ id: string }>(
        `SELECT 1 FROM contract_embeddings WHERE tenant_id = $1 AND contract_id = $2 LIMIT 1`,
        [tenantId, contractId],
      );
      if (targetChunks.rowCount === 0) {
        return [];
      }

      const result = await client.query<SimilarContractRow>(
        `WITH target_chunks AS (
           SELECT embedding FROM contract_embeddings WHERE tenant_id = $1 AND contract_id = $2
         ),
         chunk_matches AS (
           SELECT
             e.contract_id,
             e.chunk_index AS matched_chunk_index,
             e.chunk_text AS matched_chunk_text,
             (1 - (e.embedding <=> tc.embedding)) AS similarity_score,
             ROW_NUMBER() OVER(
               PARTITION BY e.contract_id
               ORDER BY (e.embedding <=> tc.embedding) ASC
             ) as rn
           FROM contract_embeddings e
           CROSS JOIN target_chunks tc
           WHERE e.tenant_id = $1 AND e.contract_id != $2
         )
         SELECT
           c.id,
           c.contract_no,
           c.title,
           c.counterparty_name,
           c.contract_type,
           c.contract_amount,
           c.status,
           cm.similarity_score,
           cm.matched_chunk_index,
           cm.matched_chunk_text
         FROM chunk_matches cm
         JOIN contracts c ON c.tenant_id = $1 AND c.id = cm.contract_id
         WHERE cm.rn = 1 AND cm.similarity_score >= $3
           AND c.status = ANY($5)
         ORDER BY cm.similarity_score DESC
         LIMIT $4`,
        [tenantId, contractId, query.threshold, query.limit, [...CONFIRMED_SEARCH_CONTRACT_STATUSES]],
      );

      return result.rows.map(mapSimilarContractRow);
    });
  }

  /**
   * 自然文クエリから類似する契約条項・契約を検索する (P1-T6)。
   * RLS + アプリケーション層 (tenant_id = $1) の二重絞り込みを実施。
   */
  async searchSimilarContractsByText(
    tenantId: string,
    userId: string | null,
    query: SearchSimilarContractsQuery,
  ): Promise<SimilarContractDto[]> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const vector = computeTextEmbedding(query.q);
      const vectorLiteral = toVectorLiteral(vector);

      const result = await client.query<SimilarContractRow>(
        `WITH chunk_matches AS (
           SELECT
             e.contract_id,
             e.chunk_index AS matched_chunk_index,
             e.chunk_text AS matched_chunk_text,
             (1 - (e.embedding <=> $2::vector)) AS similarity_score,
             ROW_NUMBER() OVER(
               PARTITION BY e.contract_id
               ORDER BY (e.embedding <=> $2::vector) ASC
             ) as rn
           FROM contract_embeddings e
           WHERE e.tenant_id = $1
         )
         SELECT
           c.id,
           c.contract_no,
           c.title,
           c.counterparty_name,
           c.contract_type,
           c.contract_amount,
           c.status,
           cm.similarity_score,
           cm.matched_chunk_index,
           cm.matched_chunk_text
         FROM chunk_matches cm
         JOIN contracts c ON c.tenant_id = $1 AND c.id = cm.contract_id
         WHERE cm.rn = 1 AND cm.similarity_score >= $3
           AND c.status = ANY($5)
         ORDER BY cm.similarity_score DESC
         LIMIT $4`,
        [tenantId, vectorLiteral, query.threshold, query.limit, [...CONFIRMED_SEARCH_CONTRACT_STATUSES]],
      );

      return result.rows.map(mapSimilarContractRow);
    });
  }

  /**
   * 契約更新期限サマリーを取得する (P5-T1 / 横断KPIダッシュボード用)
   */
  async getExpirySummary(tenantId: string, userId: string | null): Promise<ContractKpiDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const contractRes = await client.query<{
        active_count: number;
        expiring_soon: number;
        within_30: number;
        within_60: number;
      }>(
        `SELECT
           COUNT(*)::int AS active_count,
           COUNT(CASE
             WHEN end_date <= (CURRENT_DATE + (COALESCE(renewal_notice_days, 30) || ' days')::interval)
              AND end_date >= CURRENT_DATE THEN 1
           END)::int AS expiring_soon,
           COUNT(CASE
             WHEN end_date <= (CURRENT_DATE + interval '30 days')
              AND end_date >= CURRENT_DATE THEN 1
           END)::int AS within_30,
           COUNT(CASE
             WHEN end_date <= (CURRENT_DATE + interval '60 days')
              AND end_date >= CURRENT_DATE THEN 1
           END)::int AS within_60
         FROM contracts
         WHERE tenant_id = $1 AND status = 'active'`,
        [tenantId],
      );

      const row = contractRes.rows[0];
      return {
        active_contracts_count: Number(row?.active_count || 0),
        expiring_soon_count: Number(row?.expiring_soon || 0),
        expiring_within_30_days: Number(row?.within_30 || 0),
        expiring_within_60_days: Number(row?.within_60 || 0),
      };
    });
  }
}

