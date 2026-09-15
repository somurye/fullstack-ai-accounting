import { apiClient } from '../../lib/apiClient';
import type { PaginationMeta, Payslip, PayslipListQuery } from './types';

interface Envelope<T> {
  success: boolean;
  data: T;
  meta: {
    request_id: string | null;
    pagination?: PaginationMeta;
  };
}

export const payslipsApi = {
  async list(query?: PayslipListQuery): Promise<{ payslips: Payslip[]; pagination?: PaginationMeta }> {
    const params = new URLSearchParams();
    if (query?.payroll_period) params.append('payroll_period', query.payroll_period);
    if (query?.employee_id) params.append('employee_id', query.employee_id);
    if (query?.status) params.append('status', query.status);
    if (query?.page) params.append('page', String(query.page));
    if (query?.page_size) params.append('page_size', String(query.page_size));

    const res = await apiClient.get<Envelope<Payslip[]>>(`/payslips?${params.toString()}`);
    return {
      payslips: res.data.data,
      pagination: res.data.meta.pagination,
    };
  },

  async get(id: string): Promise<Payslip> {
    const res = await apiClient.get<Envelope<Payslip>>(`/payslips/${id}`);
    return res.data.data;
  },

  async create(payload: { payroll_calculation_id: string; status?: 'draft' | 'confirmed' }): Promise<Payslip> {
    const res = await apiClient.post<Envelope<Payslip>>('/payslips', payload);
    return res.data.data;
  },

  async confirm(id: string): Promise<Payslip> {
    const res = await apiClient.post<Envelope<Payslip>>(`/payslips/${id}/confirm`, {});
    return res.data.data;
  },

  async downloadPdf(id: string, filename?: string): Promise<void> {
    const res = await apiClient.get(`/payslips/${id}/pdf`, {
      responseType: 'blob',
    });
    const blob = new Blob([res.data], { type: 'application/pdf' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || `payslip_${id.slice(0, 8)}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  },
};
