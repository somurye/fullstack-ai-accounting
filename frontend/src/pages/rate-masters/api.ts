import { apiClient } from '../../lib/apiClient';
import type {
  InsuranceRate,
  InsuranceRateCreateInput,
  InsuranceRateUpdateInput,
  InsuranceRateListQuery,
  TaxBracket,
  TaxBracketCreateInput,
  TaxBracketUpdateInput,
  TaxBracketListQuery,
  Meta,
} from './types';

export const rateMastersApi = {
  // 社会保険料率
  listInsuranceRates: async (query: InsuranceRateListQuery = {}) => {
    const { data } = await apiClient.get<{
      success: boolean;
      data: InsuranceRate[];
      meta?: { pagination?: Meta };
    }>('/rate-masters/insurance', { params: query });
    return { items: data.data, pagination: data.meta?.pagination };
  },

  getEffectiveInsuranceRate: async (params: {
    date: string;
    rate_type: string;
    prefecture?: string;
  }) => {
    const { data } = await apiClient.get<{
      success: boolean;
      data: InsuranceRate | null;
    }>('/rate-masters/insurance/effective', { params });
    return data.data;
  },

  createInsuranceRate: async (input: InsuranceRateCreateInput) => {
    const { data } = await apiClient.post<{
      success: boolean;
      data: InsuranceRate;
    }>('/rate-masters/insurance', input);
    return data.data;
  },

  updateInsuranceRate: async (id: string, input: InsuranceRateUpdateInput) => {
    const { data } = await apiClient.put<{
      success: boolean;
      data: InsuranceRate;
    }>(`/rate-masters/insurance/${id}`, input);
    return data.data;
  },

  // 源泉徴収税額表
  listTaxBrackets: async (query: TaxBracketListQuery = {}) => {
    const { data } = await apiClient.get<{
      success: boolean;
      data: TaxBracket[];
      meta?: { pagination?: Meta };
    }>('/rate-masters/tax-brackets', { params: query });
    return { items: data.data, pagination: data.meta?.pagination };
  },

  getEffectiveTaxAmount: async (params: {
    date: string;
    income: number;
    dependents_count: number;
  }) => {
    const { data } = await apiClient.get<{
      success: boolean;
      data: TaxBracket | null;
    }>('/rate-masters/tax-brackets/effective', { params });
    return data.data;
  },

  createTaxBracket: async (input: TaxBracketCreateInput) => {
    const { data } = await apiClient.post<{
      success: boolean;
      data: TaxBracket;
    }>('/rate-masters/tax-brackets', input);
    return data.data;
  },

  bulkCreateTaxBrackets: async (items: TaxBracketCreateInput[]) => {
    const { data } = await apiClient.post<{
      success: boolean;
      data: TaxBracket[];
    }>('/rate-masters/tax-brackets/bulk', { items });
    return data.data;
  },

  updateTaxBracket: async (id: string, input: TaxBracketUpdateInput) => {
    const { data } = await apiClient.put<{
      success: boolean;
      data: TaxBracket;
    }>(`/rate-masters/tax-brackets/${id}`, input);
    return data.data;
  },
};
