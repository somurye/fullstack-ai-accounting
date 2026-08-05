import { apiClient } from '../../lib/apiClient';
import type { AuthUser } from '../../stores/authStore';
import type { AuthSessionResult, InvitationValidationResult, LoginResult, MfaVerifyResult } from './types';

export async function login(email: string, password: string): Promise<LoginResult> {
  const { data } = await apiClient.post<{ success: true; data: LoginResult }>('/auth/login', {
    email,
    password,
  });
  if (!data.data) throw new Error('ログインレスポンスが不正です');
  return data.data;
}

export async function verifyMfa(mfaToken: string, code: string): Promise<MfaVerifyResult> {
  const { data } = await apiClient.post<{ success: true; data: MfaVerifyResult }>('/auth/mfa', {
    mfa_token: mfaToken,
    code,
  });
  if (!data.data) throw new Error('MFA検証レスポンスが不正です');
  return data.data;
}

export async function logout(): Promise<void> {
  await apiClient.post('/auth/logout');
}

export async function fetchCurrentUser(): Promise<AuthUser> {
  const { data } = await apiClient.get<{ success: true; data: AuthUser }>('/users/me');
  if (!data.data) throw new Error('ユーザー情報の取得に失敗しました');
  return data.data;
}

export interface SignupParams {
  email: string;
  password: string;
  name: string;
  tenant_name: string;
}

export async function signup(params: SignupParams): Promise<AuthSessionResult> {
  const { data } = await apiClient.post<{ success: true; data: AuthSessionResult }>('/auth/signup', params);
  if (!data.data) throw new Error('サインアップレスポンスが不正です');
  return data.data;
}

export async function validateInvitation(token: string): Promise<InvitationValidationResult> {
  const { data } = await apiClient.get<{ success: true; data: InvitationValidationResult }>(
    '/auth/invitations/validate',
    { params: { token } },
  );
  if (!data.data) throw new Error('招待情報の取得に失敗しました');
  return data.data;
}

export interface AcceptInviteParams {
  token: string;
  password: string;
  name: string;
}

export async function acceptInvite(params: AcceptInviteParams): Promise<AuthSessionResult> {
  const { data } = await apiClient.post<{ success: true; data: AuthSessionResult }>('/auth/accept-invite', params);
  if (!data.data) throw new Error('招待受諾レスポンスが不正です');
  return data.data;
}
