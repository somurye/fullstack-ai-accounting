import { apiClient } from '../../lib/apiClient';
import type {
  DealPipelineSummaryDto,
  QuotationSummaryDto,
  RenewalLinkSummaryDto,
  SalesDashboardSummaryDto,
} from './types';

export const salesDashboardApi = {
  getSummary: async (): Promise<SalesDashboardSummaryDto> => {
    const res = await apiClient.get<{ data: SalesDashboardSummaryDto }>(
      '/sales-dashboard/summary',
    );
    return res.data.data;
  },

  getPipeline: async (): Promise<DealPipelineSummaryDto> => {
    const res = await apiClient.get<{ data: DealPipelineSummaryDto }>(
      '/sales-dashboard/pipeline',
    );
    return res.data.data;
  },

  getQuotations: async (): Promise<QuotationSummaryDto> => {
    const res = await apiClient.get<{ data: QuotationSummaryDto }>(
      '/sales-dashboard/quotations',
    );
    return res.data.data;
  },

  getRenewals: async (): Promise<RenewalLinkSummaryDto> => {
    const res = await apiClient.get<{ data: RenewalLinkSummaryDto }>(
      '/sales-dashboard/renewals',
    );
    return res.data.data;
  },
};
