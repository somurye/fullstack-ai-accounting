import { useQuery } from '@tanstack/react-query';
import { fetchBs, fetchCashFlow, fetchPl, fetchTrialBalance } from './api';

export function useTrialBalance(params: { fiscal_period_id?: string; date_from?: string; date_to?: string }) {
  return useQuery({
    queryKey: ['reports', 'trial-balance', params],
    queryFn: () => fetchTrialBalance(params),
    enabled: Boolean(params.fiscal_period_id || params.date_to),
  });
}

export function usePl(params: { fiscal_year_id?: string; date_from?: string; date_to?: string }) {
  return useQuery({
    queryKey: ['reports', 'pl', params],
    queryFn: () => fetchPl(params),
    enabled: Boolean(params.fiscal_year_id || (params.date_from && params.date_to)),
  });
}

export function useBs(params: { as_of_date: string }) {
  return useQuery({
    queryKey: ['reports', 'bs', params],
    queryFn: () => fetchBs(params),
    enabled: Boolean(params.as_of_date),
  });
}

export function useCashFlow(params: { fiscal_year_id?: string; date_from?: string; date_to?: string }) {
  return useQuery({
    queryKey: ['reports', 'cash-flow', params],
    queryFn: () => fetchCashFlow(params),
    enabled: Boolean(params.fiscal_year_id || (params.date_from && params.date_to)),
  });
}
