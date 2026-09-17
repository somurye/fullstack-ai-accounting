export const DEAL_STAGES = [
  'lead',
  'qualified',
  'proposal',
  'negotiation',
  'won',
  'lost',
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

export interface Deal {
  id: string;
  tenant_id: string;
  customer_id: string;
  customer_name: string | null;
  customer_code: string | null;
  title: string;
  stage: DealStage;
  expected_amount: number;
  currency_code: string;
  expected_close_date: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  lost_reason: string | null;
  closed_at: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  is_terminal: boolean;
}

export interface DealFormInput {
  customer_id: string;
  title: string;
  stage: DealStage;
  expected_amount: number;
  currency_code?: string;
  expected_close_date?: string | null;
  owner_user_id?: string | null;
}

export interface CloseDealInput {
  stage: 'won' | 'lost';
  lost_reason?: string | null;
}

export const DEAL_STAGE_LABELS: Record<DealStage, string> = {
  lead: 'リード(発掘)',
  qualified: '有望(ヒアリング)',
  proposal: '提案(見積提示)',
  negotiation: '条件交渉',
  won: '受注成約(Won)',
  lost: '失注終了(Lost)',
};

export const DEAL_STAGE_COLORS: Record<DealStage, { bg: string; text: string; border: string }> = {
  lead: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' },
  qualified: { bg: 'bg-sky-100', text: 'text-sky-800', border: 'border-sky-200' },
  proposal: { bg: 'bg-indigo-100', text: 'text-indigo-800', border: 'border-indigo-200' },
  negotiation: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-200' },
  won: { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200' },
  lost: { bg: 'bg-rose-100', text: 'text-rose-800', border: 'border-rose-200' },
};
