import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AppException } from '../../common/exceptions/app.exception';
import { DatabaseService } from '../../database/database.service';
import type {
  AmountSummaryDto,
  MonthlyTrendItem,
  PendingReceiptsDto,
  PurchaseDashboardQuery,
  PurchaseDashboardSummaryDto,
  StatusCountsDto,
  SupplierRankingItem,
} from './purchase-dashboard.dto';
import type { PurchaseKpiDto } from '../executive-dashboard/executive-dashboard.dto';

const TREND_MONTHS = 6;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** `YYYY-MM-01` 形式の月初日文字列を返す */
function monthStartIso(year: number, monthIndex0: number): string {
  const mm = String(monthIndex0 + 1).padStart(2, '0');
  return `${year}-${mm}-01`;
}

function addMonths(year: number, monthIndex0: number, delta: number): { year: number; monthIndex0: number } {
  const total = year * 12 + monthIndex0 + delta;
  return { year: Math.floor(total / 12), monthIndex0: ((total % 12) + 12) % 12 };
}

@Injectable()
export class PurchaseDashboardService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * 購買ダッシュボードサマリー集計API
   *
   * RLS・RBAC二重防御原則:
   * - Controller層だけでなくService層でも `assertUserPermission` による `purchase_request.view` 権限チェックを強制
   * - 全クエリのJOINおよびWHERE条件に `tenant_id` を明示的に含め、RLSバイパスを行わない二重防御を徹底
   */
  async getSummary(
    tenantId: string,
    userId: string | null,
    query: PurchaseDashboardQuery,
  ): Promise<PurchaseDashboardSummaryDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      // 1. Service層RBAC二重認可チェック (DEBT-005パターン)
      await this.assertUserPermission(client, tenantId, userId, 'purchase_request.view');

      // 2. ステータス別件数・金額集計
      const statusCounts = await this.aggregateStatusCounts(client, tenantId);

      // 3. サプライヤー別発注金額ランキング (上位N件)
      const supplierRanking = await this.aggregateSupplierRanking(
        client,
        tenantId,
        query.supplier_limit,
      );

      // 4. 今月 / 今期の発注金額集計
      const amountSummary = await this.aggregateAmountSummary(client, tenantId);

      // 5. 検収待ち発注件数集計 (active状態の未検収・部分検収)
      const pendingReceipts = await this.aggregatePendingReceipts(client, tenantId);

      // 6. 直近月次推移
      const monthlyTrends = await this.aggregateMonthlyTrends(client, tenantId);

      return {
        status_counts: statusCounts,
        supplier_ranking: supplierRanking,
        amount_summary: amountSummary,
        pending_receipts: pendingReceipts,
        monthly_trends: monthlyTrends,
      };
    });
  }

  /**
   * 経営者ダッシュボード向け購買KPIサマリーを取得する (P5-T1)
   * 既存の getSummary (P2-T4) 集計ロジックを再利用し、重複実装を排除
   */
  async getExecutivePurchaseKpi(
    tenantId: string,
    userId: string | null,
  ): Promise<PurchaseKpiDto> {
    const summary = await this.getSummary(tenantId, userId, { supplier_limit: 1 });
    return {
      pending_approval_count: summary.status_counts.pending_approval.count,
      pending_approval_amount: summary.status_counts.pending_approval.total_amount,
      current_month_order_amount: summary.amount_summary.current_month_active_amount,
      pending_receipts_count: summary.pending_receipts.total_pending_receipt_count,
    };
  }

  /**
   * DB層/Service層での二重RBAC認可チェックヘルパー (DEBT-005パターン)
   */
  private async assertUserPermission(
    client: PoolClient,
    tenantId: string,
    userId: string | null,
    permissionCode: string,
  ): Promise<void> {
    if (!userId) {
      throw AppException.unauthorized('ユーザー認証が必要です');
    }
    const permCheck = await client.query(
      `SELECT 1
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.tenant_id = $1 AND ur.user_id = $2
         AND p.code = $3
       LIMIT 1`,
      [tenantId, userId, permissionCode],
    );
    if (permCheck.rowCount === 0) {
      throw AppException.forbidden(`この操作を行う権限(${permissionCode})がありません`);
    }
  }

  /**
   * ステータス別件数・合計金額を集計する
   */
  private async aggregateStatusCounts(
    client: PoolClient,
    tenantId: string,
  ): Promise<StatusCountsDto> {
    const res = await client.query<{
      status: string;
      count: string;
      total_amount: string;
    }>(
      `SELECT
         status,
         COUNT(*)::text AS count,
         COALESCE(SUM(total_amount), 0)::text AS total_amount
       FROM purchase_requests
       WHERE tenant_id = $1
       GROUP BY status`,
      [tenantId],
    );

    const initial: StatusCountsDto = {
      draft: { count: 0, total_amount: 0 },
      pending_approval: { count: 0, total_amount: 0 },
      active: { count: 0, total_amount: 0 },
      rejected: { count: 0, total_amount: 0 },
      terminated: { count: 0, total_amount: 0 },
      total: { count: 0, total_amount: 0 },
    };

    for (const row of res.rows) {
      const count = Number(row.count);
      const totalAmount = round2(Number(row.total_amount));
      if (row.status in initial && row.status !== 'total') {
        const key = row.status as keyof Omit<StatusCountsDto, 'total'>;
        initial[key] = { count, total_amount: totalAmount };
      }
      initial.total.count += count;
      initial.total.total_amount = round2(initial.total.total_amount + totalAmount);
    }

    return initial;
  }

  /**
   * サプライヤー別発注金額合計を集計する (上位N件)
   * ※ JOIN条件およびWHERE条件すべてにtenant_idを含める二重防御
   */
  private async aggregateSupplierRanking(
    client: PoolClient,
    tenantId: string,
    limit: number,
  ): Promise<SupplierRankingItem[]> {
    const res = await client.query<{
      supplier_id: string | null;
      supplier_name: string;
      request_count: string;
      total_amount: string;
    }>(
      `SELECT
         s.id AS supplier_id,
         COALESCE(s.name, pr.supplier_name) AS supplier_name,
         COUNT(pr.id)::text AS request_count,
         COALESCE(SUM(pr.total_amount), 0)::text AS total_amount
       FROM purchase_requests pr
       LEFT JOIN suppliers s
         ON s.id = pr.supplier_id AND s.tenant_id = pr.tenant_id
       WHERE pr.tenant_id = $1
         AND pr.status = 'active'
       GROUP BY s.id, COALESCE(s.name, pr.supplier_name)
       ORDER BY SUM(pr.total_amount) DESC
       LIMIT $2`,
      [tenantId, limit],
    );

    return res.rows.map((row) => ({
      supplier_id: row.supplier_id,
      supplier_name: row.supplier_name,
      request_count: Number(row.request_count),
      total_amount: round2(Number(row.total_amount)),
    }));
  }

  /**
   * 今月 / 今期の発注金額を集計する
   */
  private async aggregateAmountSummary(
    client: PoolClient,
    tenantId: string,
  ): Promise<AmountSummaryDto> {
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonthIndex0 = now.getUTCMonth();

    // 当月の範囲: YYYY-MM-01 〜 翌月01日
    const currentMonthStart = monthStartIso(currentYear, currentMonthIndex0);
    const nextMonthObj = addMonths(currentYear, currentMonthIndex0, 1);
    const nextMonthStart = monthStartIso(nextMonthObj.year, nextMonthObj.monthIndex0);
    const currentMonthLabel = `${currentYear}-${String(currentMonthIndex0 + 1).padStart(2, '0')}`;

    // 当期の範囲: fiscal_years に合致するものがあれば使用、なければ当年1月1日〜翌年1月1日
    let periodStart = `${currentYear}-01-01`;
    let periodEndExclusive = `${currentYear + 1}-01-01`;
    let periodLabel = `${currentYear}年度`;

    const fyRes = await client.query<{
      id: string;
      start_date: string;
      end_date: string;
    }>(
      `SELECT id, TO_CHAR(start_date, 'YYYY-MM-DD') AS start_date, TO_CHAR(end_date, 'YYYY-MM-DD') AS end_date
       FROM fiscal_years
       WHERE tenant_id = $1
         AND start_date <= $2 AND end_date >= $2
       ORDER BY start_date DESC
       LIMIT 1`,
      [tenantId, currentMonthStart],
    );

    if (fyRes.rows.length > 0 && fyRes.rows[0]) {
      const fy = fyRes.rows[0];
      periodStart = fy.start_date;
      // end_date は inclusive なので +1日して exclusive 比較用とする
      const fyEndDate = new Date(`${fy.end_date}T00:00:00Z`);
      fyEndDate.setUTCDate(fyEndDate.getUTCDate() + 1);
      periodEndExclusive = fyEndDate.toISOString().slice(0, 10);
      periodLabel = `当期 (${fy.start_date}〜${fy.end_date})`;
    }

    const res = await client.query<{
      month_active: string;
      month_total: string;
      period_active: string;
      period_total: string;
    }>(
      `SELECT
         COALESCE(SUM(total_amount) FILTER (
           WHERE created_at >= $2::timestamptz AND created_at < $3::timestamptz AND status = 'active'
         ), 0)::text AS month_active,
         COALESCE(SUM(total_amount) FILTER (
           WHERE created_at >= $2::timestamptz AND created_at < $3::timestamptz
         ), 0)::text AS month_total,
         COALESCE(SUM(total_amount) FILTER (
           WHERE created_at >= $4::timestamptz AND created_at < $5::timestamptz AND status = 'active'
         ), 0)::text AS period_active,
         COALESCE(SUM(total_amount) FILTER (
           WHERE created_at >= $4::timestamptz AND created_at < $5::timestamptz
         ), 0)::text AS period_total
       FROM purchase_requests
       WHERE tenant_id = $1`,
      [tenantId, currentMonthStart, nextMonthStart, periodStart, periodEndExclusive],
    );

    const row = res.rows[0];
    return {
      current_month_active_amount: round2(Number(row?.month_active ?? 0)),
      current_month_total_amount: round2(Number(row?.month_total ?? 0)),
      current_period_active_amount: round2(Number(row?.period_active ?? 0)),
      current_period_total_amount: round2(Number(row?.period_total ?? 0)),
      current_month_label: currentMonthLabel,
      current_period_label: periodLabel,
    };
  }

  /**
   * 検収待ち発注件数を集計する (active状態の未検収および一部検収)
   * ※ サブクエリおよびJOIN条件のすべてにtenant_idを含める二重防御
   */
  private async aggregatePendingReceipts(
    client: PoolClient,
    tenantId: string,
  ): Promise<PendingReceiptsDto> {
    const res = await client.query<{
      total_pending: string;
      unreceived: string;
      partially_received: string;
    }>(
      `SELECT
         COUNT(*)::text AS total_pending,
         COUNT(*) FILTER (WHERE r.received_sum IS NULL OR r.received_sum = 0)::text AS unreceived,
         COUNT(*) FILTER (WHERE r.received_sum > 0 AND r.received_sum < pr.quantity)::text AS partially_received
       FROM purchase_requests pr
       LEFT JOIN (
         SELECT
           purchase_request_id,
           tenant_id,
           SUM(received_quantity) AS received_sum
         FROM purchase_receipts
         WHERE tenant_id = $1
         GROUP BY purchase_request_id, tenant_id
       ) r ON r.purchase_request_id = pr.id AND r.tenant_id = pr.tenant_id
       WHERE pr.tenant_id = $1
         AND pr.status = 'active'
         AND (r.received_sum IS NULL OR r.received_sum < pr.quantity)`,
      [tenantId],
    );

    const row = res.rows[0];
    return {
      total_pending_receipt_count: Number(row?.total_pending ?? 0),
      unreceived_count: Number(row?.unreceived ?? 0),
      partially_received_count: Number(row?.partially_received ?? 0),
    };
  }

  /**
   * 直近の月次推移を集計する (直近 TREND_MONTHS ヶ月)
   */
  private async aggregateMonthlyTrends(
    client: PoolClient,
    tenantId: string,
  ): Promise<MonthlyTrendItem[]> {
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonthIndex0 = now.getUTCMonth();

    const rangeStartObj = addMonths(currentYear, currentMonthIndex0, -(TREND_MONTHS - 1));
    const rangeStart = monthStartIso(rangeStartObj.year, rangeStartObj.monthIndex0);
    const nextMonthObj = addMonths(currentYear, currentMonthIndex0, 1);
    const rangeEndExclusive = monthStartIso(nextMonthObj.year, nextMonthObj.monthIndex0);

    const res = await client.query<{
      month: string;
      request_count: string;
      active_amount: string;
      total_amount: string;
    }>(
      `SELECT
         TO_CHAR(date_trunc('month', created_at), 'YYYY-MM') AS month,
         COUNT(*)::text AS request_count,
         COALESCE(SUM(total_amount) FILTER (WHERE status = 'active'), 0)::text AS active_amount,
         COALESCE(SUM(total_amount), 0)::text AS total_amount
       FROM purchase_requests
       WHERE tenant_id = $1
         AND created_at >= $2::timestamptz AND created_at < $3::timestamptz
       GROUP BY date_trunc('month', created_at)
       ORDER BY month ASC`,
      [tenantId, rangeStart, rangeEndExclusive],
    );

    const byMonth = new Map<string, { active_amount: number; total_amount: number; request_count: number }>();
    for (const row of res.rows) {
      byMonth.set(row.month, {
        active_amount: round2(Number(row.active_amount)),
        total_amount: round2(Number(row.total_amount)),
        request_count: Number(row.request_count),
      });
    }

    const trends: MonthlyTrendItem[] = [];
    for (let i = TREND_MONTHS - 1; i >= 0; i -= 1) {
      const shifted = addMonths(currentYear, currentMonthIndex0, -i);
      const label = `${shifted.year}-${String(shifted.monthIndex0 + 1).padStart(2, '0')}`;
      const bucket = byMonth.get(label) ?? { active_amount: 0, total_amount: 0, request_count: 0 };
      trends.push({
        month: label,
        active_amount: bucket.active_amount,
        total_amount: bucket.total_amount,
        request_count: bucket.request_count,
      });
    }

    return trends;
  }
}
