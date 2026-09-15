export interface YearEndAdjustmentDeductions {
  basic_deduction: number;
  spouse_deduction: number;
  dependents_deduction: number;
  life_insurance_deduction: number;
  earthquake_insurance_deduction: number;
  housing_loan_deduction: number;
  social_insurance_deduction: number;
}

export interface YearEndAdjustmentRow {
  id: string;
  tenant_id: string;
  employee_id: string;
  employee_code?: string;
  employee_name?: string;
  department_name?: string | null;
  tax_year: number;
  annual_gross_pay: string | number;
  annual_taxable_pay: string | number;
  annual_social_insurance: string | number;
  annual_withheld_tax: string | number;
  deductions: YearEndAdjustmentDeductions | string;
  total_deductions: string | number;
  taxable_income_after_deductions: string | number;
  final_annual_tax: string | number;
  adjustment_amount: string | number;
  applied_rate_ids: string[] | string;
  status: 'draft' | 'pending_approval' | 'active' | 'rejected';
  approval_request_id: string | null;
  approved_at: string | Date | null;
  created_by: string;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface YearEndAdjustmentDto {
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
  status: 'draft' | 'pending_approval' | 'active' | 'rejected';
  approval_request_id: string | null;
  approved_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export const YEAR_END_ADJUSTMENT_COLUMNS = `
  y.id,
  y.tenant_id,
  y.employee_id,
  e.employee_code,
  e.name AS employee_name,
  d.name AS department_name,
  y.tax_year,
  y.annual_gross_pay,
  y.annual_taxable_pay,
  y.annual_social_insurance,
  y.annual_withheld_tax,
  y.deductions,
  y.total_deductions,
  y.taxable_income_after_deductions,
  y.final_annual_tax,
  y.adjustment_amount,
  y.applied_rate_ids,
  y.status,
  y.approval_request_id,
  y.approved_at,
  y.created_by,
  y.created_at,
  y.updated_at
`;

export function mapYearEndAdjustmentRow(row: YearEndAdjustmentRow): YearEndAdjustmentDto {
  let deductions: YearEndAdjustmentDeductions;
  if (typeof row.deductions === 'string') {
    try {
      deductions = JSON.parse(row.deductions);
    } catch {
      deductions = {} as any;
    }
  } else {
    deductions = row.deductions;
  }

  let rateIds: string[];
  if (typeof row.applied_rate_ids === 'string') {
    try {
      rateIds = JSON.parse(row.applied_rate_ids);
    } catch {
      rateIds = [];
    }
  } else {
    rateIds = row.applied_rate_ids ?? [];
  }

  const toIsoDate = (d: string | Date | null | undefined): string | null => {
    if (!d) return null;
    if (d instanceof Date) return d.toISOString();
    return new Date(d).toISOString();
  };

  return {
    id: row.id,
    tenant_id: row.tenant_id,
    employee_id: row.employee_id,
    employee_code: row.employee_code ?? '',
    employee_name: row.employee_name ?? '',
    department_name: row.department_name ?? null,
    tax_year: row.tax_year,
    annual_gross_pay: Number(row.annual_gross_pay),
    annual_taxable_pay: Number(row.annual_taxable_pay),
    annual_social_insurance: Number(row.annual_social_insurance),
    annual_withheld_tax: Number(row.annual_withheld_tax),
    deductions,
    total_deductions: Number(row.total_deductions),
    taxable_income_after_deductions: Number(row.taxable_income_after_deductions),
    final_annual_tax: Number(row.final_annual_tax),
    adjustment_amount: Number(row.adjustment_amount),
    applied_rate_ids: rateIds,
    status: row.status,
    approval_request_id: row.approval_request_id,
    approved_at: toIsoDate(row.approved_at),
    created_by: row.created_by,
    created_at: toIsoDate(row.created_at)!,
    updated_at: toIsoDate(row.updated_at)!,
  };
}
