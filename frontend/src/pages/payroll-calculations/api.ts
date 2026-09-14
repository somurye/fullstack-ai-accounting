import { apiClient } from '../../lib/apiClient';
import type {
  PayrollCalculation,
  PayrollPeriod,
  PayrollProfile,
} from './types';

interface Envelope<T> {
  data: T;
}

export const payrollApi = {
  // 期間管理
  async listPeriods(): Promise<PayrollPeriod[]> {
    const res = await apiClient.get<Envelope<PayrollPeriod[]>>('/payroll/periods');
    return res.data.data;
  },

  async getPeriod(id: string): Promise<PayrollPeriod> {
    const res = await apiClient.get<Envelope<PayrollPeriod>>(`/payroll/periods/${id}`);
    return res.data.data;
  },

  async createPeriod(payload: {
    name: string;
    period_start: string;
    period_end: string;
    payment_date: string;
  }): Promise<PayrollPeriod> {
    const res = await apiClient.post<Envelope<PayrollPeriod>>('/payroll/periods', payload);
    return res.data.data;
  },

  // 給与計算エンジン
  async calculateForPeriod(periodId: string, employeeIds?: string[]): Promise<PayrollCalculation[]> {
    const res = await apiClient.post<Envelope<PayrollCalculation[]>>(`/payroll/periods/${periodId}/calculate`, {
      employee_ids: employeeIds,
    });
    return res.data.data;
  },

  async listCalculations(periodId: string): Promise<PayrollCalculation[]> {
    const res = await apiClient.get<Envelope<PayrollCalculation[]>>(`/payroll/periods/${periodId}/calculations`);
    return res.data.data;
  },

  async getCalculation(id: string): Promise<PayrollCalculation> {
    const res = await apiClient.get<Envelope<PayrollCalculation>>(`/payroll/calculations/${id}`);
    return res.data.data;
  },

  // 承認申請
  async submitApproval(id: string, comment?: string): Promise<PayrollCalculation> {
    const res = await apiClient.post<Envelope<PayrollCalculation>>(`/payroll/calculations/${id}/submit-approval`, {
      comment,
    });
    return res.data.data;
  },

  async submitPeriodApproval(periodId: string, comment?: string): Promise<{ submitted_count: number }> {
    const res = await apiClient.post<Envelope<{ submitted_count: number }>>(`/payroll/periods/${periodId}/submit-approval`, {
      comment,
    });
    return res.data.data;
  },

  // 給与プロファイル
  async getProfilesByEmployee(employeeId: string): Promise<PayrollProfile[]> {
    const res = await apiClient.get<Envelope<PayrollProfile[]>>(`/payroll/profiles/employee/${employeeId}`);
    return res.data.data;
  },

  async createProfile(payload: {
    employee_id: string;
    salary_type: 'monthly' | 'hourly';
    base_salary: number;
    hourly_wage: number;
    standard_monthly_remuneration: number;
    dependents_count: number;
    has_health_insurance: boolean;
    has_care_insurance: boolean;
    has_pension: boolean;
    has_employment_insurance: boolean;
    resident_tax_amount: number;
    prefecture?: string | null;
    effective_from: string;
    effective_to?: string | null;
  }): Promise<PayrollProfile> {
    const res = await apiClient.post<Envelope<PayrollProfile>>('/payroll/profiles', payload);
    return res.data.data;
  },
};
