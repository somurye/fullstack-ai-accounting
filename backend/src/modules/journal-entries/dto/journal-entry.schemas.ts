import { z } from 'zod';

/**
 * journal-entries モジュールのリクエストバリデーションスキーマ。
 * `docs/openapi.yaml` の `JournalEntryCreate` / `JournalEntryUpdate` /
 * `JournalEntryLineCreate` 等に1対1で対応させている。
 */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const JOURNAL_ENTRY_STATUSES = [
  'draft',
  'pending_approval',
  'posted',
  'rejected',
  'voided',
  'reversed',
] as const;

export const journalEntryLineCreateSchema = z.object({
  account_id: z.string().uuid(),
  debit_credit: z.enum(['debit', 'credit']),
  amount: z.number().positive(),
  tax_category_id: z.string().uuid().optional(),
  department_id: z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
  vendor_id: z.string().uuid().optional(),
  description: z.string().optional(),
});
export type JournalEntryLineCreateInput = z.infer<typeof journalEntryLineCreateSchema>;

export const journalEntryCreateSchema = z.object({
  entry_date: z.string().regex(DATE_ONLY_RE, 'entry_date is YYYY-MM-DD形式で指定してください'),
  description: z.string().optional(),
  fiscal_period_id: z.string().uuid().optional(),
  currency_code: z.string().length(3).default('JPY'),
  exchange_rate: z.number().positive().default(1),
  lines: z.array(journalEntryLineCreateSchema).min(2, '仕訳明細は貸借2行以上必要です'),
});
export type JournalEntryCreateInput = z.infer<typeof journalEntryCreateSchema>;

export const journalEntryUpdateSchema = z
  .object({
    entry_date: z.string().regex(DATE_ONLY_RE, 'entry_date is YYYY-MM-DD形式で指定してください').optional(),
    description: z.string().optional(),
    lines: z.array(journalEntryLineCreateSchema).min(2, '仕訳明細は貸借2行以上必要です').optional(),
  })
  .refine((v) => v.entry_date !== undefined || v.description !== undefined || v.lines !== undefined, {
    message: '更新する項目を1つ以上指定してください',
  });
export type JournalEntryUpdateInput = z.infer<typeof journalEntryUpdateSchema>;

export const journalEntryListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(JOURNAL_ENTRY_STATUSES).optional(),
  entry_date_from: z.string().regex(DATE_ONLY_RE).optional(),
  entry_date_to: z.string().regex(DATE_ONLY_RE).optional(),
  source_type: z.string().optional(),
  account_id: z.string().uuid().optional(),
});
export type JournalEntryListQuery = z.infer<typeof journalEntryListQuerySchema>;

export const journalEntryVoidSchema = z.object({
  reason: z.string().optional(),
});
export type JournalEntryVoidInput = z.infer<typeof journalEntryVoidSchema>;

export const journalEntryReverseSchema = z.object({
  reason: z.string().min(1, '反対仕訳の理由を入力してください'),
  entry_date: z.string().regex(DATE_ONLY_RE, 'entry_date is YYYY-MM-DD形式で指定してください').optional(),
});
export type JournalEntryReverseInput = z.infer<typeof journalEntryReverseSchema>;
