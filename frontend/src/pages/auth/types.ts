import type { AuthTenantSummary } from '../../stores/authStore';

export interface LoginResult {
  access_token?: string;
  refresh_token?: string;
  mfa_required: boolean;
  mfa_token?: string;
  tenants: AuthTenantSummary[];
}

export interface MfaVerifyResult {
  access_token: string;
  refresh_token: string;
}

/** `POST /auth/signup` / `POST /auth/accept-invite` の共通レスポンス形状 */
export interface AuthSessionResult {
  access_token: string;
  refresh_token: string;
  tenants: AuthTenantSummary[];
}

export interface InvitationValidationResult {
  tenant_name: string;
  email: string;
  role: string;
}
