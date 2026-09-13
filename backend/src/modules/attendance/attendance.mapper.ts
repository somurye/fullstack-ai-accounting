export interface AttendanceRecordRow {
  id: string;
  tenant_id: string;
  employee_id: string;
  employee_no?: string;
  employee_name?: string;
  work_date: string | Date;
  clock_in: string | Date | null;
  clock_out: string | Date | null;
  break_minutes: number;
  regular_hours: string | number;
  overtime_hours: string | number;
  late_night_hours: string | number;
  holiday_hours: string | number;
  is_holiday: boolean;
  note: string | null;
  status: string;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface AttendanceRecordDto {
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

function formatIso(date: string | Date | null): string | null {
  if (!date) return null;
  if (date instanceof Date) {
    return date.toISOString();
  }
  return new Date(date).toISOString();
}

export function mapAttendanceRecordRow(row: AttendanceRecordRow): AttendanceRecordDto {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    employee_id: row.employee_id,
    employee_no: row.employee_no ?? null,
    employee_name: row.employee_name ?? null,
    work_date: formatDate(row.work_date),
    clock_in: formatIso(row.clock_in),
    clock_out: formatIso(row.clock_out),
    break_minutes: row.break_minutes,
    regular_hours: Number(row.regular_hours),
    overtime_hours: Number(row.overtime_hours),
    late_night_hours: Number(row.late_night_hours),
    holiday_hours: Number(row.holiday_hours),
    is_holiday: Boolean(row.is_holiday),
    note: row.note ?? null,
    status: row.status,
    created_at: formatIso(row.created_at) ?? '',
    updated_at: formatIso(row.updated_at) ?? '',
  };
}
