import { z } from 'zod';

export const payrollImportColumnMappingSchema = z.object({
  employee_name: z.string().min(1),
  employee_code: z.string().min(1).optional(),
  executive_compensation_amount: z.string().min(1).optional(),
  salary_amount: z.string().min(1).optional(),
  withholding_tax_amount: z.string().min(1).optional(),
  resident_tax_amount: z.string().min(1).optional(),
  social_insurance_employee_amount: z.string().min(1).optional(),
  social_insurance_company_amount: z.string().min(1).optional(),
  net_payment_amount: z.string().min(1).optional(),
});
export type PayrollImportColumnMapping = z.infer<typeof payrollImportColumnMappingSchema>;

export const payrollImportAccountMappingSchema = z.object({
  executive_compensation_account_id: z.string().uuid().nullable().optional(),
  salary_account_id: z.string().uuid().nullable().optional(),
  withholding_tax_account_id: z.string().uuid().nullable().optional(),
  resident_tax_account_id: z.string().uuid().nullable().optional(),
  social_insurance_employee_account_id: z.string().uuid().nullable().optional(),
  social_insurance_company_expense_account_id: z.string().uuid().nullable().optional(),
  social_insurance_company_payable_account_id: z.string().uuid().nullable().optional(),
  net_payment_account_id: z.string().uuid('net_payment_account_idはUUID形式で指定してください'),
});
export type PayrollImportAccountMapping = z.infer<typeof payrollImportAccountMappingSchema>;

export const payrollImportMappingListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  is_active: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});
export type PayrollImportMappingListQuery = z.infer<typeof payrollImportMappingListQuerySchema>;

export const payrollImportMappingCreateSchema = z.object({
  name: z.string().min(1, 'nameは必須です'),
  column_mapping: payrollImportColumnMappingSchema,
  account_mapping: payrollImportAccountMappingSchema,
  is_active: z.boolean().default(true),
});
export type PayrollImportMappingCreateInput = z.infer<typeof payrollImportMappingCreateSchema>;
