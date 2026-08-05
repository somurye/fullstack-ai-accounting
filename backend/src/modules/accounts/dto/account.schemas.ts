import { z } from 'zod';

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
const DEBIT_CREDIT = ['debit', 'credit'] as const;

export const accountCreateSchema = z.object({
  code: z.string().min(1, 'codeは必須です'),
  name: z.string().min(1, 'nameは必須です'),
  category_id: z.string().uuid().optional(),
  account_type: z.enum(ACCOUNT_TYPES),
  normal_balance: z.enum(DEBIT_CREDIT),
  parent_account_id: z.string().uuid().optional(),
  default_tax_category_code: z.string().optional(),
  allow_manual_entry: z.boolean().default(true),
});
export type AccountCreateInput = z.infer<typeof accountCreateSchema>;

export const accountUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  category_id: z.string().uuid().optional(),
  allow_manual_entry: z.boolean().optional(),
  is_active: z.boolean().optional(),
});
export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;
