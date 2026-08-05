import { apiClient } from '../../lib/apiClient';
import type { DashboardSummary } from './types';

export async function fetchDashboardSummary(): Promise<DashboardSummary | undefined> {
  const { data } = await apiClient.get<{ success: true; data: DashboardSummary }>('/dashboard/summary');
  return data.data;
}
