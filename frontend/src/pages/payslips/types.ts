export type PayslipStatus = 'draft' | 'confirmed';

export interface PayslipSnapshotData {
  employee: {
    id: string;
    employee_code: string;
    name: string;
    department_name: string | null;
  };
  attendance: {
    regular_hours: number;
    overtime_hours: number;
    late_night_hours: number;
    holiday_hours: number;
  };
  earnings: {
    salary_type: string;
    base_salary: number;
    hourly_wage: number;
    regular_pay: number;
    overtime_pay: number;
    late_night_pay: number;
    holiday_pay: number;
    total_gross_pay: number;
  };
  deductions: {
    health_insurance_amount: number;
    care_insurance_amount: number;
    pension_amount: number;
    employment_insurance_amount: number;
    income_tax_amount: number;
    resident_tax_amount: number;
    total_deductions: number;
  };
  net_pay: number;
}

export interface Payslip {
  id: string;
  tenant_id: string;
  payroll_calculation_id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  department_name: string | null;
  payroll_period: string;
  payment_date: string;
  snapshot_data: PayslipSnapshotData;
  status: PayslipStatus;
  issued_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PayslipListQuery {
  payroll_period?: string;
  employee_id?: string;
  status?: PayslipStatus;
  page?: number;
  page_size?: number;
}

export interface PaginationMeta {
  page: number;
  page_size: number;
  total_count: number;
  total_pages: number;
}
