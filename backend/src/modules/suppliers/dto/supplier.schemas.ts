import { z } from 'zod';

export const supplierStatusSchema = z.enum(['active', 'inactive']);
export type SupplierStatus = z.infer<typeof supplierStatusSchema>;

export const supplierCreateSchema = z.object({
  name: z.string().trim().min(1, 'サプライヤー名は必須です').max(255, 'サプライヤー名は255文字以内で入力してください'),
  contact_name: z.string().trim().max(100, '担当者名は100文字以内で入力してください').optional().nullable(),
  contact_email: z.string().trim().email('有効なメールアドレスを入力してください').max(255).optional().nullable().or(z.literal('')),
  contact_phone: z.string().trim().max(50, '電話番号は50文字以内で入力してください').optional().nullable(),
  payment_terms: z.string().trim().max(255, '支払条件は255文字以内で入力してください').optional().nullable(),
  status: supplierStatusSchema.default('active'),
});

export type SupplierCreateInput = z.infer<typeof supplierCreateSchema>;

export const supplierUpdateSchema = z.object({
  name: z.string().trim().min(1, 'サプライヤー名は必須です').max(255, 'サプライヤー名は255文字以内で入力してください').optional(),
  contact_name: z.string().trim().max(100, '担当者名は100文字以内で入力してください').optional().nullable(),
  contact_email: z.string().trim().email('有効なメールアドレスを入力してください').max(255).optional().nullable().or(z.literal('')),
  contact_phone: z.string().trim().max(50, '電話番号は50文字以内で入力してください').optional().nullable(),
  payment_terms: z.string().trim().max(255, '支払条件は255文字以内で入力してください').optional().nullable(),
  status: supplierStatusSchema.optional(),
});

export type SupplierUpdateInput = z.infer<typeof supplierUpdateSchema>;

export const supplierListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(20),
  status: supplierStatusSchema.optional(),
  search: z.string().trim().optional(),
});

export type SupplierListQuery = z.infer<typeof supplierListQuerySchema>;
