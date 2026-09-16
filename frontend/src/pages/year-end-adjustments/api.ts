import { apiClient } from '../../lib/apiClient';
import type {
  PaginationMeta,
  YearEndAdjustment,
  YearEndAdjustmentCalculateInput,
  YearEndAdjustmentListQuery,
} from './types';

interface Envelope<T> {
  success: boolean;
  data: T;
  meta: {
    request_id: string | null;
    pagination?: PaginationMeta;
  };
}

export const yearEndAdjustmentsApi = {
  async list(
    query?: YearEndAdjustmentListQuery,
  ): Promise<{ adjustments: YearEndAdjustment[]; pagination?: PaginationMeta }> {
    const params = new URLSearchParams();
    if (query?.tax_year) params.append('tax_year', String(query.tax_year));
    if (query?.employee_id) params.append('employee_id', query.employee_id);
    if (query?.status) params.append('status', query.status);
    if (query?.page) params.append('page', String(query.page));
    if (query?.page_size) params.append('page_size', String(query.page_size));

    const res = await apiClient.get<Envelope<YearEndAdjustment[]>>(
      `/year-end-adjustments?${params.toString()}`,
    );
    return {
      adjustments: res.data.data,
      pagination: res.data.meta.pagination,
    };
  },

  async get(id: string): Promise<YearEndAdjustment> {
    const res = await apiClient.get<Envelope<YearEndAdjustment>>(`/year-end-adjustments/${id}`);
    return res.data.data;
  },

  async calculate(payload: YearEndAdjustmentCalculateInput): Promise<YearEndAdjustment> {
    const res = await apiClient.post<Envelope<YearEndAdjustment>>(
      '/year-end-adjustments/calculate',
      payload,
    );
    return res.data.data;
  },

  async submitApproval(id: string, payload?: { comment?: string }): Promise<YearEndAdjustment> {
    const res = await apiClient.post<Envelope<YearEndAdjustment>>(
      `/year-end-adjustments/${id}/submit-approval`,
      payload || {},
    );
    return res.data.data;
  },
};
