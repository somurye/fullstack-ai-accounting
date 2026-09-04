import { z } from 'zod';

export const generalRequestCategorySchema = z.enum([
  'general',
  'equipment',
  'rule_change',
  'business_trip',
  'other',
]);

export const createGeneralRequestSchema = z.object({
  title: z.string().min(1, 'タイトルを入力してください').max(200, 'タイトルは200文字以内で入力してください'),
  description: z.string().min(1, '説明・理由を入力してください'),
  category: z.string().optional().default('general'),
  amount: z.number().nullable().optional(),
  attachment_id: z.string().uuid('添付ファイルIDはUUID形式で指定してください').nullable().optional(),
});

export const updateGeneralRequestSchema = z.object({
  title: z.string().min(1, 'タイトルを入力してください').max(200, 'タイトルは200文字以内で入力してください').optional(),
  description: z.string().min(1, '説明・理由を入力してください').optional(),
  category: z.string().optional(),
  amount: z.number().nullable().optional(),
  attachment_id: z.string().uuid('添付ファイルIDはUUID形式で指定してください').nullable().optional(),
});

export const generalRequestListQuerySchema = z.object({
  status: z.enum(['draft', 'pending_approval', 'active', 'rejected']).optional(),
  category: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateGeneralRequestDto = z.infer<typeof createGeneralRequestSchema>;
export type UpdateGeneralRequestDto = z.infer<typeof updateGeneralRequestSchema>;
export type GeneralRequestListQueryDto = z.infer<typeof generalRequestListQuerySchema>;

export type CreateGeneralRequestInput = z.input<typeof createGeneralRequestSchema>;
export type UpdateGeneralRequestInput = z.input<typeof updateGeneralRequestSchema>;
export type GeneralRequestListQuery = GeneralRequestListQueryDto;



