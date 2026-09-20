import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import {
  SalesDashboardSummaryDto,
  DealPipelineSummaryDto,
  QuotationSummaryDto,
  RenewalLinkSummaryDto,
  StageCountItem,
  QuotationStatusCountItem,
  SalesDashboardQuery,
} from './sales-dashboard.dto';
import type { SalesKpiDto } from '../executive-dashboard/executive-dashboard.dto';

@Injectable()
export class SalesDashboardService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * RBAC権限チェックヘルパー
   */
  private assertPermission(roles: string[], permission: string): void {
    const rolePermissionsMap: Record<string, string[]> = {
      owner: ['dashboard.view'],
      accounting_manager: ['dashboard.view'],
      accountant: ['dashboard.view'],
      legal_admin: ['dashboard.view'],
      legal_viewer: ['dashboard.view'],
      approver: ['dashboard.view'],
      bookkeeper: ['dashboard.view'],
      employee: ['dashboard.view'],
      payroll_admin: [],
      viewer_external: [],
    };

    const hasPermission = roles.some((role) =>
      rolePermissionsMap[role]?.includes(permission),
    );

    if (!hasPermission) {
      throw AppException.forbidden(
        `この操作を実行する権限がありません (要求権限: ${permission})`,
      );
    }
  }

  /**
   * 営業ダッシュボード統合集計サマリーを取得する
   */
  async getSummary(
    tenantId: string,
    userId: string,
    roles: string[],
    _query?: SalesDashboardQuery,
  ): Promise<SalesDashboardSummaryDto> {
    this.assertPermission(roles, 'dashboard.view');

    return this.db.transaction(tenantId, userId, async (client) => {
      // 1. 案件パイプライン集計 (deals)
      const dealsRes = await client.query<{
        stage: string;
        count: number;
        total_amount: string;
      }>(
        `SELECT
           stage,
           COUNT(*)::int AS count,
           COALESCE(SUM(expected_amount), 0)::text AS total_amount
         FROM deals
         WHERE tenant_id = $1
         GROUP BY stage`,
        [tenantId],
      );

      const stageMap: Record<string, StageCountItem> = {
        lead: { count: 0, total_amount: 0 },
        qualified: { count: 0, total_amount: 0 },
        proposal: { count: 0, total_amount: 0 },
        negotiation: { count: 0, total_amount: 0 },
        won: { count: 0, total_amount: 0 },
        lost: { count: 0, total_amount: 0 },
      };

      for (const row of dealsRes.rows) {
        if (stageMap[row.stage]) {
          stageMap[row.stage] = {
            count: Number(row.count),
            total_amount: Number(row.total_amount),
          };
        }
      }

      const openCount =
        stageMap.lead.count +
        stageMap.qualified.count +
        stageMap.proposal.count +
        stageMap.negotiation.count;
      const openAmount =
        stageMap.lead.total_amount +
        stageMap.qualified.total_amount +
        stageMap.proposal.total_amount +
        stageMap.negotiation.total_amount;

      const totalDealsCount = openCount + stageMap.won.count + stageMap.lost.count;
      const totalDealsAmount =
        openAmount + stageMap.won.total_amount + stageMap.lost.total_amount;

      const closedCount = stageMap.won.count + stageMap.lost.count;
      const winRate =
        closedCount > 0 ? Math.round((stageMap.won.count / closedCount) * 10000) / 10000 : 0;

      const pipeline: DealPipelineSummaryDto = {
        lead: stageMap.lead,
        qualified: stageMap.qualified,
        proposal: stageMap.proposal,
        negotiation: stageMap.negotiation,
        won: stageMap.won,
        lost: stageMap.lost,
        open_deals: { count: openCount, total_amount: openAmount },
        won_deals: stageMap.won,
        lost_deals: stageMap.lost,
        total_deals: { count: totalDealsCount, total_amount: totalDealsAmount },
        win_rate: winRate,
      };

      // 2. 見積状態別集計 (quotations)
      const quoteRes = await client.query<{
        status: string;
        count: number;
        total_amount: string;
      }>(
        `SELECT
           status,
           COUNT(*)::int AS count,
           COALESCE(SUM(total_amount), 0)::text AS total_amount
         FROM quotations
         WHERE tenant_id = $1
         GROUP BY status`,
        [tenantId],
      );

      const quoteMap: Record<string, QuotationStatusCountItem> = {
        draft: { count: 0, total_amount: 0 },
        sent: { count: 0, total_amount: 0 },
        accepted: { count: 0, total_amount: 0 },
        rejected: { count: 0, total_amount: 0 },
        expired: { count: 0, total_amount: 0 },
      };

      for (const row of quoteRes.rows) {
        if (quoteMap[row.status]) {
          quoteMap[row.status] = {
            count: Number(row.count),
            total_amount: Number(row.total_amount),
          };
        }
      }

      const totalQuoteCount =
        quoteMap.draft.count +
        quoteMap.sent.count +
        quoteMap.accepted.count +
        quoteMap.rejected.count +
        quoteMap.expired.count;
      const totalQuoteAmount =
        quoteMap.draft.total_amount +
        quoteMap.sent.total_amount +
        quoteMap.accepted.total_amount +
        quoteMap.rejected.total_amount +
        quoteMap.expired.total_amount;

      const actionableCount =
        quoteMap.sent.count +
        quoteMap.accepted.count +
        quoteMap.rejected.count +
        quoteMap.expired.count;
      const conversionRate =
        actionableCount > 0
          ? Math.round((quoteMap.accepted.count / actionableCount) * 10000) / 10000
          : 0;

      const quotations: QuotationSummaryDto = {
        draft: quoteMap.draft,
        sent: quoteMap.sent,
        accepted: quoteMap.accepted,
        rejected: quoteMap.rejected,
        expired: quoteMap.expired,
        total_quotations: { count: totalQuoteCount, total_amount: totalQuoteAmount },
        actionable_count: actionableCount,
        conversion_rate: conversionRate,
      };

      // 3. 契約更新連携進捗集計 (contracts, contract_renewal_links, deals)
      // 3.1 P1-T4 アラート対象契約とリンク作成有無
      const alertContractsRes = await client.query<{
        id: string;
        has_link: boolean;
      }>(
        `SELECT
           c.id,
           EXISTS (
             SELECT 1 FROM contract_renewal_links crl
             WHERE crl.contract_id = c.id AND crl.tenant_id = $1
           ) AS has_link
         FROM contracts c
         WHERE c.tenant_id = $1
           AND c.status = 'active'
           AND c.end_date IS NOT NULL
           AND c.end_date <= (CURRENT_DATE + (COALESCE(c.renewal_notice_days, 30) || ' days')::interval)
           AND c.end_date >= CURRENT_DATE`,
        [tenantId],
      );

      const expiringContractsCount = alertContractsRes.rows.length;
      const linkedContractsCount = alertContractsRes.rows.filter((r) => r.has_link).length;
      const renewalProposalRate =
        expiringContractsCount > 0
          ? Math.round((linkedContractsCount / expiringContractsCount) * 10000) / 10000
          : 0;

      // 3.2 全更新リンク数
      const totalLinksRes = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM contract_renewal_links WHERE tenant_id = $1`,
        [tenantId],
      );
      const totalRenewalLinksCount = Number(totalLinksRes.rows[0]?.count || 0);

      // 3.3 リンクされた商談のステージ分布
      const linkedDealsRes = await client.query<{
        stage: string;
        count: number;
        total_amount: string;
      }>(
        `SELECT
           d.stage,
           COUNT(*)::int AS count,
           COALESCE(SUM(d.expected_amount), 0)::text AS total_amount
         FROM contract_renewal_links crl
         JOIN deals d ON d.id = crl.deal_id AND d.tenant_id = crl.tenant_id
         WHERE crl.tenant_id = $1
         GROUP BY d.stage`,
        [tenantId],
      );

      const linkedStageMap: Record<string, StageCountItem> = {
        lead: { count: 0, total_amount: 0 },
        qualified: { count: 0, total_amount: 0 },
        proposal: { count: 0, total_amount: 0 },
        negotiation: { count: 0, total_amount: 0 },
        won: { count: 0, total_amount: 0 },
        lost: { count: 0, total_amount: 0 },
      };

      for (const row of linkedDealsRes.rows) {
        if (linkedStageMap[row.stage]) {
          linkedStageMap[row.stage] = {
            count: Number(row.count),
            total_amount: Number(row.total_amount),
          };
        }
      }

      const totalLinkedDealsCount = Object.values(linkedStageMap).reduce(
        (acc, item) => acc + item.count,
        0,
      );
      const totalLinkedDealsAmount = Object.values(linkedStageMap).reduce(
        (acc, item) => acc + item.total_amount,
        0,
      );

      const renewals: RenewalLinkSummaryDto = {
        expiring_contracts_count: expiringContractsCount,
        linked_contracts_count: linkedContractsCount,
        renewal_proposal_rate: renewalProposalRate,
        total_renewal_links_count: totalRenewalLinksCount,
        linked_deals_stage_distribution: {
          lead: linkedStageMap.lead,
          qualified: linkedStageMap.qualified,
          proposal: linkedStageMap.proposal,
          negotiation: linkedStageMap.negotiation,
          won: linkedStageMap.won,
          lost: linkedStageMap.lost,
          total: { count: totalLinkedDealsCount, total_amount: totalLinkedDealsAmount },
        },
      };

      return {
        pipeline,
        quotations,
        renewals,
      };
    });
  }

  /**
   * 案件パイプライン集計単体取得
   */
  async getPipelineSummary(
    tenantId: string,
    userId: string,
    roles: string[],
  ): Promise<DealPipelineSummaryDto> {
    const summary = await this.getSummary(tenantId, userId, roles);
    return summary.pipeline;
  }

  /**
   * 見積状態別集計単体取得
   */
  async getQuotationSummary(
    tenantId: string,
    userId: string,
    roles: string[],
  ): Promise<QuotationSummaryDto> {
    const summary = await this.getSummary(tenantId, userId, roles);
    return summary.quotations;
  }

  /**
   * 契約更新連携進捗集計単体取得
   */
  async getRenewalSummary(
    tenantId: string,
    userId: string,
    roles: string[],
  ): Promise<RenewalLinkSummaryDto> {
    const summary = await this.getSummary(tenantId, userId, roles);
    return summary.renewals;
  }

  /**
   * 経営者ダッシュボード向け営業KPIサマリーを取得する (P5-T1)
   * 既存の getSummary (P4-T4) 集計ロジックを再利用し、重複実装を排除
   */
  async getExecutiveSalesKpi(
    tenantId: string,
    userId: string,
    roles: string[],
  ): Promise<SalesKpiDto> {
    const summary = await this.getSummary(tenantId, userId, roles);
    return {
      open_deals_count: summary.pipeline.open_deals.count,
      open_deals_amount: summary.pipeline.open_deals.total_amount,
      win_rate: summary.pipeline.win_rate,
      quotation_conversion_rate: summary.quotations.conversion_rate,
      renewal_proposal_rate: summary.renewals.renewal_proposal_rate,
    };
  }
}
