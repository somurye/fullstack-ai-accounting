import { z } from 'zod';

/**
 * settings モジュールのリクエストバリデーションスキーマ。
 * `docs/openapi.yaml` の `TenantSettingsUpdate` / `AccountingSettingsUpdate` /
 * `MemberRoleUpdate` に対応する。
 */

export const ROLE_CODES = [
  'owner',
  'accounting_manager',
  'accountant',
  'bookkeeper',
  'approver',
  'employee',
  'payroll_admin',
  'viewer_external',
  'system_service',
] as const;

export const ROUNDING_RULES = ['floor', 'ceil', 'round'] as const;

export const AI_PROVIDERS = ['gemini', 'openai', 'anthropic'] as const;

export const TAX_FILING_METHODS = ['general', 'simplified', 'twenty_percent_special'] as const;

// インボイス登録番号: "T" + 数字13桁 (適格請求書発行事業者登録番号の形式)
const INVOICE_REGISTRATION_NUMBER_RE = /^T\d{13}$/;

export const tenantSettingsUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    legal_name: z.string().optional(),
    representative_name: z.string().optional(),
    address: z.string().optional(),
    fiscal_year_start_month: z.number().int().min(1).max(12).optional(),
    invoice_registration_number: z
      .string()
      .regex(INVOICE_REGISTRATION_NUMBER_RE, 'invoice_registration_numberは"T"+数字13桁の形式で指定してください')
      .nullable()
      .optional(),
    consumption_tax_filing_method: z.enum(TAX_FILING_METHODS).optional(),
    base_currency_code: z.string().length(3).optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: '更新する項目を1つ以上指定してください',
  });
export type TenantSettingsUpdateInput = z.infer<typeof tenantSettingsUpdateSchema>;

export const accountingSettingsUpdateSchema = z
  .object({
    rounding_rule: z.enum(ROUNDING_RULES).optional(),
    default_tax_category_id: z.string().uuid().nullable().optional(),
  })
  .refine((v) => v.rounding_rule !== undefined || v.default_tax_category_id !== undefined, {
    message: '更新する項目を1つ以上指定してください',
  });
export type AccountingSettingsUpdateInput = z.infer<typeof accountingSettingsUpdateSchema>;

export const memberRoleUpdateSchema = z.object({
  role: z.enum(ROLE_CODES),
});
export type MemberRoleUpdateInput = z.infer<typeof memberRoleUpdateSchema>;

export const aiSettingsUpdateSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  api_key: z.string().min(1, 'api_keyは1文字以上で指定してください').optional(),
});
export type AiSettingsUpdateInput = z.infer<typeof aiSettingsUpdateSchema>;

export const memberInvitationCreateSchema = z.object({
  email: z.string().email('emailの形式が不正です'),
  role: z.enum(ROLE_CODES),
});
export type MemberInvitationCreateInput = z.infer<typeof memberInvitationCreateSchema>;
