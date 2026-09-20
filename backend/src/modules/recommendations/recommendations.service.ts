import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ContractRenewalLinksService } from '../contract-renewal-links/contract-renewal-links.service';
import { ApprovalRequestsService } from '../approval-requests/approval-requests.service';
import { QuotationsService } from '../quotations/quotations.service';
import { AppException } from '../../common/exceptions/app.exception';
import type {
  RecommendationDto,
  RecommendationListQueryDto,
  RecommendationActionResponseDto,
  RecommendationDomain,
  RecommendationType,
} from './recommendations.dto';

interface RecommendationRow {
  id: string;
  tenant_id: string;
  type: RecommendationType;
  target_domain: RecommendationDomain;
  target_id: string;
  title: string;
  message: string;
  status: string;
  action_url: string | null;
  metadata: any;
  shown_at: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class RecommendationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
    private readonly contractRenewalLinksService: ContractRenewalLinksService,
    private readonly approvalRequestsService: ApprovalRequestsService,
    private readonly quotationsService: QuotationsService,
  ) {}

  /**
   * ユーザーのロールに基づきアクセス可能な推奨ドメイン一覧を判定する
   */
  private getAccessibleDomains(roles: string[]): RecommendationDomain[] {
    const accessibleDomains = new Set<RecommendationDomain>();

    // 契約ドメイン: owner, legal_admin, accounting_manager, employee, accountant, approver, legal_viewer, bookkeeper
    const contractRoles = [
      'owner',
      'legal_admin',
      'accounting_manager',
      'employee',
      'accountant',
      'approver',
      'legal_viewer',
      'bookkeeper',
    ];
    if (roles.some((r) => contractRoles.includes(r))) {
      accessibleDomains.add('contracts');
    }

    // 承認ドメイン: owner, accounting_manager, approver, accountant, legal_admin, payroll_admin, employee
    const approvalRoles = [
      'owner',
      'accounting_manager',
      'approver',
      'accountant',
      'legal_admin',
      'payroll_admin',
      'employee',
    ];
    if (roles.some((r) => approvalRoles.includes(r))) {
      accessibleDomains.add('approval_requests');
    }

    // 見積・営業ドメイン: owner, accounting_manager, employee
    const salesRoles = ['owner', 'accounting_manager', 'employee'];
    if (roles.some((r) => salesRoles.includes(r))) {
      accessibleDomains.add('quotations');
    }

    return Array.from(accessibleDomains);
  }

  /**
   * ルールベースのレコメンドをオンデマンド生成し永続化する (各ドメインServiceへの委譲)
   */
  async generateRecommendations(tenantId: string, userId: string | null): Promise<void> {
    // 1. 契約更新未着手レコメンド (P1-T4 x P4-T3)
    const unlinkedContracts = await this.contractRenewalLinksService.getUnlinkedExpiringContracts(
      tenantId,
      userId,
    );
    for (const contract of unlinkedContracts) {
      await this.db.transaction(tenantId, userId, async (client) => {
        const title = `契約更新提案の起票推奨: ${contract.title}`;
        const message = `契約「${contract.title}」（契約番号: ${contract.contract_no}、相手先: ${contract.counterparty_name}）は ${contract.end_date}（残り約${contract.days_until_expiry}日）に満了・更新を迎えますが、更新提案案件がまだ作成されていません。更新提案の案件作成をお勧めします。`;
        const actionUrl = `/deals/new?contract_id=${contract.id}`;
        const metadata = {
          contract_id: contract.id,
          contract_no: contract.contract_no,
          counterparty_name: contract.counterparty_name,
          end_date: contract.end_date,
          days_until_expiry: contract.days_until_expiry,
          auto_renewal: contract.auto_renewal,
        };

        await client.query(
          `INSERT INTO recommendations (
             tenant_id, type, target_domain, target_id, title, message, status, action_url, metadata, created_at, updated_at
           ) VALUES (
             $1, 'contract_renewal_pending', 'contracts', $2, $3, $4, 'pending', $5, $6, NOW(), NOW()
           )
           ON CONFLICT (tenant_id, type, target_id) DO NOTHING`,
          [tenantId, contract.id, title, message, actionUrl, JSON.stringify(metadata)],
        );
      });
    }

    // 2. 承認申請滞留レコメンド (Phase 0 汎用承認)
    const staleApprovals = await this.approvalRequestsService.getStalePendingRequests(
      tenantId,
      userId,
      5,
    );
    for (const approval of staleApprovals) {
      await this.db.transaction(tenantId, userId, async (client) => {
        const title = `承認依頼の滞留アラート: ${approval.target_type} #${approval.id.slice(0, 8)}`;
        const message = `種別「${approval.target_type}」の承認依頼が提出後 ${approval.days_pending} 日間承認待ちのまま滞留しています（ステップ: ${approval.current_step}/${approval.total_steps}）。早期の承認確認または催促をお勧めします。`;
        const actionUrl = `/approval-requests`;
        const metadata = {
          approval_request_id: approval.id,
          target_type: approval.target_type,
          target_id: approval.target_id,
          current_step: approval.current_step,
          total_steps: approval.total_steps,
          days_pending: approval.days_pending,
        };

        await client.query(
          `INSERT INTO recommendations (
             tenant_id, type, target_domain, target_id, title, message, status, action_url, metadata, created_at, updated_at
           ) VALUES (
             $1, 'approval_stale', 'approval_requests', $2, $3, $4, 'pending', $5, $6, NOW(), NOW()
           )
           ON CONFLICT (tenant_id, type, target_id) DO NOTHING`,
          [tenantId, approval.id, title, message, actionUrl, JSON.stringify(metadata)],
        );
      });
    }

    // 3. 送付済見積フォローアップレコメンド (Phase 4 営業事務)
    const staleQuotations = await this.quotationsService.getStaleSentQuotations(
      tenantId,
      userId,
      14,
    );
    for (const quote of staleQuotations) {
      await this.db.transaction(tenantId, userId, async (client) => {
        const title = `送付済見積のフォローアップ推奨: ${quote.quote_no}`;
        const message = `見積「${quote.title}」（見積番号: ${quote.quote_no}、金額: ¥${quote.total_amount.toLocaleString()}）の送付から ${quote.days_since_issue} 日が経過していますが、成約・失注の回答が記録されていません。顧客への進捗確認・フォローアップをお勧めします。`;
        const actionUrl = `/quotations/${quote.id}`;
        const metadata = {
          quotation_id: quote.id,
          quote_no: quote.quote_no,
          customer_id: quote.customer_id,
          deal_id: quote.deal_id,
          total_amount: quote.total_amount,
          issue_date: quote.issue_date,
          days_since_issue: quote.days_since_issue,
        };

        await client.query(
          `INSERT INTO recommendations (
             tenant_id, type, target_domain, target_id, title, message, status, action_url, metadata, created_at, updated_at
           ) VALUES (
             $1, 'quotation_follow_up', 'quotations', $2, $3, $4, 'pending', $5, $6, NOW(), NOW()
           )
           ON CONFLICT (tenant_id, type, target_id) DO NOTHING`,
          [tenantId, quote.id, title, message, actionUrl, JSON.stringify(metadata)],
        );
      });
    }
  }

  /**
   * レコメンド一覧取得 (閲覧権限ドメインによるフィルタリング付き)
   */
  async list(
    tenantId: string,
    userId: string,
    roles: string[],
    query: RecommendationListQueryDto = {},
  ): Promise<RecommendationDto[]> {
    // 1. まずオンデマンドで最新の推奨を差分生成・永続化
    await this.generateRecommendations(tenantId, userId);

    // 2. ユーザーの権限に基づきアクセス可能なドメインを判定
    const accessibleDomains = this.getAccessibleDomains(roles);
    if (accessibleDomains.length === 0) {
      return [];
    }

    return this.db.transaction(tenantId, userId, async (client) => {
      const conditions: string[] = ['tenant_id = $1'];
      const params: any[] = [tenantId];

      // アクセス可能ドメインで絞り込み (情報推測防止)
      params.push(accessibleDomains);
      conditions.push(`target_domain = ANY($${params.length})`);

      if (query.status) {
        params.push(query.status);
        conditions.push(`status = $${params.length}`);
      } else {
        // デフォルトでは未処理 (pending, new, shown) を優先して表示
        conditions.push(`status IN ('pending', 'new', 'shown')`);
      }

      if (query.target_domain) {
        if (!accessibleDomains.includes(query.target_domain)) {
          return [];
        }
        params.push(query.target_domain);
        conditions.push(`target_domain = $${params.length}`);
      }

      const sql = `
        SELECT
          id, tenant_id, type, target_domain, target_id, title, message,
          status, action_url, metadata, shown_at::text, responded_at::text,
          created_at::text, updated_at::text
        FROM recommendations
        WHERE ${conditions.join(' AND ')}
        ORDER BY created_at DESC
      `;

      const res = await client.query<RecommendationRow>(sql, params);
      return res.rows.map(this.mapRowToDto);
    });
  }

  /**
   * レコメンドの採用 (accept)
   * ※ recommendations テーブルの status のみ更新し、業務テーブルは一切変更しない
   */
  async accept(
    tenantId: string,
    userId: string,
    roles: string[],
    id: string,
  ): Promise<RecommendationActionResponseDto> {
    const accessibleDomains = this.getAccessibleDomains(roles);

    return this.db.transaction(tenantId, userId, async (client) => {
      const fetchSql = `
        SELECT
          id, tenant_id, type, target_domain, target_id, title, message,
          status, action_url, metadata, shown_at::text, responded_at::text,
          created_at::text, updated_at::text
        FROM recommendations
        WHERE id = $1 AND tenant_id = $2
      `;
      const checkRes = await client.query<RecommendationRow>(fetchSql, [id, tenantId]);
      if (checkRes.rows.length === 0) {
        throw AppException.notFound(`指定されたレコメンドが見つかりません (ID: ${id})`);
      }
      const existing = checkRes.rows[0];

      if (!accessibleDomains.includes(existing.target_domain)) {
        throw AppException.forbidden('このレコメンドに対する操作権限がありません');
      }

      // ステータス更新 (業務テーブルには一切書き込まない)
      const updateSql = `
        UPDATE recommendations
        SET status = 'accepted', responded_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
        RETURNING
          id, tenant_id, type, target_domain, target_id, title, message,
          status, action_url, metadata, shown_at::text, responded_at::text,
          created_at::text, updated_at::text
      `;
      const updateRes = await client.query<RecommendationRow>(updateSql, [id, tenantId]);
      const updated = updateRes.rows[0];

      // 監査ログ記録
      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'recommendation.accept',
        targetType: 'recommendation',
        targetId: id,
        beforeData: { status: existing.status },
        afterData: { status: 'accepted', action_url: updated.action_url },
      });

      return {
        recommendation: this.mapRowToDto(updated),
        message: 'レコメンドを採用しました。提案された業務操作画面へ移動してください。',
        next_action_url: updated.action_url,
      };
    });
  }

  /**
   * レコメンドの見送り (dismiss)
   * ※ recommendations テーブルの status のみ更新し、業務テーブルは一切変更しない
   */
  async dismiss(
    tenantId: string,
    userId: string,
    roles: string[],
    id: string,
  ): Promise<RecommendationActionResponseDto> {
    const accessibleDomains = this.getAccessibleDomains(roles);

    return this.db.transaction(tenantId, userId, async (client) => {
      const fetchSql = `
        SELECT
          id, tenant_id, type, target_domain, target_id, title, message,
          status, action_url, metadata, shown_at::text, responded_at::text,
          created_at::text, updated_at::text
        FROM recommendations
        WHERE id = $1 AND tenant_id = $2
      `;
      const checkRes = await client.query<RecommendationRow>(fetchSql, [id, tenantId]);
      if (checkRes.rows.length === 0) {
        throw AppException.notFound(`指定されたレコメンドが見つかりません (ID: ${id})`);
      }
      const existing = checkRes.rows[0];

      if (!accessibleDomains.includes(existing.target_domain)) {
        throw AppException.forbidden('このレコメンドに対する操作権限がありません');
      }

      // ステータス更新 (業務テーブルには一切書き込まない)
      const updateSql = `
        UPDATE recommendations
        SET status = 'dismissed', responded_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2
        RETURNING
          id, tenant_id, type, target_domain, target_id, title, message,
          status, action_url, metadata, shown_at::text, responded_at::text,
          created_at::text, updated_at::text
      `;
      const updateRes = await client.query<RecommendationRow>(updateSql, [id, tenantId]);
      const updated = updateRes.rows[0];

      // 監査ログ記録
      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'recommendation.dismiss',
        targetType: 'recommendation',
        targetId: id,
        beforeData: { status: existing.status },
        afterData: { status: 'dismissed' },
      });

      return {
        recommendation: this.mapRowToDto(updated),
        message: 'レコメンドを見送りました。',
        next_action_url: null,
      };
    });
  }

  private mapRowToDto(row: RecommendationRow): RecommendationDto {
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      type: row.type,
      target_domain: row.target_domain,
      target_id: row.target_id,
      title: row.title,
      message: row.message,
      status: row.status as any,
      action_url: row.action_url,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {},
      shown_at: row.shown_at,
      responded_at: row.responded_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
