export type YearEndAdjustmentStatus =
  | 'draft'
  | 'pending_approval'
  | 'active'
  | 'rejected';

export interface YearEndAdjustmentDeductions {
  basic_deduction?: number;
  spouse_deduction?: number;
  dependents_deduction?: number;
  life_insurance_deduction?: number;
  earthquake_insurance_deduction?: number;
  housing_loan_deduction?: number;
  social_insurance_deduction?: number;
  employment_income_deduction?: number;
}

export interface YearEndAdjustment {
  id: string;
  tenant_id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  tax_year: number;
  annual_gross_pay: number;
  annual_taxable_pay: number;
  annual_social_insurance: number;
  annual_withheld_tax: number;
  deductions: YearEndAdjustmentDeductions;
  total_deductions: number;
  taxable_income_after_deductions: number;
  final_annual_tax: number;
  adjustment_amount: number;
  applied_rate_ids: string[];
  status: YearEndAdjustmentStatus;
  approval_request_id: string | null;
  confirmed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface YearEndAdjustmentCalculateInput {
  employee_id: string;
  tax_year: number;
  spouse_deduction?: number;
  dependents_count?: number;
  life_insurance_deduction?: number;
  earthquake_insurance_deduction?: number;
  housing_loan_deduction?: number;
}

export interface YearEndAdjustmentListQuery {
  tax_year?: number;
  employee_id?: string;
  status?: YearEndAdjustmentStatus;
  page?: number;
  page_size?: number;
}

export interface PaginationMeta {
  page: number;
  page_size: number;
  total_count: number;
  total_pages: number;
}
