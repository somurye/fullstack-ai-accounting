import { z } from 'zod';

export const quotationLineItemSchema = z.object({
  item_name: z.string().trim().min(1, '品目名は必須です'),
  description: z.string().trim().optional().nullable(),
  quantity: z.number().positive('数量は正の数で指定してください'),
  unit: z.string().trim().default('式'),
  unit_price: z.number().min(0, '単価は0以上で指定してください'),
  tax_rate: z.number().min(0).default(0.1),
  tax_category_id: z.string().uuid('税区分IDはUUID形式で指定してください').optional().nullable(),
});

export const quotationCreateSchema = z.object({
  customer_id: z.string().uuid('顧客IDはUUID形式で指定してください'),
  deal_id: z.string().uuid('案件IDはUUID形式で指定してください').optional().nullable(),
  title: z.string().trim().min(1, '件名は必須です').max(200, '件名は200文字以内で指定してください'),
  issue_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '発行日はYYYY-MM-DD形式で指定してください')
    .optional(),
  valid_until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '有効期限はYYYY-MM-DD形式で指定してください')
    .optional()
    .nullable(),
  notes: z.string().trim().optional().nullable(),
  lines: z.array(quotationLineItemSchema).min(1, '見積明細は少なくとも1行入力してください'),
});

export const quotationUpdateSchema = z.object({
  customer_id: z.string().uuid('顧客IDはUUID形式で指定してください').optional(),
  deal_id: z.string().uuid('案件IDはUUID形式で指定してください').optional().nullable(),
  title: z.string().trim().min(1, '件名は必須です').max(200, '件名は200文字以内で指定してください').optional(),
  issue_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '発行日はYYYY-MM-DD形式で指定してください')
    .optional(),
  valid_until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '有効期限はYYYY-MM-DD形式で指定してください')
    .optional()
    .nullable(),
  notes: z.string().trim().optional().nullable(),
  lines: z.array(quotationLineItemSchema).min(1, '見積明細は少なくとも1行入力してください').optional(),
});

export const quotationListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['draft', 'sent', 'accepted', 'rejected', 'expired']).optional(),
  customer_id: z.string().uuid('顧客IDはUUID形式で指定してください').optional(),
  deal_id: z.string().uuid('案件IDはUUID形式で指定してください').optional(),
  search: z.string().trim().optional(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const quotationReviseSchema = z.object({
  notes: z.string().trim().optional().nullable(),
});

export type QuotationLineItemInput = z.infer<typeof quotationLineItemSchema>;
export type CreateQuotationInput = z.infer<typeof quotationCreateSchema>;
export type UpdateQuotationInput = z.infer<typeof quotationUpdateSchema>;
export type QuotationListQuery = z.infer<typeof quotationListQuerySchema>;
export type ReviseQuotationInput = z.infer<typeof quotationReviseSchema>;
