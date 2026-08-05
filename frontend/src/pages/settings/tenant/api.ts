import { apiClient } from '../../../lib/apiClient';
import type { components } from '../../../types/api.generated';
import type {
  AccountingSettings,
  AccountingSettingsUpdate,
  AiConnectionTestResult,
  AiIntegrationSettings,
  AiSettingsUpdate,
  IntegrationSettings,
  MemberInvitation,
  MemberInvitationCreateParams,
  MemberInvitationCreated,
  RoleCode,
  TenantMember,
  TenantSettings,
  TenantSettingsUpdate,
} from './types';

type Meta = components['schemas']['Meta'];

export async function fetchTenantSettings(): Promise<TenantSettings> {
  const { data } = await apiClient.get<{ success: true; data: TenantSettings; meta?: Meta }>(
    '/settings/tenant',
  );
  if (!data.data) throw new Error('自社情報を取得できませんでした');
  return data.data;
}

export async function updateTenantSettings(payload: TenantSettingsUpdate): Promise<TenantSettings> {
  const { data } = await apiClient.patch<{ success: true; data: TenantSettings; meta?: Meta }>(
    '/settings/tenant',
    payload,
  );
  if (!data.data) throw new Error('自社情報の更新に失敗しました');
  return data.data;
}

export async function fetchAccountingSettings(): Promise<AccountingSettings> {
  const { data } = await apiClient.get<{ success: true; data: AccountingSettings; meta?: Meta }>(
    '/settings/accounting',
  );
  if (!data.data) throw new Error('会計処理設定を取得できませんでした');
  return data.data;
}

export async function updateAccountingSettings(
  payload: AccountingSettingsUpdate,
): Promise<AccountingSettings> {
  const { data } = await apiClient.patch<{ success: true; data: AccountingSettings; meta?: Meta }>(
    '/settings/accounting',
    payload,
  );
  if (!data.data) throw new Error('会計処理設定の更新に失敗しました');
  return data.data;
}

export async function fetchMembers(): Promise<TenantMember[]> {
  const { data } = await apiClient.get<{ success: true; data: TenantMember[]; meta?: Meta }>(
    '/settings/members',
  );
  return data.data ?? [];
}

export async function updateMemberRole(userId: string, role: RoleCode): Promise<TenantMember> {
  const { data } = await apiClient.patch<{ success: true; data: TenantMember; meta?: Meta }>(
    `/settings/members/${userId}/role`,
    { role },
  );
  if (!data.data) throw new Error('ロールの変更に失敗しました');
  return data.data;
}

export async function removeMember(userId: string): Promise<TenantMember> {
  const { data } = await apiClient.delete<{ success: true; data: TenantMember; meta?: Meta }>(
    `/settings/members/${userId}`,
  );
  if (!data.data) throw new Error('メンバーの削除に失敗しました');
  return data.data;
}

export async function fetchInvitations(): Promise<MemberInvitation[]> {
  const { data } = await apiClient.get<{ success: true; data: MemberInvitation[]; meta?: Meta }>(
    '/settings/members/invitations',
  );
  return data.data ?? [];
}

export async function createInvitation(
  payload: MemberInvitationCreateParams,
): Promise<MemberInvitationCreated> {
  const { data } = await apiClient.post<{ success: true; data: MemberInvitationCreated; meta?: Meta }>(
    '/settings/members/invitations',
    payload,
  );
  if (!data.data) throw new Error('招待の発行に失敗しました');
  return data.data;
}

export async function cancelInvitation(invitationId: string): Promise<MemberInvitation> {
  const { data } = await apiClient.delete<{ success: true; data: MemberInvitation; meta?: Meta }>(
    `/settings/members/invitations/${invitationId}`,
  );
  if (!data.data) throw new Error('招待の取消に失敗しました');
  return data.data;
}

export async function fetchIntegrationSettings(): Promise<IntegrationSettings> {
  const { data } = await apiClient.get<{ success: true; data: IntegrationSettings; meta?: Meta }>(
    '/settings/integrations',
  );
  if (!data.data) throw new Error('外部連携設定を取得できませんでした');
  return data.data;
}

export async function updateAiIntegrationSettings(
  payload: AiSettingsUpdate,
): Promise<AiIntegrationSettings> {
  const { data } = await apiClient.patch<{
    success: true;
    data: AiIntegrationSettings;
    meta?: Meta;
  }>('/settings/integrations/ai', payload);
  if (!data.data) throw new Error('AI連携設定の更新に失敗しました');
  return data.data;
}

export async function testAiIntegrationConnection(): Promise<AiConnectionTestResult> {
  const { data } = await apiClient.post<{
    success: true;
    data: AiConnectionTestResult;
    meta?: Meta;
  }>('/settings/integrations/ai/test');
  if (!data.data) throw new Error('接続テストに失敗しました');
  return data.data;
}
