import { z } from 'zod';

/**
 * contracts モジュールのリクエストバリデーションスキーマ。
 */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const CONTRACT_TYPES = [
  'nda',
  'service',
  'lease',
  'sales',
  'outsourcing',
  'license',
  'employment',
  'other',
] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const CONTRACT_STATUSES = [
  'draft',
  'pending_approval',
  'active',
  'rejected',
  'expired',
  'terminated',
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const contractCreateSchema = z
  .object({
    title: z.string().min(1, '契約書タイトルは必須です'),
    counterparty_name: z.string().min(1, '取引先名は必須です'),
    contract_type: z.enum(CONTRACT_TYPES, {
      errorMap: () => ({ message: '有効な契約種別を指定してください' }),
    }),
    contract_amount: z.number().min(0, '契約金額は0以上である必要があります').nullable().optional(),
    currency: z.string().length(3).default('JPY'),
    start_date: z.string().regex(DATE_ONLY_RE, 'start_dateはYYYY-MM-DD形式で指定してください'),
    end_date: z
      .string()
      .regex(DATE_ONLY_RE, 'end_dateはYYYY-MM-DD形式で指定してください')
      .nullable()
      .optional(),
    auto_renewal: z.boolean().default(false),
    renewal_notice_days: z.number().int().min(0).default(30),
    attachment_id: z.string().uuid().nullable().optional(),
    description: z.string().nullable().optional(),
  })
  .refine(
    (v) => {
      if (!v.end_date) return true;
      return v.end_date >= v.start_date;
    },
    {
      message: 'end_dateはstart_date以降の日付を指定してください',
      path: ['end_date'],
    },
  );
export type ContractCreateInput = z.infer<typeof contractCreateSchema>;

export const contractUpdateSchema = z
  .object({
    title: z.string().min(1).optional(),
    counterparty_name: z.string().min(1).optional(),
    contract_type: z.enum(CONTRACT_TYPES).optional(),
    contract_amount: z.number().min(0).nullable().optional(),
    currency: z.string().length(3).optional(),
    start_date: z.string().regex(DATE_ONLY_RE).optional(),
    end_date: z.string().regex(DATE_ONLY_RE).nullable().optional(),
    auto_renewal: z.boolean().optional(),
    renewal_notice_days: z.number().int().min(0).optional(),
    attachment_id: z.string().uuid().nullable().optional(),
    description: z.string().nullable().optional(),
  })
  .refine(
    (v) => {
      if (v.start_date && v.end_date) {
        return v.end_date >= v.start_date;
      }
      return true;
    },
    {
      message: 'end_dateはstart_date以降の日付を指定してください',
      path: ['end_date'],
    },
  );
export type ContractUpdateInput = z.infer<typeof contractUpdateSchema>;

export const contractListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(CONTRACT_STATUSES).optional(),
  contract_type: z.enum(CONTRACT_TYPES).optional(),
  counterparty_name: z.string().optional(),
  start_date_from: z.string().regex(DATE_ONLY_RE).optional(),
  start_date_to: z.string().regex(DATE_ONLY_RE).optional(),
  end_date_from: z.string().regex(DATE_ONLY_RE).optional(),
  end_date_to: z.string().regex(DATE_ONLY_RE).optional(),
});
export type ContractListQuery = z.infer<typeof contractListQuerySchema>;

export const extractContractTermsSchema = z.object({
  attachment_id: z.string().uuid('attachment_idはUUID形式で指定してください'),
  raw_text: z.string().optional(),
});
export type ExtractContractTermsInput = z.infer<typeof extractContractTermsSchema>;
