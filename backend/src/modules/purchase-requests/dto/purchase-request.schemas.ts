import { z } from 'zod';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const purchaseRequestStatusSchema = z.enum([
  'draft',
  'pending_approval',
  'active',
  'rejected',
  'terminated',
]);
export type PurchaseRequestStatus = z.infer<typeof purchaseRequestStatusSchema>;

export const createPurchaseRequestSchema = z
  .object({
    title: z.string().min(1, '件名を入力してください').max(200, '件名は200文字以内で入力してください'),
    supplier_name: z.string().min(1, 'サプライヤー・取引先名を入力してください').max(200, 'サプライヤー名は200文字以内で入力してください'),
    item_description: z.string().min(1, '品目・仕様説明を入力してください'),
    quantity: z.number().positive('数量は0より大きい数値を入力してください'),
    unit_price: z.number().min(0, '単価は0以上で入力してください'),
    total_amount: z.number().min(0, '合計金額は0以上で入力してください').optional(),
    currency: z.string().length(3, '通貨コードは3文字で入力してください').default('JPY'),
    requested_delivery_date: z
      .string()
      .regex(DATE_ONLY_RE, '希望納期はYYYY-MM-DD形式で指定してください')
      .nullable()
      .optional(),
    attachment_id: z.string().uuid('添付ファイルIDはUUID形式で指定してください').nullable().optional(),
    description: z.string().nullable().optional(),
  })
  .transform((val) => {
    const calculated = Math.round(val.quantity * val.unit_price * 100) / 100;
    return {
      ...val,
      total_amount: val.total_amount !== undefined ? val.total_amount : calculated,
    };
  })
  .refine(
    (val) => {
      const calculated = Math.round(val.quantity * val.unit_price * 100) / 100;
      return Math.abs(val.total_amount - calculated) < 0.01;
    },
    {
      message: '合計金額が 数量 × 単価 と一致しません',
      path: ['total_amount'],
    },
  );

export const updatePurchaseRequestSchema = z
  .object({
    title: z.string().min(1, '件名を入力してください').max(200, '件名は200文字以内で入力してください').optional(),
    supplier_name: z.string().min(1, 'サプライヤー・取引先名を入力してください').max(200, 'サプライヤー名は200文字以内で入力してください').optional(),
    item_description: z.string().min(1, '品目・仕様説明を入力してください').optional(),
    quantity: z.number().positive('数量は0より大きい数値を入力してください').optional(),
    unit_price: z.number().min(0, '単価は0以上で入力してください').optional(),
    total_amount: z.number().min(0, '合計金額は0以上で入力してください').optional(),
    currency: z.string().length(3, '通貨コードは3文字で入力してください').optional(),
    requested_delivery_date: z
      .string()
      .regex(DATE_ONLY_RE, '希望納期はYYYY-MM-DD形式で指定してください')
      .nullable()
      .optional(),
    attachment_id: z.string().uuid('添付ファイルIDはUUID形式で指定してください').nullable().optional(),
    description: z.string().nullable().optional(),
  });

export const purchaseRequestListQuerySchema = z.object({
  status: purchaseRequestStatusSchema.optional(),
  search: z.string().optional(),
  supplier_name: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreatePurchaseRequestInput = z.input<typeof createPurchaseRequestSchema>;
export type CreatePurchaseRequestDto = z.output<typeof createPurchaseRequestSchema>;
export type UpdatePurchaseRequestInput = z.input<typeof updatePurchaseRequestSchema>;
export type UpdatePurchaseRequestDto = z.output<typeof updatePurchaseRequestSchema>;
export type PurchaseRequestListQuery = z.infer<typeof purchaseRequestListQuerySchema>;
