import { z } from 'zod';

/**
 * 購買ダッシュボードサマリーのクエリパラメータスキーマ
 */
export const purchaseDashboardQuerySchema = z.object({
  supplier_limit: z.coerce.number().int().min(1).max(50).default(5),
});

export type PurchaseDashboardQuery = z.infer<typeof purchaseDashboardQuerySchema>;

/**
 * ステータス別集計アイテム
 */
export interface StatusCountItem {
  count: number;
  total_amount: number;
}

/**
 * ステータス別集計DTO
 */
export interface StatusCountsDto {
  draft: StatusCountItem;
  pending_approval: StatusCountItem;
  active: StatusCountItem;
  rejected: StatusCountItem;
  terminated: StatusCountItem;
  total: StatusCountItem;
}

/**
 * サプライヤー別発注金額ランキングアイテム
 */
export interface SupplierRankingItem {
  supplier_id: string | null;
  supplier_name: string;
  request_count: number;
  total_amount: number;
}

/**
 * 今月 / 今期の発注金額集計DTO
 */
export interface AmountSummaryDto {
  /** 今月の確定発注金額 (status = 'active') */
  current_month_active_amount: number;
  /** 今月の全発注金額 (全status合計) */
  current_month_total_amount: number;
  /** 今期の確定発注金額 (status = 'active') */
  current_period_active_amount: number;
  /** 今期の全発注金額 (全status合計) */
  current_period_total_amount: number;
  /** 今月の年月ラベル (例: '2026-09') */
  current_month_label: string;
  /** 今期の表示ラベル (例: '第1期 (2026-01-01〜2026-12-31)' または '2026年度') */
  current_period_label: string;
}

/**
 * 検収待ち発注件数DTO
 */
export interface PendingReceiptsDto {
  /** 検収待ち合計件数 (未検収 + 一部検収中) */
  total_pending_receipt_count: number;
  /** 完全未検収 (検収レコードが0件) の発注件数 */
  unreceived_count: number;
  /** 一部検収中 (受領累計 < 発注数量) の発注件数 */
  partially_received_count: number;
}

/**
 * 月次推移データアイテム (直近6〜12ヶ月)
 */
export interface MonthlyTrendItem {
  month: string;
  active_amount: number;
  total_amount: number;
  request_count: number;
}

/**
 * 購買ダッシュボードサマリー全体の返却DTO
 */
export interface PurchaseDashboardSummaryDto {
  status_counts: StatusCountsDto;
  supplier_ranking: SupplierRankingItem[];
  amount_summary: AmountSummaryDto;
  pending_receipts: PendingReceiptsDto;
  monthly_trends: MonthlyTrendItem[];
}
