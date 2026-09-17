import type { DealStage } from './dto/deal.schemas';

export interface DealRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  title: string;
  stage: DealStage;
  expected_amount: string | number;
  currency_code: string;
  expected_close_date: string | null;
  owner_user_id: string | null;
  lost_reason: string | null;
  closed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  customer_name?: string | null;
  customer_code?: string | null;
  owner_name?: string | null;
  created_by_name?: string | null;
}

export interface DealDto {
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

export function mapDealRow(row: DealRow): DealDto {
  const stage = row.stage;
  const isTerminal = stage === 'won' || stage === 'lost';

  return {
    id: row.id,
    tenant_id: row.tenant_id,
    customer_id: row.customer_id,
    customer_name: row.customer_name ?? null,
    customer_code: row.customer_code ?? null,
    title: row.title,
    stage,
    expected_amount: Number(row.expected_amount || 0),
    currency_code: row.currency_code,
    expected_close_date: row.expected_close_date ? String(row.expected_close_date).slice(0, 10) : null,
    owner_user_id: row.owner_user_id ?? null,
    owner_name: row.owner_name ?? null,
    lost_reason: row.lost_reason ?? null,
    closed_at: row.closed_at ?? null,
    created_by: row.created_by,
    created_by_name: row.created_by_name ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_terminal: isTerminal,
  };
}

export const SQL_DEAL_COLUMNS = `
  d.id,
  d.tenant_id,
  d.customer_id,
  d.title,
  d.stage,
  d.expected_amount,
  d.currency_code,
  d.expected_close_date,
  d.owner_user_id,
  d.lost_reason,
  d.closed_at,
  d.created_by,
  d.created_at,
  d.updated_at,
  c.name AS customer_name,
  c.code AS customer_code,
  ou.name AS owner_name,
  cu.name AS created_by_name
`;
