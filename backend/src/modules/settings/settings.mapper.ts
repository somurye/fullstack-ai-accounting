import { maskSecret } from '../../common/security/secret-encryption';
import type { components } from '../../types/api.generated';

export type TenantDto = components['schemas']['Tenant'];
export type AccountingSettingsDto = components['schemas']['AccountingSettings'];
export type TenantMemberDto = components['schemas']['TenantMember'];
export type MemberInvitationDto = components['schemas']['MemberInvitation'];
export type MemberInvitationCreatedDto = components['schemas']['MemberInvitationCreated'];
export type AiIntegrationSettingsDto = components['schemas']['AiIntegrationSettings'];
export type BankConnectorStatusDto = components['schemas']['BankConnectorStatus'];
export type IntegrationSettingsDto = components['schemas']['IntegrationSettings'];

export interface TenantRow {
  id: string;
  name: string;
  legal_name: string | null;
  representative_name: string | null;
  address: string | null;
  fiscal_year_start_month: number;
  invoice_registration_number: string | null;
  consumption_tax_filing_method: string;
  base_currency_code: string;
  is_active: boolean;
}

export interface AccountingSettingsRow {
  rounding_rule: string;
  default_tax_category_id: string | null;
}

export interface TenantMemberRow {
  user_id: string;
  email: string | null;
  name: string;
  employee_code: string | null;
  department: string | null;
  is_active: boolean;
  roles: string[] | null;
}

export interface MemberInvitationRow {
  id: string;
  email: string;
  role_code: string;
  expires_at: string;
  created_at: string;
}

export interface IntegrationSettingsRow {
  ai_provider: string | null;
  ai_api_key_last4: string | null;
  ai_last_tested_at: string | null;
  ai_last_test_result: string | null;
  bank_connector_status: string;
}

export const TENANT_COLUMNS = `
  id,
  name,
  legal_name,
  representative_name,
  address,
  fiscal_year_start_month,
  invoice_registration_number,
  consumption_tax_filing_method,
  base_currency_code,
  is_active
`;

export function mapTenantRow(row: TenantRow): TenantDto {
  return {
    id: row.id,
    name: row.name,
    legal_name: row.legal_name ?? undefined,
    representative_name: row.representative_name,
    address: row.address,
    fiscal_year_start_month: row.fiscal_year_start_month,
    invoice_registration_number: row.invoice_registration_number,
    consumption_tax_filing_method:
      row.consumption_tax_filing_method as TenantDto['consumption_tax_filing_method'],
    base_currency_code: row.base_currency_code,
    is_active: row.is_active,
  };
}

export function mapAccountingSettingsRow(row: AccountingSettingsRow): AccountingSettingsDto {
  return {
    rounding_rule: row.rounding_rule as AccountingSettingsDto['rounding_rule'],
    default_tax_category_id: row.default_tax_category_id,
  };
}

export function mapTenantMemberRow(row: TenantMemberRow): TenantMemberDto {
  return {
    user_id: row.user_id,
    email: row.email,
    name: row.name,
    employee_code: row.employee_code,
    department: row.department,
    is_active: row.is_active,
    roles: (row.roles ?? []) as TenantMemberDto['roles'],
  };
}

export function mapMemberInvitationRow(row: MemberInvitationRow): MemberInvitationDto {
  return {
    id: row.id,
    email: row.email,
    role: row.role_code as MemberInvitationDto['role'],
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

export function mapAiIntegrationSettingsRow(row: IntegrationSettingsRow): AiIntegrationSettingsDto {
  return {
    provider: (row.ai_provider as AiIntegrationSettingsDto['provider']) ?? null,
    api_key_masked: row.ai_api_key_last4 ? maskSecret(row.ai_api_key_last4) : null,
    has_api_key: row.ai_api_key_last4 !== null,
    last_tested_at: row.ai_last_tested_at,
    last_test_result: (row.ai_last_test_result as AiIntegrationSettingsDto['last_test_result']) ?? null,
  };
}

export function mapIntegrationSettingsRow(row: IntegrationSettingsRow): IntegrationSettingsDto {
  const bankConnector: BankConnectorStatusDto = {
    status: row.bank_connector_status as BankConnectorStatusDto['status'],
  };
  return { ai: mapAiIntegrationSettingsRow(row), bank_connector: bankConnector };
}
