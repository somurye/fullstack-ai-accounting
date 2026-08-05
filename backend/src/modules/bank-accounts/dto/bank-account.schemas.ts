import { z } from 'zod';

/**
 * `docs/openapi.yaml` では `POST /bank-accounts` と `PATCH /bank-accounts/{id}` の
 * 両方が同じ `BankAccountCreate` スキーマを参照している(全項目指定の置換として定義)。
 */
export const bankAccountCreateSchema = z.object({
  bank_name: z.string().min(1, 'bank_nameは必須です'),
  bank_code: z.string().optional(),
  branch_name: z.string().optional(),
  branch_code: z.string().optional(),
  account_type: z.enum(['ordinary', 'checking']),
  account_number: z.string().min(1, 'account_numberは必須です'),
  account_holder_kana: z.string().optional(),
  currency_code: z.string().length(3).default('JPY'),
  opening_balance: z.number().default(0),
  linked_account_id: z.string().uuid().optional(),
});
export type BankAccountCreateInput = z.infer<typeof bankAccountCreateSchema>;

export const bankAccountListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(200),
});
export type BankAccountListQuery = z.infer<typeof bankAccountListQuerySchema>;
