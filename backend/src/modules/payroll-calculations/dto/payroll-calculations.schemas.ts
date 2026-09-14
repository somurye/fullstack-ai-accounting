import { z } from 'zod';

export const SALARY_TYPES = ['monthly', 'hourly'] as const;
export const PAYROLL_PERIOD_STATUSES = ['draft', 'calculating', 'calculated', 'approved', 'closed'] as const;
export const PAYROLL_CALCULATION_STATUSES = ['draft', 'pending_approval', 'active', 'rejected'] as const;

export const createPayrollProfileSchema = z.object({
  employee_id: z.string().uuid('有効なemployee_idを指定してください'),
  salary_type: z.enum(SALARY_TYPES).default('monthly'),
  base_salary: z.coerce.number().min(0, '基本給は0以上である必要があります').default(0),
  hourly_wage: z.coerce.number().min(0, '時給は0以上である必要があります').default(0),
  standard_monthly_remuneration: z.coerce.number().min(0, '標準報酬月額は0以上である必要があります').default(0),
  dependents_count: z.coerce.number().int().min(0, '扶養親族等の数は0以上である必要があります').default(0),
  has_health_insurance: z.boolean().default(true),
  has_care_insurance: z.boolean().default(false),
  has_pension: z.boolean().default(true),
  has_employment_insurance: z.boolean().default(true),
  resident_tax_amount: z.coerce.number().min(0, '住民税は0以上である必要があります').default(0),
  prefecture: z.string().optional().nullable(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'effective_fromはYYYY-MM-DD形式で指定してください'),
  effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'effective_toはYYYY-MM-DD形式で指定してください').optional().nullable(),
});
export type CreatePayrollProfileInput = z.infer<typeof createPayrollProfileSchema>;

export const closePayrollProfileSchema = z.object({
  effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'effective_toはYYYY-MM-DD形式で指定してください'),
});
export type ClosePayrollProfileInput = z.infer<typeof closePayrollProfileSchema>;

export const createPayrollPeriodSchema = z.object({
  name: z.string().min(1, '名称は必須です'),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'period_startはYYYY-MM-DD形式で指定してください'),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'period_endはYYYY-MM-DD形式で指定してください'),
  payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'payment_dateはYYYY-MM-DD形式で指定してください'),
});
export type CreatePayrollPeriodInput = z.infer<typeof createPayrollPeriodSchema>;

export const calculatePayrollSchema = z.object({
  employee_ids: z.array(z.string().uuid()).optional(),
});
export type CalculatePayrollInput = z.infer<typeof calculatePayrollSchema>;

export const submitApprovalSchema = z.object({
  comment: z.string().optional(),
});
export type SubmitApprovalInput = z.infer<typeof submitApprovalSchema>;
