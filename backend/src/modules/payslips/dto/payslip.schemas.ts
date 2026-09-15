import { z } from 'zod';

export const payslipStatusSchema = z.enum(['draft', 'confirmed']);
export type PayslipStatus = z.infer<typeof payslipStatusSchema>;

export const payslipCreateSchema = z.object({
  payroll_calculation_id: z.string().uuid('payroll_calculation_idはUUID形式で指定してください'),
  status: payslipStatusSchema.default('confirmed'),
});
export type PayslipCreateInput = z.infer<typeof payslipCreateSchema>;

export const payslipListQuerySchema = z.object({
  employee_id: z.string().uuid('employee_idはUUID形式で指定してください').optional(),
  payroll_period: z.string().min(1).optional(),
  status: payslipStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});
export type PayslipListQuery = z.infer<typeof payslipListQuerySchema>;
