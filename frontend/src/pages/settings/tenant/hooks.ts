import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../../lib/apiClient';
import { toast } from '../../../stores/toastStore';
import {
  cancelInvitation,
  connectBankConnector,
  createInvitation,
  disconnectBankConnector,
  fetchAccountingSettings,
  fetchBankConnectionStatus,
  fetchIntegrationSettings,
  fetchInvitations,
  fetchMembers,
  fetchTenantSettings,
  removeMember,
  testAiIntegrationConnection,
  updateAccountingSettings,
  updateAiIntegrationSettings,
  updateMemberRole,
  updateTenantSettings,
} from './api';
import type {
  AccountingSettingsUpdate,
  AiSettingsUpdate,
  MemberInvitationCreateParams,
  RoleCode,
  TenantSettingsUpdate,
} from './types';

const TENANT_SETTINGS_KEY = 'settings-tenant';
const ACCOUNTING_SETTINGS_KEY = 'settings-accounting';
const MEMBERS_KEY = 'settings-members';
const INVITATIONS_KEY = 'settings-member-invitations';
const INTEGRATION_SETTINGS_KEY = 'settings-integrations';
const BANK_CONNECTION_STATUS_KEY = 'bank-connection-status';

export function useTenantSettings() {
  return useQuery({ queryKey: [TENANT_SETTINGS_KEY], queryFn: fetchTenantSettings });
}

export function useUpdateTenantSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: TenantSettingsUpdate) => updateTenantSettings(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [TENANT_SETTINGS_KEY] });
      toast.success('自社情報を更新しました');
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useAccountingSettings() {
  return useQuery({ queryKey: [ACCOUNTING_SETTINGS_KEY], queryFn: fetchAccountingSettings });
}

export function useUpdateAccountingSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AccountingSettingsUpdate) => updateAccountingSettings(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ACCOUNTING_SETTINGS_KEY] });
      toast.success('会計処理設定を更新しました');
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useMembers() {
  return useQuery({ queryKey: [MEMBERS_KEY], queryFn: fetchMembers });
}

export function useUpdateMemberRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: RoleCode }) => updateMemberRole(userId, role),
    onSuccess: (member) => {
      queryClient.invalidateQueries({ queryKey: [MEMBERS_KEY] });
      toast.success(`${member.name}のロールを変更しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => removeMember(userId),
    onSuccess: (member) => {
      queryClient.invalidateQueries({ queryKey: [MEMBERS_KEY] });
      toast.success(`${member.name}のアクセスを停止しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useInvitations() {
  return useQuery({ queryKey: [INVITATIONS_KEY], queryFn: fetchInvitations });
}

export function useCreateInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: MemberInvitationCreateParams) => createInvitation(payload),
    onSuccess: (invitation) => {
      queryClient.invalidateQueries({ queryKey: [INVITATIONS_KEY] });
      toast.success(`${invitation.email}宛の招待を発行しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useCancelInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) => cancelInvitation(invitationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [INVITATIONS_KEY] });
      toast.success('招待を取り消しました');
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useIntegrationSettings() {
  return useQuery({ queryKey: [INTEGRATION_SETTINGS_KEY], queryFn: fetchIntegrationSettings });
}

export function useUpdateAiIntegrationSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AiSettingsUpdate) => updateAiIntegrationSettings(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [INTEGRATION_SETTINGS_KEY] });
      toast.success('AI連携設定を更新しました');
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useTestAiIntegrationConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => testAiIntegrationConnection(),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [INTEGRATION_SETTINGS_KEY] });
      if (result.success) {
        toast.success(result.message ?? '接続テストに成功しました');
      } else {
        toast.error(result.message ?? '接続テストに失敗しました');
      }
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useBankConnectionStatus() {
  return useQuery({ queryKey: [BANK_CONNECTION_STATUS_KEY], queryFn: fetchBankConnectionStatus });
}

export function useConnectBankConnector() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => connectBankConnector(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [BANK_CONNECTION_STATUS_KEY] });
      toast.success('銀行APIとの認証連携が完了しました');
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useDisconnectBankConnector() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => disconnectBankConnector(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [BANK_CONNECTION_STATUS_KEY] });
      toast.info('銀行API連携を解除しました');
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}
