import { apiClient } from '../../lib/apiClient';
import type { ExecutiveDashboardSummary } from './types';

export const executiveDashboardApi = {
  getSummary: async (): Promise<ExecutiveDashboardSummary> => {
    const res = await apiClient.get<{ data: ExecutiveDashboardSummary }>(
      '/executive-dashboard/summary',
    );
    return res.data.data;
  },
};
