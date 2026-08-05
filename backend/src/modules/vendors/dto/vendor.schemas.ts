import { z } from 'zod';

const bankAccountInfoSchema = z.object({
  bank_name: z.string().optional(),
  bank_code: z.string().optional(),
  branch_name: z.string().optional(),
  branch_code: z.string().optional(),
  account_type: z.enum(['ordinary', 'checking']).optional(),
  account_number: z.string().optional(),
  account_holder_kana: z.string().optional(),
});

/**
 * `docs/openapi.yaml` では `POST /vendors` と `PATCH /vendors/{id}` の両方が
 * 同じ `VendorCreate` スキーマを参照している(全項目指定の置換として定義)。
 */
export const vendorCreateSchema = z.object({
  code: z.string().min(1, 'codeは必須です'),
  name: z.string().min(1, 'nameは必須です'),
  kana_name: z.string().optional(),
  invoice_registration_number: z.string().optional(),
  bank_account_info: bankAccountInfoSchema.optional(),
});
export type VendorCreateInput = z.infer<typeof vendorCreateSchema>;
