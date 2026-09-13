import { z } from 'zod';

export const employmentTypeSchema = z.enum([
  'full_time',
  'part_time',
  'contract',
  'temporary',
]);

export const employeeStatusSchema = z.enum(['active', 'inactive']);

export const employeeCreateSchema = z.object({
  employee_no: z.string().trim().min(1, '社員番号は必須です').max(50),
  name: z.string().trim().min(1, '氏名は必須です').max(100),
  user_id: z.string().uuid('有効なUUIDを指定してください').nullable().optional(),
  department_id: z.string().uuid('有効なUUIDを指定してください').nullable().optional(),
  hire_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '入社日は YYYY-MM-DD 形式で指定してください'),
  employment_type: employmentTypeSchema.optional().default('full_time'),
  status: employeeStatusSchema.optional().default('active'),
});

export const employeeUpdateSchema = z.object({
  name: z.string().trim().min(1, '氏名は必須です').max(100).optional(),
  user_id: z.string().uuid('有効なUUIDを指定してください').nullable().optional(),
  department_id: z.string().uuid('有効なUUIDを指定してください').nullable().optional(),
  hire_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '入社日は YYYY-MM-DD 形式で指定してください')
    .optional(),
  employment_type: employmentTypeSchema.optional(),
  status: employeeStatusSchema.optional(),
});

export const employeeListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  search: z.string().trim().optional(),
  status: employeeStatusSchema.optional(),
  department_id: z.string().uuid().optional(),
});

export type EmployeeCreateInput = z.input<typeof employeeCreateSchema>;
export type EmployeeUpdateInput = z.input<typeof employeeUpdateSchema>;
export type EmployeeListQuery = z.input<typeof employeeListQuerySchema>;
