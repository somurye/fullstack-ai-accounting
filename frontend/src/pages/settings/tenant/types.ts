import type { components } from '../../../types/api.generated';

export type TenantSettings = components['schemas']['Tenant'];
export type TenantSettingsUpdate = components['schemas']['TenantSettingsUpdate'];
export type AccountingSettings = components['schemas']['AccountingSettings'];
export type AccountingSettingsUpdate = components['schemas']['AccountingSettingsUpdate'];
export type TenantMember = components['schemas']['TenantMember'];
export type RoleCode = NonNullable<TenantMember['roles']>[number];
export type MemberInvitation = components['schemas']['MemberInvitation'];
export type MemberInvitationCreated = components['schemas']['MemberInvitationCreated'];
export type MemberInvitationCreateParams = components['schemas']['MemberInvitationCreate'];
export type IntegrationSettings = components['schemas']['IntegrationSettings'];
export type AiIntegrationSettings = components['schemas']['AiIntegrationSettings'];
export type AiSettingsUpdate = components['schemas']['AiSettingsUpdate'];
export type AiConnectionTestResult = components['schemas']['AiConnectionTestResult'];
export type AiProvider = NonNullable<AiIntegrationSettings['provider']>;

export const AI_PROVIDER_LABEL: Record<AiProvider, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

export const TAX_FILING_METHOD_LABEL: Record<
  NonNullable<TenantSettings['consumption_tax_filing_method']>,
  string
> = {
  general: '本則課税',
  simplified: '簡易課税',
  twenty_percent_special: '2割特例',
};

export const ROUNDING_RULE_LABEL: Record<NonNullable<AccountingSettings['rounding_rule']>, string> = {
  floor: '切り捨て',
  ceil: '切り上げ',
  round: '四捨五入',
};

export const ROLE_LABEL: Record<RoleCode, string> = {
  owner: 'オーナー(管理者)',
  accounting_manager: '経理責任者',
  accountant: '経理担当',
  approver: '承認者',
  employee: '一般社員',
  payroll_admin: '給与担当',
  viewer_external: '外部閲覧者(税理士等)',
  system_service: 'システム連携',
};
