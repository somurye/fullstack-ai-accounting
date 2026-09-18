import { z } from 'zod';

export const salesDashboardQuerySchema = z.object({
  // 将来的な日付フィルタ用（オプション）
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '開始日はYYYY-MM-DD形式で指定してください').optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '終了日はYYYY-MM-DD形式で指定してください').optional(),
});

export type SalesDashboardQuery = z.infer<typeof salesDashboardQuerySchema>;

/**
 * 案件ステージ別集計アイテム
 */
export interface StageCountItem {
  count: number;
  total_amount: number;
}

/**
 * 案件パイプライン集計DTO
 */
export interface DealPipelineSummaryDto {
  lead: StageCountItem;
  qualified: StageCountItem;
  proposal: StageCountItem;
  negotiation: StageCountItem;
  won: StageCountItem;
  lost: StageCountItem;
  /** 進行中商談 (lead, qualified, proposal, negotiation) の合計 */
  open_deals: StageCountItem;
  /** 受注商談 (won) の合計 */
  won_deals: StageCountItem;
  /** 失注商談 (lost) の合計 */
  lost_deals: StageCountItem;
  /** 全商談の合計 */
  total_deals: StageCountItem;
  /** 勝率: won / (won + lost)、分母0の場合は0 */
  win_rate: number;
}

/**
 * 見積状態別集計アイテム
 */
export interface QuotationStatusCountItem {
  count: number;
  total_amount: number;
}

/**
 * 見積状態別集計DTO
 */
export interface QuotationSummaryDto {
  draft: QuotationStatusCountItem;
  sent: QuotationStatusCountItem;
  accepted: QuotationStatusCountItem;
  rejected: QuotationStatusCountItem;
  expired: QuotationStatusCountItem;
  /** 全見積の合計 */
  total_quotations: QuotationStatusCountItem;
  /** 送信済み以上の見積数: sent + accepted + rejected + expired */
  actionable_count: number;
  /** 成約率: accepted / (sent + accepted + rejected + expired)、分母0の場合は0 */
  conversion_rate: number;
}

/**
 * 契約更新連携進捗集計DTO
 */
export interface RenewalLinkSummaryDto {
  /** P1-T4 アラート対象契約数 (active, 期限到来かつ未満了) */
  expiring_contracts_count: number;
  /** アラート対象契約のうち更新リンク起票済みの契約数 */
  linked_contracts_count: number;
  /** 更新提案起票率: linked_contracts_count / expiring_contracts_count、分母0の場合は0 */
  renewal_proposal_rate: number;
  /** 作成された契約更新リンク全件数 */
  total_renewal_links_count: number;
  /** リンクされた商談のステージ分布 */
  linked_deals_stage_distribution: {
    lead: StageCountItem;
    qualified: StageCountItem;
    proposal: StageCountItem;
    negotiation: StageCountItem;
    won: StageCountItem;
    lost: StageCountItem;
    total: StageCountItem;
  };
}

/**
 * 営業ダッシュボード統合DTO
 */
export interface SalesDashboardSummaryDto {
  pipeline: DealPipelineSummaryDto;
  quotations: QuotationSummaryDto;
  renewals: RenewalLinkSummaryDto;
}
