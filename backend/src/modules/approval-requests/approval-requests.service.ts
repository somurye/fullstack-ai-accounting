import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { DatabaseService } from '../../database/database.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  APPROVAL_HISTORY_COLUMNS,
  APPROVAL_REQUEST_COLUMNS,
  mapApprovalHistoryRow,
  mapApprovalRequestRow,
  type ApprovalHistoryEntryDto,
  type ApprovalHistoryRow,
  type ApprovalRequestDto,
  type ApprovalRequestRow,
} from './approval-requests.mapper';
import type {
  ApprovalRequestApproveInput,
  ApprovalRequestListQuery,
  ApprovalRequestRejectInput,
} from './dto/approval-request.schemas';

export interface ApprovalRequestListResult {
  requests: ApprovalRequestDto[];
  pagination: PaginationMeta;
}

type TargetType =
  | 'journal_entry'
  | 'expense_report'
  | 'vendor_bill'
  | 'contract'
  | 'purchase_request';

/**
 * ApprovalRequestsService
 * ========================
 * `docs/openapi.yaml` `tags: [ApprovalRequests]` の汎用承認インボックスを実装する。
 *
 * `expense_reports`/`vendor_bills` は既に自モジュール内で `approval_requests`/
 * `approval_history` へ直接書き込んでいる(申請提出時の承認依頼作成、
 * `expense-reports`は専用の`/expense-reports/{id}/approve|reject`サブリソースも実装済み)。
 * 一方 `vendor_bills` の提出フローは承認依頼(pending)を作成するのみで、
 * それを承認/却下する手段がこれまで存在しなかった(このモジュールが担う)。
 * `journal_entries` も同様に、`post()` が承認ルール該当時に`pending_approval`の
 * 承認依頼を作成するよう改修されるため、その承認/却下はこのモジュールのみが担う。
 *
 * 新ドメイン（`contract`, `purchase_request`等）に対しても汎用承認エンジンとして機能し、
 * 各ドメイン固有テーブルとの状態連動は各Phaseのモジュールで連携する。
 *
 * 自己承認の禁止はDB トリガー `fn_prevent_self_approval`(`approval_history` への
 * INSERT時に発火)による最終防御に委ね、アプリケーション層での事前チェックは行わない
 * (`expense-reports.service.ts` の既存実装と同じ方針。トリガー起因のエラーは
 * `pg-error-mapper.ts` が `SELF_APPROVAL_NOT_ALLOWED` へ全モジュール共通で変換する)。
 */
@Injectable()
export class ApprovalRequestsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async list(
    tenantId: string,
    userId: string | null,
    currentUserId: string,
    query: ApprovalRequestListQuery,
  ): Promise<ApprovalRequestListResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const conditions: string[] = ['ar.tenant_id = $1'];
      const params: unknown[] = [tenantId];

      if (query.status) {
        params.push(query.status);
        conditions.push(`ar.status = $${params.length}`);
      }
      if (query.target_type) {
        params.push(query.target_type);
        conditions.push(`ar.target_type = $${params.length}`);
      }
      if (query.pending_for_me) {
        params.push(currentUserId);
        const userIdParamIndex = params.length;
        conditions.push(
          `ar.status = 'pending' AND ar.submitted_by <> $${userIdParamIndex} AND EXISTS (
             SELECT 1 FROM approval_rules rule
             WHERE rule.tenant_id = ar.tenant_id AND rule.target_type = ar.target_type
               AND rule.step_number = ar.current_step AND rule.is_active = TRUE
               AND (
                 rule.approver_user_id = $${userIdParamIndex}
                 OR rule.approver_role_id IN (
                   SELECT role_id FROM user_roles
                   WHERE tenant_id = ar.tenant_id AND user_id = $${userIdParamIndex}
                 )
               )
           )`,
        );
      }
      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM approval_requests ar WHERE ${whereClause}`,
        params,
      );
      const totalCount = Number(countResult.rows[0]?.count ?? 0);

      const listParams = [...params, query.page_size, (query.page - 1) * query.page_size];
      const result = await client.query<ApprovalRequestRow>(
        `SELECT ${APPROVAL_REQUEST_COLUMNS} FROM approval_requests ar
         WHERE ${whereClause}
         ORDER BY ar.created_at DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );

      const historyByRequestId = await this.fetchHistoryForRequests(
        client,
        tenantId,
        result.rows.map((row) => row.id),
      );
      const requests = result.rows.map((row) =>
        mapApprovalRequestRow(row, historyByRequestId.get(row.id) ?? []),
      );

      return { requests, pagination: buildPagination(query.page, query.page_size, totalCount) };
    });
  }

  async findById(tenantId: string, userId: string | null, id: string): Promise<ApprovalRequestDto> {
    return this.db.transaction(tenantId, userId, (client) => this.fetchDetail(client, tenantId, id));
  }

  async approve(
    tenantId: string,
    userId: string,
    id: string,
    dto: ApprovalRequestApproveInput,
  ): Promise<ApprovalRequestDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const ar = await this.fetchPendingRequest(client, tenantId, id);
      await this.assertAssignedApprover(client, tenantId, userId, ar);

      // `fn_prevent_self_approval` トリガーが submitted_by = approver_id を検知して
      // 23514(check_violation)を送出する(申請者本人による承認の防止)。
      await client.query(
        `INSERT INTO approval_history (tenant_id, approval_request_id, step_number, approver_id, action, comment)
         VALUES ($1, $2, $3, $4, 'approve', $5)`,
        [tenantId, ar.id, ar.current_step, userId, dto.comment ?? null],
      );

      if (ar.current_step >= ar.total_steps) {
        await client.query(`UPDATE approval_requests SET status = 'approved' WHERE id = $1`, [ar.id]);
        await this.finalizeApproval(client, tenantId, userId, ar.target_type, ar.target_id);
      } else {
        const nextStep = ar.current_step + 1;
        await client.query(`UPDATE approval_requests SET current_step = $2 WHERE id = $1`, [
          ar.id,
          nextStep,
        ]);
        await this.markInProgress(client, tenantId, ar.target_type, ar.target_id, nextStep);
      }

      return this.fetchDetail(client, tenantId, id);
    });
  }

  async reject(
    tenantId: string,
    userId: string,
    id: string,
    dto: ApprovalRequestRejectInput,
  ): Promise<ApprovalRequestDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const ar = await this.fetchPendingRequest(client, tenantId, id);
      await this.assertAssignedApprover(client, tenantId, userId, ar);

      await client.query(
        `INSERT INTO approval_history (tenant_id, approval_request_id, step_number, approver_id, action, comment)
         VALUES ($1, $2, $3, $4, 'reject', $5)`,
        [tenantId, ar.id, ar.current_step, userId, dto.comment],
      );

      await client.query(`UPDATE approval_requests SET status = 'rejected' WHERE id = $1`, [ar.id]);
      await this.applyRejection(client, tenantId, userId, ar.target_type, ar.target_id);

      return this.fetchDetail(client, tenantId, id);
    });
  }

  // --------------------------------------------------------------------------
  // 内部ヘルパー
  // --------------------------------------------------------------------------

  private async fetchPendingRequest(
    client: PoolClient,
    tenantId: string,
    id: string,
  ): Promise<ApprovalRequestRow> {
    const result = await client.query<ApprovalRequestRow>(
      `SELECT ${APPROVAL_REQUEST_COLUMNS} FROM approval_requests WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    if (result.rowCount === 0) {
      throw AppException.notFound('指定された承認依頼が見つかりません');
    }
    const ar = result.rows[0];
    if (ar.status !== 'pending') {
      throw AppException.conflict('INVALID_STATE_TRANSITION', 'この承認依頼は既に完了しています');
    }
    return ar;
  }

  /**
   * 呼び出しユーザーが、この承認依頼の現在のステップに割り当てられた承認者
   * (`approval_rules.approver_user_id` または `approver_role_id` 経由)であることを検証する。
   * 自己承認の禁止はDBトリガー(`fn_prevent_self_approval`)に委ねているが、
   * 「そもそも承認権限を割り当てられていない第三者」による承認/却下は
   * DB制約だけでは防げないため、ここでアプリケーション層のガードとして必須で行う。
   */
  private async assertAssignedApprover(
    client: PoolClient,
    tenantId: string,
    userId: string,
    ar: ApprovalRequestRow,
  ): Promise<void> {
    // 契約書(target_type='contract')の場合、実行ユーザーが contract.approve パーミッションを保持していることを検証 (DEBT-005)
    if (ar.target_type === 'contract') {
      const permCheck = await client.query(
        `SELECT 1
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE ur.tenant_id = $1 AND ur.user_id = $2
           AND p.code = 'contract.approve'
         LIMIT 1`,
        [tenantId, userId],
      );
      if (permCheck.rowCount === 0) {
        throw AppException.forbidden('契約書の承認・却下を行う権限(contract.approve)がありません');
      }
    }

    const result = await client.query(
      `SELECT 1 FROM approval_rules rule
       WHERE rule.tenant_id = $1 AND rule.target_type = $2
         AND rule.step_number = $3 AND rule.is_active = TRUE
         AND (
           rule.approver_user_id = $4
           OR rule.approver_role_id IN (
             SELECT role_id FROM user_roles WHERE tenant_id = $1 AND user_id = $4
           )
         )
       LIMIT 1`,
      [tenantId, ar.target_type, ar.current_step, userId],
    );
    if (result.rowCount === 0) {
      throw AppException.forbidden('この承認依頼のステップに割り当てられた承認者ではありません');
    }
  }

  /** 最終ステップの承認完了時、対象リソースをapproved/postedへ遷移させる */
  private async finalizeApproval(
    client: PoolClient,
    tenantId: string,
    userId: string,
    targetType: TargetType,
    targetId: string,
  ): Promise<void> {
    if (targetType === 'journal_entry') {
      await client.query(
        `UPDATE journal_entries SET status = 'posted', posted_by = $3 WHERE tenant_id = $1 AND id = $2`,
        [tenantId, targetId, userId],
      );
      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'journal_entry.posted',
        targetType: 'journal_entry',
        targetId,
        afterData: { status: 'posted' },
      });
      return;
    }

    if (targetType === 'expense_report' || targetType === 'vendor_bill') {
      const table = targetType === 'expense_report' ? 'expense_reports' : 'vendor_bills';
      const linked = await client.query<{ journal_entry_id: string | null }>(
        `SELECT journal_entry_id FROM ${table} WHERE tenant_id = $1 AND id = $2`,
        [tenantId, targetId],
      );
      if (linked.rowCount === 0) {
        throw AppException.notFound('承認対象のレコードが見つかりません');
      }
      const journalEntryId = linked.rows[0].journal_entry_id;

      await client.query(`UPDATE ${table} SET status = 'approved' WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        targetId,
      ]);
      if (journalEntryId) {
        // 申請時に先行起票していたdraft仕訳を確定する(貸借一致は明細行の1:1対応で構造上保証済み)。
        await client.query(
          `UPDATE journal_entries SET status = 'posted', posted_by = $3 WHERE tenant_id = $1 AND id = $2`,
          [tenantId, journalEntryId, userId],
        );
      }
      if (targetType === 'vendor_bill') {
        await client.query(
          `UPDATE vendor_bills SET current_approval_step = current_approval_step + 1
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, targetId],
        );
      }

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: `${targetType}.approved`,
        targetType,
        targetId,
        afterData: { status: 'approved', journalEntry_id: journalEntryId },
      });
      return;
    }

    if (targetType === 'contract') {
      await client.query(
        `UPDATE contracts SET status = 'active', approved_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, targetId],
      );
      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'contract.approved',
        targetType: 'contract',
        targetId,
        afterData: { status: 'active' },
      });
      return;
    }

    // 新ドメイン (purchase_request 等)
    await this.auditLogs.record(client, tenantId, {
      actorUserId: userId,
      action: `${targetType}.approved`,
      targetType,
      targetId,
      afterData: { status: 'approved' },
    });
  }

  /** 多段階承認の途中ステップ完了時、対象リソースの表示ステータスを更新する */
  private async markInProgress(
    client: PoolClient,
    tenantId: string,
    targetType: TargetType,
    targetId: string,
    nextStep: number,
  ): Promise<void> {
    if (targetType === 'expense_report') {
      await client.query(
        `UPDATE expense_reports SET status = 'in_review' WHERE tenant_id = $1 AND id = $2`,
        [tenantId, targetId],
      );
    } else if (targetType === 'vendor_bill') {
      await client.query(
        `UPDATE vendor_bills SET current_approval_step = $3 WHERE tenant_id = $1 AND id = $2`,
        [tenantId, targetId, nextStep],
      );
    }
    // journal_entry, contract, purchase_request 等は中間ステップでは承認依頼側のcurrent_stepのみ進行
  }

  /** 却下時、対象リソースをrejectedへ遷移させ、先行起票していたdraft仕訳を破棄する */
  private async applyRejection(
    client: PoolClient,
    tenantId: string,
    userId: string,
    targetType: TargetType,
    targetId: string,
  ): Promise<void> {
    if (targetType === 'journal_entry') {
      await client.query(
        `UPDATE journal_entries SET status = 'rejected' WHERE tenant_id = $1 AND id = $2`,
        [tenantId, targetId],
      );
      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'journal_entry.rejected',
        targetType: 'journal_entry',
        targetId,
        afterData: { status: 'rejected' },
      });
      return;
    }

    if (targetType === 'expense_report' || targetType === 'vendor_bill') {
      const table = targetType === 'expense_report' ? 'expense_reports' : 'vendor_bills';
      const linked = await client.query<{ journal_entry_id: string | null }>(
        `SELECT journal_entry_id FROM ${table} WHERE tenant_id = $1 AND id = $2`,
        [tenantId, targetId],
      );
      if (linked.rowCount === 0) {
        throw AppException.notFound('却下対象のレコードが見つかりません');
      }
      const journalEntryId = linked.rows[0].journal_entry_id;

      await client.query(`UPDATE ${table} SET status = 'rejected' WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        targetId,
      ]);
      if (journalEntryId) {
        // journal_entriesは物理削除ができないため、draft状態からvoidedへ遷移させることで
        // 「破棄」を表現する(draftからの遷移はガードトリガーで制限されていない)。
        await client.query(
          `UPDATE journal_entries
           SET status = 'voided', voided_at = now(), voided_by = $3
           WHERE tenant_id = $1 AND id = $2 AND status = 'draft'`,
          [tenantId, journalEntryId, userId],
        );
      }

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: `${targetType}.rejected`,
        targetType,
        targetId,
        afterData: { status: 'rejected' },
      });
      return;
    }

    if (targetType === 'contract') {
      await client.query(
        `UPDATE contracts SET status = 'rejected', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, targetId],
      );
      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'contract.rejected',
        targetType: 'contract',
        targetId,
        afterData: { status: 'rejected' },
      });
      return;
    }

    // 新ドメイン (purchase_request 等)
    await this.auditLogs.record(client, tenantId, {
      actorUserId: userId,
      action: `${targetType}.rejected`,
      targetType,
      targetId,
      afterData: { status: 'rejected' },
    });
  }

  private async fetchDetail(client: PoolClient, tenantId: string, id: string): Promise<ApprovalRequestDto> {
    const result = await client.query<ApprovalRequestRow>(
      `SELECT ${APPROVAL_REQUEST_COLUMNS} FROM approval_requests WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    const row = result.rows[0];
    if (!row) {
      throw AppException.notFound('指定された承認依頼が見つかりません');
    }

    const historyResult = await client.query<ApprovalHistoryRow>(
      `SELECT ${APPROVAL_HISTORY_COLUMNS} FROM approval_history
       WHERE tenant_id = $1 AND approval_request_id = $2
       ORDER BY acted_at ASC`,
      [tenantId, id],
    );

    return mapApprovalRequestRow(row, historyResult.rows.map(mapApprovalHistoryRow));
  }

  private async fetchHistoryForRequests(
    client: PoolClient,
    tenantId: string,
    requestIds: string[],
  ): Promise<Map<string, ApprovalHistoryEntryDto[]>> {
    const map = new Map<string, ApprovalHistoryEntryDto[]>();
    if (requestIds.length === 0) return map;

    const result = await client.query<ApprovalHistoryRow & { approval_request_id: string }>(
      `SELECT approval_request_id, ${APPROVAL_HISTORY_COLUMNS} FROM approval_history
       WHERE tenant_id = $1 AND approval_request_id = ANY($2::uuid[])
       ORDER BY acted_at ASC`,
      [tenantId, requestIds],
    );
    for (const row of result.rows) {
      const list = map.get(row.approval_request_id) ?? [];
      list.push(mapApprovalHistoryRow(row));
      map.set(row.approval_request_id, list);
    }
    return map;
  }
}
