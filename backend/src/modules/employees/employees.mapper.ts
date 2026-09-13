export interface EmployeeRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  employee_no: string;
  name: string;
  department_id: string | null;
  department_name?: string | null;
  hire_date: string | Date;
  employment_type: string;
  status: string;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface EmployeeDto {
  id: string;
  tenant_id: string;
  user_id: string | null;
  employee_no: string;
  name: string;
  department_id: string | null;
  department_name: string | null;
  hire_date: string;
  employment_type: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function formatDate(date: string | Date): string {
  if (date instanceof Date) {
    return date.toISOString().split('T')[0]!;
  }
  return String(date).split('T')[0]!;
}

function formatIso(date: string | Date): string {
  if (date instanceof Date) {
    return date.toISOString();
  }
  return new Date(date).toISOString();
}

export function mapEmployeeRow(row: EmployeeRow): EmployeeDto {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    employee_no: row.employee_no,
    name: row.name,
    department_id: row.department_id,
    department_name: row.department_name ?? null,
    hire_date: formatDate(row.hire_date),
    employment_type: row.employment_type,
    status: row.status,
    created_at: formatIso(row.created_at),
    updated_at: formatIso(row.updated_at),
  };
}
