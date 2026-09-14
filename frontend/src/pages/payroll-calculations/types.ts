export type SalaryType = 'monthly' | 'hourly';
export type PayrollPeriodStatus = 'draft' | 'calculating' | 'calculated' | 'approved' | 'closed';
export type PayrollCalculationStatus = 'draft' | 'pending_approval' | 'active' | 'rejected';

export interface AppliedRateEntry {
  type: 'health_insurance' | 'care_insurance' | 'pension' | 'employment_insurance' | 'income_tax';
  rate_id: string;
  name?: string;
  rate?: number;
  base_amount?: number;
  dependents_count?: number;
  taxable_income?: number;
  tax_amount?: number;
}

export interface PayrollProfile {
  id: string;
  tenant_id: string;
  employee_id: string;
  salary_type: SalaryType;
  base_salary: string;
  hourly_wage: string;
  standard_monthly_remuneration: string;
  dependents_count: number;
  has_health_insurance: boolean;
  has_care_insurance: boolean;
  has_pension: boolean;
  has_employment_insurance: boolean;
  resident_tax_amount: string;
  prefecture: string | null;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayrollPeriod {
  id: string;
  tenant_id: string;
  name: string;
  period_start: string;
  period_end: string;
  payment_date: string;
  status: PayrollPeriodStatus;
  created_at: string;
  updated_at: string;
}

export interface PayrollCalculation {
  id: string;
  tenant_id: string;
  payroll_period_id: string;
  employee_id: string;
  employee_name?: string;
  employee_no?: string;
  regular_hours: string;
  overtime_hours: string;
  late_night_hours: string;
  holiday_hours: string;
  salary_type: SalaryType;
  base_salary: string;
  hourly_wage: string;
  regular_pay: string;
  overtime_pay: string;
  late_night_pay: string;
  holiday_pay: string;
  total_gross_pay: string;
  health_insurance_amount: string;
  care_insurance_amount: string;
  pension_amount: string;
  employment_insurance_amount: string;
  income_tax_amount: string;
  resident_tax_amount: string;
  total_deductions: string;
  net_pay: string;
  applied_rate_ids: AppliedRateEntry[];
  status: PayrollCalculationStatus;
  created_by: string;
  approved_at: string | null;
  approval_request_id: string | null;
  created_at: string;
  updated_at: string;
}
