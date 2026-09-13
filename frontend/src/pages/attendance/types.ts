export interface AttendanceRecord {
  id: string;
  tenant_id: string;
  employee_id: string;
  employee_no: string | null;
  employee_name: string | null;
  work_date: string;
  clock_in: string | null;
  clock_out: string | null;
  break_minutes: number;
  regular_hours: number;
  overtime_hours: number;
  late_night_hours: number;
  holiday_hours: number;
  is_holiday: boolean;
  note: string | null;
  status: 'draft' | 'submitted' | 'approved';
  created_at: string;
  updated_at: string;
}

export interface ClockActionInput {
  employee_id: string;
  type: 'clock_in' | 'clock_out';
  timestamp?: string;
  break_minutes?: number;
  is_holiday?: boolean;
  note?: string;
}

export interface AttendanceRecordCreateInput {
  employee_id: string;
  work_date: string;
  clock_in?: string | null;
  clock_out?: string | null;
  break_minutes?: number;
  is_holiday?: boolean;
  note?: string | null;
  status?: 'draft' | 'submitted' | 'approved';
}

export interface AttendanceRecordUpdateInput {
  clock_in?: string | null;
  clock_out?: string | null;
  break_minutes?: number;
  is_holiday?: boolean;
  note?: string | null;
  status?: 'draft' | 'submitted' | 'approved';
}

export interface AttendanceListQuery {
  page?: number;
  limit?: number;
  employee_id?: string;
  start_date?: string;
  end_date?: string;
}

export interface Meta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
