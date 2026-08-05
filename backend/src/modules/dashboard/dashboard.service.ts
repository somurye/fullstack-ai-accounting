import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import type { components } from '../../types/api.generated';

export type DashboardMonthlyTrendDto = components['schemas']['DashboardMonthlyTrend'];
export type DashboardRecentActivityDto = components['schemas']['DashboardRecentActivity'];
export type DashboardSummaryDto = components['schemas']['DashboardSummary'];

const TREND_MONTHS = 12;
const RECENT_ACTIVITIES_LIMIT = 5;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** `YYYY-MM-01` 形式の月初日文字列を返す(date_truncの代わりにJS側で計算し、タイムゾーン依存を避ける)。 */
function monthStartIso(year: number, monthIndex0: number): string {
  const mm = String(monthIndex0 + 1).padStart(2, '0');
  return `${year}-${mm}-01`;
}

function addMonths(year: number, monthIndex0: number, delta: number): { year: number; monthIndex0: number } {
  const total = year * 12 + monthIndex0 + delta;
  return { year: Math.floor(total / 12), monthIndex0: ((total % 12) + 12) % 12 };
}

@Injectable()
export class DashboardService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * ダッシュボードサマリー。
   *
   * 「当月」はサーバーの実時計ではなく、確定済み仕訳(status='posted')が実在する
   * 直近の月を基準とする。100人シミュレーション等で過去の会計期間のデータのみが
   * 投入されているテナントでも、KPIカード・月次推移グラフが実データで描画されるようにする
   * (実時計基準にすると、シミュレーション期間より後の月は常に空値になってしまうため)。
   * 確定済み仕訳が1件も無いテナントでは、実時計の当月にフォールバックする。
   */
  async summary(tenantId: string, userId: string | null, currentUserId: string): Promise<DashboardSummaryDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const anchor = await this.resolveAnchorMonth(client, tenantId);

      const rangeStart = monthStartIso(...this.shiftAnchor(anchor, -(TREND_MONTHS - 1)));
      const rangeEndExclusive = monthStartIso(...this.shiftAnchor(anchor, 1));

      const monthlyRows = await client.query<{
        month: string;
        account_type: 'revenue' | 'expense';
        debit_total: string;
        credit_total: string;
      }>(
        `SELECT
           TO_CHAR(date_trunc('month', je.entry_date), 'YYYY-MM') AS month,
           a.account_type,
           COALESCE(SUM(jel.amount) FILTER (WHERE jel.debit_credit = 'debit'), 0) AS debit_total,
           COALESCE(SUM(jel.amount) FILTER (WHERE jel.debit_credit = 'credit'), 0) AS credit_total
         FROM accounts a
         JOIN journal_entry_lines jel ON jel.account_id = a.id AND jel.tenant_id = a.tenant_id
         JOIN journal_entries je
           ON je.id = jel.journal_entry_id AND je.tenant_id = jel.tenant_id AND je.status = 'posted'
              AND je.entry_date >= $2 AND je.entry_date < $3
         WHERE a.tenant_id = $1 AND a.account_type IN ('revenue', 'expense')
         GROUP BY month, a.account_type`,
        [tenantId, rangeStart, rangeEndExclusive],
      );

      const byMonth = new Map<string, { revenue: number; expense: number }>();
      for (const row of monthlyRows.rows) {
        const bucket = byMonth.get(row.month) ?? { revenue: 0, expense: 0 };
        const debitTotal = Number(row.debit_total);
        const creditTotal = Number(row.credit_total);
        if (row.account_type === 'revenue') {
          bucket.revenue += creditTotal - debitTotal;
        } else {
          bucket.expense += debitTotal - creditTotal;
        }
        byMonth.set(row.month, bucket);
      }

      const monthlyTrends: DashboardMonthlyTrendDto[] = [];
      for (let i = TREND_MONTHS - 1; i >= 0; i -= 1) {
        const [y, m0] = this.shiftAnchor(anchor, -i);
        const label = `${y}-${String(m0 + 1).padStart(2, '0')}`;
        const bucket = byMonth.get(label) ?? { revenue: 0, expense: 0 };
        const revenue = round2(bucket.revenue);
        const expense = round2(bucket.expense);
        monthlyTrends.push({ month: label, revenue, expense, net_income: round2(revenue - expense) });
      }

      const current = monthlyTrends[monthlyTrends.length - 1];
      const previous = monthlyTrends[monthlyTrends.length - 2];

      const pendingApprovalsCount = await this.countPendingApprovals(client, tenantId, currentUserId);
      const recentActivities = await this.fetchRecentActivities(client, tenantId);

      return {
        current_month_revenue: current.revenue,
        current_month_expense: current.expense,
        current_month_net_income: current.net_income,
        previous_month_revenue: previous?.revenue ?? 0,
        previous_month_expense: previous?.expense ?? 0,
        previous_month_net_income: previous?.net_income ?? 0,
        pending_approvals_count: pendingApprovalsCount,
        monthly_trends: monthlyTrends,
        recent_activities: recentActivities,
      };
    });
  }

  private shiftAnchor(anchor: { year: number; monthIndex0: number }, delta: number): [number, number] {
    const shifted = addMonths(anchor.year, anchor.monthIndex0, delta);
    return [shifted.year, shifted.monthIndex0];
  }

  /** 確定済み仕訳が存在する直近の月を基準月とする。存在しなければ実時計の当月にフォールバックする。 */
  private async resolveAnchorMonth(
    client: PoolClient,
    tenantId: string,
  ): Promise<{ year: number; monthIndex0: number }> {
    const result = await client.query<{ latest_date: string | null }>(
      `SELECT TO_CHAR(MAX(entry_date), 'YYYY-MM-DD') AS latest_date
       FROM journal_entries WHERE tenant_id = $1 AND status = 'posted'`,
      [tenantId],
    );
    const latestDate = result.rows[0]?.latest_date;
    const reference = latestDate ? new Date(`${latestDate}T00:00:00Z`) : new Date();
    return { year: reference.getUTCFullYear(), monthIndex0: reference.getUTCMonth() };
  }

  /** `approval-requests.service.ts` の `pending_for_me` フィルタと同一のルールで、自分に割り当てられた未処理の承認依頼数を数える。 */
  private async countPendingApprovals(client: PoolClient, tenantId: string, currentUserId: string): Promise<number> {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM approval_requests ar
       WHERE ar.tenant_id = $1 AND ar.status = 'pending' AND ar.submitted_by <> $2 AND EXISTS (
         SELECT 1 FROM approval_rules rule
         WHERE rule.tenant_id = ar.tenant_id AND rule.target_type = ar.target_type
           AND rule.step_number = ar.current_step AND rule.is_active = TRUE
           AND (
             rule.approver_user_id = $2
             OR rule.approver_role_id IN (
               SELECT role_id FROM user_roles WHERE tenant_id = ar.tenant_id AND user_id = $2
             )
           )
       )`,
      [tenantId, currentUserId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  /** 直近の経費精算・仕訳をあわせて最大5件、作成日時降順で返す。 */
  private async fetchRecentActivities(client: PoolClient, tenantId: string): Promise<DashboardRecentActivityDto[]> {
    const [expenseReports, journalEntries] = await Promise.all([
      client.query<{
        id: string;
        report_no: string;
        purpose: string | null;
        total_amount: string;
        status: string;
        created_at: Date;
      }>(
        `SELECT id, report_no, purpose, total_amount, status, created_at
         FROM expense_reports WHERE tenant_id = $1
         ORDER BY created_at DESC LIMIT $2`,
        [tenantId, RECENT_ACTIVITIES_LIMIT],
      ),
      client.query<{
        id: string;
        entry_no: string;
        description: string | null;
        status: string;
        created_at: Date;
        amount: string;
      }>(
        `SELECT je.id, je.entry_no, je.description, je.status, je.created_at,
                COALESCE((
                  SELECT SUM(jel.amount) FROM journal_entry_lines jel
                  WHERE jel.journal_entry_id = je.id AND jel.tenant_id = je.tenant_id AND jel.debit_credit = 'debit'
                ), 0) AS amount
         FROM journal_entries je WHERE je.tenant_id = $1
         ORDER BY je.created_at DESC LIMIT $2`,
        [tenantId, RECENT_ACTIVITIES_LIMIT],
      ),
    ]);

    const combined: Array<DashboardRecentActivityDto & { created_at: string }> = [
      ...expenseReports.rows.map((row) => ({
        id: row.id,
        type: 'expense_report' as const,
        title: row.purpose ?? row.report_no,
        amount: Number(row.total_amount),
        status: row.status,
        created_at: row.created_at.toISOString(),
      })),
      ...journalEntries.rows.map((row) => ({
        id: row.id,
        type: 'journal_entry' as const,
        title: row.description ?? row.entry_no,
        amount: Number(row.amount),
        status: row.status,
        created_at: row.created_at.toISOString(),
      })),
    ];

    return combined
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, RECENT_ACTIVITIES_LIMIT);
  }
}
