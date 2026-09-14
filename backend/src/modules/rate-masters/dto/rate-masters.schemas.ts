import { z } from 'zod';

export const insuranceRateTypeSchema = z.enum([
  'health_insurance',
  'care_insurance',
  'pension',
  'employment_insurance',
]);

export const insuranceRateCreateSchema = z
  .object({
    rate_type: insuranceRateTypeSchema,
    prefecture: z.string().trim().max(50).nullable().optional(),
    rate_employee: z
      .number()
      .min(0, '従業員負担率は0以上で指定してください')
      .max(1, '従業員負担率は1以下で指定してください'),
    rate_employer: z
      .number()
      .min(0, '事業主負担率は0以上で指定してください')
      .max(1, '事業主負担率は1以下で指定してください'),
    effective_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '適用開始日は YYYY-MM-DD 形式で指定してください'),
    effective_to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '適用終了日は YYYY-MM-DD 形式で指定してください')
      .nullable()
      .optional(),
    description: z.string().max(255).nullable().optional(),
  })
  .refine(
    (data) => {
      if (data.effective_to && data.effective_to < data.effective_from) {
        return false;
      }
      return true;
    },
    {
      message: '適用終了日は適用開始日以降の日付を指定してください',
      path: ['effective_to'],
    },
  );

export const insuranceRateUpdateSchema = z
  .object({
    prefecture: z.string().trim().max(50).nullable().optional(),
    rate_employee: z
      .number()
      .min(0, '従業員負担率は0以上で指定してください')
      .max(1, '従業員負担率は1以下で指定してください')
      .optional(),
    rate_employer: z
      .number()
      .min(0, '事業主負担率は0以上で指定してください')
      .max(1, '事業主負担率は1以下で指定してください')
      .optional(),
    effective_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '適用開始日は YYYY-MM-DD 形式で指定してください')
      .optional(),
    effective_to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '適用終了日は YYYY-MM-DD 形式で指定してください')
      .nullable()
      .optional(),
    description: z.string().max(255).nullable().optional(),
  })
  .refine(
    (data) => {
      if (data.effective_from && data.effective_to && data.effective_to < data.effective_from) {
        return false;
      }
      return true;
    },
    {
      message: '適用終了日は適用開始日以降の日付を指定してください',
      path: ['effective_to'],
    },
  );

export const insuranceRateListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  rate_type: insuranceRateTypeSchema.optional(),
  prefecture: z.string().trim().optional(),
  effective_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const insuranceRateEffectiveQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '基準日は YYYY-MM-DD 形式で指定してください'),
  rate_type: insuranceRateTypeSchema,
  prefecture: z.string().trim().optional(),
});

export const taxBracketCreateSchema = z
  .object({
    dependents_count: z.number().int().min(0, '扶養親族等の数は0以上で指定してください'),
    income_min: z.number().min(0, '所得下限額は0以上で指定してください'),
    income_max: z.number().min(0, '所得上限額は0以上で指定してください').nullable().optional(),
    tax_amount: z.number().min(0, '税額は0以上で指定してください'),
    effective_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '適用開始日は YYYY-MM-DD 形式で指定してください'),
    effective_to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '適用終了日は YYYY-MM-DD 形式で指定してください')
      .nullable()
      .optional(),
    description: z.string().max(255).nullable().optional(),
  })
  .refine(
    (data) => {
      if (data.income_max !== null && data.income_max !== undefined && data.income_max <= data.income_min) {
        return false;
      }
      return true;
    },
    {
      message: '所得上限額は所得下限額より大きい値を指定してください',
      path: ['income_max'],
    },
  )
  .refine(
    (data) => {
      if (data.effective_to && data.effective_to < data.effective_from) {
        return false;
      }
      return true;
    },
    {
      message: '適用終了日は適用開始日以降の日付を指定してください',
      path: ['effective_to'],
    },
  );

export const taxBracketBulkCreateSchema = z.object({
  items: z.array(taxBracketCreateSchema).min(1, '1件以上の税額帯を指定してください').max(200),
});

export const taxBracketUpdateSchema = z
  .object({
    dependents_count: z.number().int().min(0, '扶養親族等の数は0以上で指定してください').optional(),
    income_min: z.number().min(0, '所得下限額は0以上で指定してください').optional(),
    income_max: z.number().min(0, '所得上限額は0以上で指定してください').nullable().optional(),
    tax_amount: z.number().min(0, '税額は0以上で指定してください').optional(),
    effective_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '適用開始日は YYYY-MM-DD 形式で指定してください')
      .optional(),
    effective_to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '適用終了日は YYYY-MM-DD 形式で指定してください')
      .nullable()
      .optional(),
    description: z.string().max(255).nullable().optional(),
  })
  .refine(
    (data) => {
      if (
        data.income_min !== undefined &&
        data.income_max !== null &&
        data.income_max !== undefined &&
        data.income_max <= data.income_min
      ) {
        return false;
      }
      return true;
    },
    {
      message: '所得上限額は所得下限額より大きい値を指定してください',
      path: ['income_max'],
    },
  )
  .refine(
    (data) => {
      if (data.effective_from && data.effective_to && data.effective_to < data.effective_from) {
        return false;
      }
      return true;
    },
    {
      message: '適用終了日は適用開始日以降の日付を指定してください',
      path: ['effective_to'],
    },
  );

export const taxBracketListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  dependents_count: z.coerce.number().int().min(0).optional(),
  effective_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const taxBracketEffectiveQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '基準日は YYYY-MM-DD 形式で指定してください'),
  income: z.coerce.number().min(0, '所得金額は0以上で指定してください'),
  dependents_count: z.coerce.number().int().min(0, '扶養親族等の数は0以上で指定してください'),
});

export type InsuranceRateCreateInput = z.input<typeof insuranceRateCreateSchema>;
export type InsuranceRateUpdateInput = z.input<typeof insuranceRateUpdateSchema>;
export type InsuranceRateListQuery = z.input<typeof insuranceRateListQuerySchema>;
export type InsuranceRateEffectiveQuery = z.input<typeof insuranceRateEffectiveQuerySchema>;

export type TaxBracketCreateInput = z.input<typeof taxBracketCreateSchema>;
export type TaxBracketBulkCreateInput = z.input<typeof taxBracketBulkCreateSchema>;
export type TaxBracketUpdateInput = z.input<typeof taxBracketUpdateSchema>;
export type TaxBracketListQuery = z.input<typeof taxBracketListQuerySchema>;
export type TaxBracketEffectiveQuery = z.input<typeof taxBracketEffectiveQuerySchema>;

export interface InsuranceRateDto {
  id: string;
  tenant_id: string;
  rate_type: string;
  prefecture: string | null;
  rate_employee: number;
  rate_employer: number;
  rate_total: number;
  effective_from: string;
  effective_to: string | null;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaxBracketDto {
  id: string;
  tenant_id: string;
  dependents_count: number;
  income_min: number;
  income_max: number | null;
  tax_amount: number;
  effective_from: string;
  effective_to: string | null;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
