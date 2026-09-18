export interface StageCountItem {
  count: number;
  total_amount: number;
}

export interface DealPipelineSummaryDto {
  lead: StageCountItem;
  qualified: StageCountItem;
  proposal: StageCountItem;
  negotiation: StageCountItem;
  won: StageCountItem;
  lost: StageCountItem;
  open_deals: StageCountItem;
  won_deals: StageCountItem;
  lost_deals: StageCountItem;
  total_deals: StageCountItem;
  win_rate: number;
}

export interface QuotationStatusCountItem {
  count: number;
  total_amount: number;
}

export interface QuotationSummaryDto {
  draft: QuotationStatusCountItem;
  sent: QuotationStatusCountItem;
  accepted: QuotationStatusCountItem;
  rejected: QuotationStatusCountItem;
  expired: QuotationStatusCountItem;
  total_quotations: QuotationStatusCountItem;
  actionable_count: number;
  conversion_rate: number;
}

export interface RenewalLinkSummaryDto {
  expiring_contracts_count: number;
  linked_contracts_count: number;
  renewal_proposal_rate: number;
  total_renewal_links_count: number;
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

export interface SalesDashboardSummaryDto {
  pipeline: DealPipelineSummaryDto;
  quotations: QuotationSummaryDto;
  renewals: RenewalLinkSummaryDto;
}

export type DealStage = 'lead' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';

export const DEAL_STAGE_CONFIG: Record<
  DealStage,
  { label: string; color: string; bg: string; text: string; border: string }
> = {
  lead: {
    label: 'リード',
    color: '#38bdf8', // sky-400
    bg: 'bg-sky-950/40',
    text: 'text-sky-300',
    border: 'border-sky-800/60',
  },
  qualified: {
    label: 'ヒアリング',
    color: '#818cf8', // indigo-400
    bg: 'bg-indigo-950/40',
    text: 'text-indigo-300',
    border: 'border-indigo-800/60',
  },
  proposal: {
    label: '提案中',
    color: '#a855f7', // purple-500
    bg: 'bg-purple-950/40',
    text: 'text-purple-300',
    border: 'border-purple-800/60',
  },
  negotiation: {
    label: '条件交渉',
    color: '#f59e0b', // amber-500
    bg: 'bg-amber-950/40',
    text: 'text-amber-300',
    border: 'border-amber-800/60',
  },
  won: {
    label: '受注 (Won)',
    color: '#10b981', // emerald-500
    bg: 'bg-emerald-950/40',
    text: 'text-emerald-300',
    border: 'border-emerald-800/60',
  },
  lost: {
    label: '失注 (Lost)',
    color: '#ef4444', // red-500
    bg: 'bg-red-950/40',
    text: 'text-red-300',
    border: 'border-red-800/60',
  },
};

export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';

export const QUOTATION_STATUS_CONFIG: Record<
  QuotationStatus,
  { label: string; color: string; bg: string; text: string; border: string }
> = {
  draft: {
    label: '下書き',
    color: '#94a3b8',
    bg: 'bg-slate-950/40',
    text: 'text-slate-400',
    border: 'border-slate-800/60',
  },
  sent: {
    label: '送付済',
    color: '#38bdf8',
    bg: 'bg-sky-950/40',
    text: 'text-sky-300',
    border: 'border-sky-800/60',
  },
  accepted: {
    label: '成約 (受注)',
    color: '#10b981',
    bg: 'bg-emerald-950/40',
    text: 'text-emerald-300',
    border: 'border-emerald-800/60',
  },
  rejected: {
    label: '失注 (却下)',
    color: '#ef4444',
    bg: 'bg-red-950/40',
    text: 'text-red-300',
    border: 'border-red-800/60',
  },
  expired: {
    label: '期限切れ',
    color: '#f59e0b',
    bg: 'bg-amber-950/40',
    text: 'text-amber-300',
    border: 'border-amber-800/60',
  },
};
