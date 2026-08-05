import { useQuery } from '@tanstack/react-query';
import { fetchFiscalPeriods, fetchFiscalYears } from './api';

export function useFiscalYears() {
  return useQuery({ queryKey: ['fiscal-years'], queryFn: fetchFiscalYears, staleTime: 5 * 60_000 });
}

export function useFiscalPeriods(fiscalYearId?: string) {
  return useQuery({
    queryKey: ['fiscal-periods', fiscalYearId ?? 'all'],
    queryFn: () => fetchFiscalPeriods(fiscalYearId),
    staleTime: 5 * 60_000,
  });
}
