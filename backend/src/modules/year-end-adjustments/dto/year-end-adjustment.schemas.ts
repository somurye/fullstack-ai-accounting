import { z } from 'zod';

export const yearEndAdjustmentStatusSchema = z.enum([
  'draft',
  'pending_approval',
  'active',
  'rejected',
]);
export type YearEndAdjustmentStatus = z.infer<typeof yearEndAdjustmentStatusSchema>;

export const yearEndAdjustmentCalculateSchema = z.object({
  employee_id: z.string().uuid('employee_idはUUID形式で指定してください'),
  tax_year: z.coerce
    .number()
    .int()
    .min(2020, '2020年以降を指定してください')
    .max(2100, '2100年以前を指定してください'),
  spouse_deduction: z.coerce.number().min(0).default(0),
  dependents_count: z.coerce.number().int().min(0).default(0),
  life_insurance_deduction: z.coerce.number().min(0).max(120000).default(0),
  earthquake_insurance_deduction: z.coerce.number().min(0).max(50000).default(0),
  housing_loan_deduction: z.coerce.number().min(0).default(0),
});
export type YearEndAdjustmentCalculateInput = z.infer<typeof yearEndAdjustmentCalculateSchema>;

export const yearEndAdjustmentListQuerySchema = z.object({
  tax_year: z.coerce.number().int().optional(),
  employee_id: z.string().uuid().optional(),
  status: yearEndAdjustmentStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});
export type YearEndAdjustmentListQuery = z.infer<typeof yearEndAdjustmentListQuerySchema>;

export const yearEndAdjustmentSubmitApprovalSchema = z.object({
  comment: z.string().optional(),
});
export type YearEndAdjustmentSubmitApprovalInput = z.infer<
  typeof yearEndAdjustmentSubmitApprovalSchema
>;
