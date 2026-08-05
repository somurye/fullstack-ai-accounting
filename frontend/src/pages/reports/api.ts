import { apiClient } from '../../lib/apiClient';
import type { CashFlowStatement, FinancialStatement, TrialBalanceLine } from './types';

export async function fetchTrialBalance(params: {
  fiscal_period_id?: string;
  date_from?: string;
  date_to?: string;
}): Promise<TrialBalanceLine[]> {
  const { data } = await apiClient.get<{ success: true; data: TrialBalanceLine[] }>(
    '/reports/trial-balance',
    { params },
  );
  return data.data ?? [];
}

export async function fetchPl(params: {
  fiscal_year_id?: string;
  date_from?: string;
  date_to?: string;
}): Promise<FinancialStatement> {
  const { data } = await apiClient.get<{ success: true; data: FinancialStatement }>('/reports/pl', {
    params,
  });
  return data.data ?? { period_label: '', lines: [] };
}

export async function fetchBs(params: { as_of_date: string }): Promise<FinancialStatement> {
  const { data } = await apiClient.get<{ success: true; data: FinancialStatement }>('/reports/bs', {
    params,
  });
  return data.data ?? { period_label: '', lines: [] };
}

export async function fetchCashFlow(params: {
  fiscal_year_id?: string;
  date_from?: string;
  date_to?: string;
}): Promise<CashFlowStatement | undefined> {
  const { data } = await apiClient.get<{ success: true; data: CashFlowStatement }>(
    '/reports/cash-flow',
    { params },
  );
  return data.data;
}
