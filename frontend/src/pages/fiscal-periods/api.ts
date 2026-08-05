import { apiClient } from '../../lib/apiClient';
import type { FiscalPeriod, FiscalYear } from './types';

export async function fetchFiscalYears(): Promise<FiscalYear[]> {
  const { data } = await apiClient.get<{ success: true; data: FiscalYear[] }>('/fiscal-years');
  return data.data ?? [];
}

export async function fetchFiscalPeriods(fiscalYearId?: string): Promise<FiscalPeriod[]> {
  const { data } = await apiClient.get<{ success: true; data: FiscalPeriod[] }>('/fiscal-periods', {
    params: fiscalYearId ? { fiscal_year_id: fiscalYearId } : undefined,
  });
  return data.data ?? [];
}
