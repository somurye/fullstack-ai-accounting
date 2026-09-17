import { z } from 'zod';

export const DEAL_STAGES = [
  'lead',
  'qualified',
  'proposal',
  'negotiation',
  'won',
  'lost',
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

export const createDealSchema = z.object({
  customer_id: z.string().uuid('顧客IDは有効なUUID形式で指定してください'),
  title: z.string().trim().min(1, '案件名は必須です').max(200, '案件名は200文字以内で指定してください'),
  stage: z.enum(DEAL_STAGES).default('lead'),
  expected_amount: z.coerce.number().min(0, '予想金額は0以上で指定してください').default(0),
  currency_code: z.string().length(3, '通貨コードは3文字で指定してください').default('JPY'),
  expected_close_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '受注予定日はYYYY-MM-DD形式で指定してください')
    .optional()
    .nullable(),
  owner_user_id: z.string().uuid('担当者IDは有効なUUID形式で指定してください').optional().nullable(),
  lost_reason: z.string().trim().optional().nullable(),
}).refine(
  (data) => {
    if (data.stage === 'lost') {
      return !!data.lost_reason && data.lost_reason.trim().length > 0;
    }
    return true;
  },
  {
    message: '失注(lost)の場合は失注理由(lost_reason)が必須です',
    path: ['lost_reason'],
  },
);

export const updateDealSchema = z.object({
  customer_id: z.string().uuid('顧客IDは有効なUUID形式で指定してください').optional(),
  title: z.string().trim().min(1, '案件名は必須です').max(200, '案件名は200文字以内で指定してください').optional(),
  stage: z.enum(DEAL_STAGES).optional(),
  expected_amount: z.coerce.number().min(0, '予想金額は0以上で指定してください').optional(),
  currency_code: z.string().length(3, '通貨コードは3文字で指定してください').optional(),
  expected_close_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '受注予定日はYYYY-MM-DD形式で指定してください')
    .optional()
    .nullable(),
  owner_user_id: z.string().uuid('担当者IDは有効なUUID形式で指定してください').optional().nullable(),
  lost_reason: z.string().trim().optional().nullable(),
}).refine(
  (data) => {
    if (data.stage === 'lost') {
      return !!data.lost_reason && data.lost_reason.trim().length > 0;
    }
    return true;
  },
  {
    message: '失注(lost)の場合は失注理由(lost_reason)が必須です',
    path: ['lost_reason'],
  },
);

export const closeDealSchema = z.object({
  stage: z.enum(['won', 'lost'], {
    errorMap: () => ({ message: 'クローズ時のステージは won または lost を指定してください' }),
  }),
  lost_reason: z.string().trim().optional().nullable(),
}).refine(
  (data) => {
    if (data.stage === 'lost') {
      return !!data.lost_reason && data.lost_reason.trim().length > 0;
    }
    return true;
  },
  {
    message: '失注(lost)の場合は失注理由(lost_reason)が必須です',
    path: ['lost_reason'],
  },
);

export const dealListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  stage: z.enum(DEAL_STAGES).optional(),
  customer_id: z.string().uuid('顧客IDは有効なUUID形式で指定してください').optional(),
  owner_user_id: z.string().uuid('担当者IDは有効なUUID形式で指定してください').optional(),
  search: z.string().trim().optional(),
});

export type CreateDealInput = z.input<typeof createDealSchema>;
export type UpdateDealInput = z.input<typeof updateDealSchema>;
export type CloseDealInput = z.input<typeof closeDealSchema>;
export type DealListQuery = z.input<typeof dealListQuerySchema>;
