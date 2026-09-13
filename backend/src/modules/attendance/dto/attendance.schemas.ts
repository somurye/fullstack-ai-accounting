import { z } from 'zod';

export const attendanceStatusSchema = z.enum(['draft', 'submitted', 'approved']);

export const clockTypeSchema = z.enum(['clock_in', 'clock_out']);

export const clockActionSchema = z.object({
  employee_id: z.string().uuid('有効な従業員UUIDを指定してください'),
  type: clockTypeSchema,
  timestamp: z.string().datetime({ offset: true }).optional(),
  break_minutes: z.coerce.number().int().min(0).optional().default(0),
  is_holiday: z.boolean().optional().default(false),
  note: z.string().max(500).optional(),
});

export const attendanceRecordCreateSchema = z.object({
  employee_id: z.string().uuid('有効な従業員UUIDを指定してください'),
  work_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '勤務日は YYYY-MM-DD 形式で指定してください'),
  clock_in: z.string().datetime({ offset: true }).nullable().optional(),
  clock_out: z.string().datetime({ offset: true }).nullable().optional(),
  break_minutes: z.coerce.number().int().min(0).optional().default(0),
  is_holiday: z.boolean().optional().default(false),
  note: z.string().max(500).nullable().optional(),
  status: attendanceStatusSchema.optional().default('draft'),
});

export const attendanceRecordUpdateSchema = z.object({
  clock_in: z.string().datetime({ offset: true }).nullable().optional(),
  clock_out: z.string().datetime({ offset: true }).nullable().optional(),
  break_minutes: z.coerce.number().int().min(0).optional(),
  is_holiday: z.boolean().optional(),
  note: z.string().max(500).nullable().optional(),
  status: attendanceStatusSchema.optional(),
});

export const attendanceListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(31),
  employee_id: z.string().uuid().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type ClockActionInput = z.input<typeof clockActionSchema>;
export type AttendanceRecordCreateInput = z.input<typeof attendanceRecordCreateSchema>;
export type AttendanceRecordUpdateInput = z.input<typeof attendanceRecordUpdateSchema>;
export type AttendanceListQuery = z.input<typeof attendanceListQuerySchema>;
