import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ROLE_PERMISSIONS } from '../../common/guards/permissions.guard';
import {
  ExecutiveDashboardSummaryDto,
  ApprovalKpiDto,
  ContractKpiDto,
  PurchaseKpiDto,
  HrKpiDto,
  SalesKpiDto,
} from './executive-dashboard.dto';

@Injectable()
export class ExecutiveDashboardService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * ユーザーのロール一覧からパーミッション集合を算出する (fail-closed)
   */
  private getEffectivePermissions(roles: string[]): Set<string> {
    const permissions = new Set<string>();
    for (const role of roles) {
      const perms = ROLE_PERMISSIONS[role] ?? [];
      for (const p of perms) {
        permissions.add(p);
      }
    }
    return permissions;
  }

  /**
   * 基本アクセス権限チェック (dashboard.executive_view)
   */
  private assertExecutiveAccess(roles: string[]): void {
    const permissions = this.getEffectivePermissions(roles);
    if (!permissions.has('dashboard.executive_view')) {
      throw AppException.forbidden(
        '横断エグゼクティブダッシュボードを閲覧する権限がありません (要求権限: dashboard.executive_view)',
      );
    }
  }

  /**
   * 横断KPIサマリー取得
   * - 全体認可: dashboard.executive_view
   * - ドメイン別二重認可: 当該ドメインの閲覧権限がない場合は集計を実行せず null を返却
   */
  async getSummary(
    tenantId: string,
    userId: string,
    roles: string[],
  ): Promise<ExecutiveDashboardSummaryDto> {
    this.assertExecutiveAccess(roles);

    const permissions = this.getEffectivePermissions(roles);
    const availableDomains: string[] = [];

    // ドメイン別権限判定
    const canViewApprovals =
      permissions.has('contract.view') ||
      permissions.has('purchase_request.view') ||
      permissions.has('general_request.view') ||
      roles.includes('owner') ||
      roles.includes('approver') ||
      roles.includes('accounting_manager') ||
      roles.includes('accountant');

    const canViewContracts = permissions.has('contract.view');
    const canViewPurchase = permissions.has('purchase_request.view');
    const canViewHr =
      roles.includes('owner') ||
      roles.includes('payroll_admin');
    const canViewSales =
      permissions.has('deal.view') || permissions.has('quotation.view');

    if (canViewApprovals) availableDomains.push('approvals');
    if (canViewContracts) availableDomains.push('contracts');
    if (canViewPurchase) availableDomains.push('purchase');
    if (canViewHr) availableDomains.push('hr');
    if (canViewSales) availableDomains.push('sales');

    return this.db.transaction(tenantId, userId, async (client) => {
      // 1. 承認ワークフローKPI (Phase 0)
      let approvals: ApprovalKpiDto | null = null;
      if (canViewApprovals) {
        const approvalRes = await client.query<{
          target_type: string;
          count: number;
        }>(
          `SELECT target_type, COUNT(*)::int AS count
           FROM approval_requests
           WHERE tenant_id = $1 AND status = 'pending'
           GROUP BY target_type`,
          [tenantId],
        );

        const pendingByTarget: ApprovalKpiDto['pending_by_target'] = {
          contract: 0,
          purchase_request: 0,
          general_request: 0,
          expense_report: 0,
          journal_entry: 0,
          payroll: 0,
        };

        let pendingTotal = 0;
        for (const row of approvalRes.rows) {
          const c = Number(row.count);
          pendingByTarget[row.target_type] = c;
          pendingTotal += c;
        }

        approvals = {
          pending_total_count: pendingTotal,
          pending_by_target: pendingByTarget,
        };
      }

      // 2. 契約・更新期限KPI (P1-T4)
      let contracts: ContractKpiDto | null = null;
      if (canViewContracts) {
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
        contracts = {
          active_contracts_count: Number(row?.active_count || 0),
          expiring_soon_count: Number(row?.expiring_soon || 0),
          expiring_within_30_days: Number(row?.within_30 || 0),
          expiring_within_60_days: Number(row?.within_60 || 0),
        };
      }

      // 3. 購買・稟議KPI (P2-T4)
      let purchase: PurchaseKpiDto | null = null;
      if (canViewPurchase) {
        const purchaseRes = await client.query<{
          pending_count: number;
          pending_amount: string;
          current_month_order_amount: string;
          pending_receipts_count: number;
        }>(
          `SELECT
             COUNT(CASE WHEN status = 'pending_approval' THEN 1 END)::int AS pending_count,
             COALESCE(SUM(CASE WHEN status = 'pending_approval' THEN total_amount END), 0)::text AS pending_amount,
             COALESCE(SUM(CASE
               WHEN status = 'active'
                AND date_trunc('month', created_at) = date_trunc('month', CURRENT_DATE) THEN total_amount
             END), 0)::text AS current_month_order_amount,
             COUNT(CASE WHEN status = 'active' THEN 1 END)::int AS pending_receipts_count
           FROM purchase_requests
           WHERE tenant_id = $1`,
          [tenantId],
        );

        const row = purchaseRes.rows[0];
        purchase = {
          pending_approval_count: Number(row?.pending_count || 0),
          pending_approval_amount: Number(row?.pending_amount || 0),
          current_month_order_amount: Number(row?.current_month_order_amount || 0),
          pending_receipts_count: Number(row?.pending_receipts_count || 0),
        };
      }

      // 4. 人事労務KPI (Phase 3)
      let hr: HrKpiDto | null = null;
      if (canViewHr) {
        const hrRes = await client.query<{
          active_employees: number;
          unresolved_attendance: number;
          pending_attendance: number;
          overtime_alerts: number;
        }>(
          `SELECT
             (SELECT COUNT(*)::int FROM employees WHERE tenant_id = $1 AND status = 'active') AS active_employees,
             (SELECT COUNT(*)::int FROM attendance_records WHERE tenant_id = $1 AND clock_in IS NOT NULL AND clock_out IS NULL) AS unresolved_attendance,
             (SELECT COUNT(*)::int FROM attendance_records WHERE tenant_id = $1 AND status = 'submitted') AS pending_attendance,
             (SELECT COUNT(*)::int FROM (
                SELECT employee_id
                FROM attendance_records
                WHERE tenant_id = $1 AND date_trunc('month', work_date) = date_trunc('month', CURRENT_DATE)
                GROUP BY employee_id
                HAVING SUM(overtime_hours) > 45
             ) ot) AS overtime_alerts`,
          [tenantId],
        );

        const row = hrRes.rows[0];
        hr = {
          active_employees_count: Number(row?.active_employees || 0),
          unresolved_attendance_count: Number(row?.unresolved_attendance || 0),
          pending_attendance_approvals: Number(row?.pending_attendance || 0),
          overtime_alert_count: Number(row?.overtime_alerts || 0),
        };
      }

      // 5. 営業パイプラインKPI (P4-T4)
      let sales: SalesKpiDto | null = null;
      if (canViewSales) {
        // (1) 案件パイプライン
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

        let openCount = 0;
        let openAmount = 0;
        let wonCount = 0;
        let lostCount = 0;

        for (const row of dealsRes.rows) {
          const c = Number(row.count);
          const amt = Number(row.total_amount);
          if (['lead', 'qualified', 'proposal', 'negotiation'].includes(row.stage)) {
            openCount += c;
            openAmount += amt;
          } else if (row.stage === 'won') {
            wonCount += c;
          } else if (row.stage === 'lost') {
            lostCount += c;
          }
        }

        const closedTotal = wonCount + lostCount;
        const winRate =
          closedTotal > 0 ? Math.round((wonCount / closedTotal) * 10000) / 10000 : 0;

        // (2) 見積成約率
        const quotesRes = await client.query<{
          status: string;
          count: number;
        }>(
          `SELECT status, COUNT(*)::int AS count
           FROM quotations
           WHERE tenant_id = $1
           GROUP BY status`,
          [tenantId],
        );

        let sentCount = 0;
        let acceptedCount = 0;
        let rejectedCount = 0;
        let expiredCount = 0;

        for (const row of quotesRes.rows) {
          const c = Number(row.count);
          if (row.status === 'sent') sentCount += c;
          else if (row.status === 'accepted') acceptedCount += c;
          else if (row.status === 'rejected') rejectedCount += c;
          else if (row.status === 'expired') expiredCount += c;
        }

        const actionableQuotes = sentCount + acceptedCount + rejectedCount + expiredCount;
        const quotationConversionRate =
          actionableQuotes > 0
            ? Math.round((acceptedCount / actionableQuotes) * 10000) / 10000
            : 0;

        // (3) 契約更新起票率
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

        sales = {
          open_deals_count: openCount,
          open_deals_amount: openAmount,
          win_rate: winRate,
          quotation_conversion_rate: quotationConversionRate,
          renewal_proposal_rate: renewalProposalRate,
        };
      }

      return {
        approvals,
        contracts,
        purchase,
        hr,
        sales,
        available_domains: availableDomains,
      };
    });
  }
}
