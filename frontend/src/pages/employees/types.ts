export interface Employee {
  id: string;
  tenant_id: string;
  user_id: string | null;
  employee_no: string;
  name: string;
  department_id: string | null;
  department_name: string | null;
  hire_date: string;
  employment_type: 'full_time' | 'part_time' | 'contract' | 'temporary';
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

export interface EmployeeCreateInput {
  employee_no: string;
  name: string;
  user_id?: string | null;
  department_id?: string | null;
  hire_date: string;
  employment_type: 'full_time' | 'part_time' | 'contract' | 'temporary';
  status: 'active' | 'inactive';
}

export interface EmployeeUpdateInput {
  name?: string;
  user_id?: string | null;
  department_id?: string | null;
  hire_date?: string;
  employment_type?: 'full_time' | 'part_time' | 'contract' | 'temporary';
  status?: 'active' | 'inactive';
}

export interface EmployeeListQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: 'active' | 'inactive';
  department_id?: string;
}

export interface Meta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
