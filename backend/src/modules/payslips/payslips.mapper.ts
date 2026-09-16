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

export interface PayslipRow {
  id: string;
  tenant_id: string;
  payroll_calculation_id: string;
  employee_id: string;
  employee_code?: string;
  employee_name?: string;
  department_name?: string | null;
  payroll_period: string;
  payment_date: string | Date;
  snapshot_data: PayslipSnapshotData | string;
  status: 'draft' | 'confirmed';
  issued_at: string | Date | null;
  created_by: string;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface PayslipDto {
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
  status: 'draft' | 'confirmed';
  issued_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export const PAYSLIP_COLUMNS = `
  p.id,
  p.tenant_id,
  p.payroll_calculation_id,
  p.employee_id,
  e.employee_no AS employee_code,
  e.name AS employee_name,
  d.name AS department_name,
  p.payroll_period,
  p.payment_date,
  p.snapshot_data,
  p.status,
  p.issued_at,
  p.created_by,
  p.created_at,
  p.updated_at
`;

export function mapPayslipRow(row: PayslipRow): PayslipDto {
  let snapshot: PayslipSnapshotData;
  if (typeof row.snapshot_data === 'string') {
    try {
      snapshot = JSON.parse(row.snapshot_data);
    } catch {
      snapshot = {} as any;
    }
  } else {
    snapshot = row.snapshot_data;
  }

  const toIsoDate = (d: string | Date | null | undefined): string | null => {
    if (!d) return null;
    if (d instanceof Date) return d.toISOString();
    return new Date(d).toISOString();
  };

  const toYmd = (d: string | Date): string => {
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    return String(d).slice(0, 10);
  };

  return {
    id: row.id,
    tenant_id: row.tenant_id,
    payroll_calculation_id: row.payroll_calculation_id,
    employee_id: row.employee_id,
    employee_code: row.employee_code ?? snapshot?.employee?.employee_code ?? '',
    employee_name: row.employee_name ?? snapshot?.employee?.name ?? '',
    department_name: row.department_name ?? snapshot?.employee?.department_name ?? null,
    payroll_period: row.payroll_period,
    payment_date: toYmd(row.payment_date),
    snapshot_data: snapshot,
    status: row.status,
    issued_at: toIsoDate(row.issued_at),
    created_by: row.created_by,
    created_at: toIsoDate(row.created_at)!,
    updated_at: toIsoDate(row.updated_at)!,
  };
}
