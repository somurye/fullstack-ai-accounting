import {
  Building2,
  CheckCircle2,
  Copy,
  Landmark,
  Plug,
  ShieldAlert,
  SlidersHorizontal,
  UserPlus,
  Users as UsersIcon,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTaxCategories } from '../journal-entries/hooks';
import { useAuthStore } from '../../stores/authStore';
import { Modal } from '../../components/ui/Modal';
import { toast } from '../../stores/toastStore';
import { ExternalAccessPage } from './ExternalAccessPage';
import {
  useAccountingSettings,
  useCancelInvitation,
  useCreateInvitation,
  useIntegrationSettings,
  useInvitations,
  useMembers,
  useRemoveMember,
  useTenantSettings,
  useTestAiIntegrationConnection,
  useUpdateAccountingSettings,
  useUpdateAiIntegrationSettings,
  useUpdateMemberRole,
  useUpdateTenantSettings,
} from './tenant/hooks';
import {
  AI_PROVIDER_LABEL,
  ROLE_LABEL,
  ROUNDING_RULE_LABEL,
  TAX_FILING_METHOD_LABEL,
  type AccountingSettingsUpdate,
  type AiProvider,
  type MemberInvitationCreated,
  type RoleCode,
  type TenantMember,
  type TenantSettingsUpdate,
} from './tenant/types';

type Tab = 'tenant' | 'accounting' | 'members' | 'external-access' | 'integrations';

const ROLE_OPTIONS: RoleCode[] = [
  'owner',
  'accounting_manager',
  'accountant',
  'approver',
  'employee',
  'payroll_admin',
  'viewer_external',
  'system_service',
];

const TAX_FILING_METHOD_OPTIONS: Array<keyof typeof TAX_FILING_METHOD_LABEL> = [
  'general',
  'simplified',
  'twenty_percent_special',
];

const ROUNDING_RULE_OPTIONS: Array<keyof typeof ROUNDING_RULE_LABEL> = ['floor', 'ceil', 'round'];

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('tenant');
  const currentUser = useAuthStore((state) => state.user);
  const canEditSettings = (currentUser?.roles ?? []).some((role) =>
    ['owner', 'accounting_manager'].includes(role),
  );
  const isOwner = (currentUser?.roles ?? []).includes('owner');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-surface-50">設定</h1>
        <p className="mt-1 text-sm text-surface-400">
          自社情報・会計処理設定・メンバー権限・外部アクセスを管理します。
        </p>
      </div>

      <div className="flex gap-2 border-b border-surface-800">
        {(
          [
            ['tenant', '自社・テナント情報', Building2],
            ['accounting', '会計設定', SlidersHorizontal],
            ['members', 'メンバー管理', UsersIcon],
            ['external-access', '外部・税理士アクセス', ShieldAlert],
            ['integrations', '外部API・連携設定', Plug],
          ] as [Tab, string, typeof Building2][]
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === value
                ? 'border-brand-400 text-brand-300'
                : 'border-transparent text-surface-400 hover:text-surface-200'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'tenant' && <TenantTab canEdit={canEditSettings} />}
      {tab === 'accounting' && <AccountingTab canEdit={canEditSettings} />}
      {tab === 'members' && <MembersTab canEdit={isOwner} currentUserId={currentUser?.id} />}
      {tab === 'external-access' && <ExternalAccessPage />}
      {tab === 'integrations' && <IntegrationsTab canEdit={canEditSettings} />}
    </div>
  );
}

function TenantTab({ canEdit }: { canEdit: boolean }) {
  const { data: tenant, isLoading } = useTenantSettings();
  const updateMutation = useUpdateTenantSettings();

  const [form, setForm] = useState<TenantSettingsUpdate>({});

  useEffect(() => {
    if (!tenant) return;
    setForm({
      name: tenant.name ?? '',
      legal_name: tenant.legal_name ?? '',
      representative_name: tenant.representative_name ?? '',
      address: tenant.address ?? '',
      fiscal_year_start_month: tenant.fiscal_year_start_month,
      invoice_registration_number: tenant.invoice_registration_number ?? '',
      consumption_tax_filing_method: tenant.consumption_tax_filing_method,
      base_currency_code: tenant.base_currency_code,
    });
  }, [tenant]);

  if (isLoading || !tenant) {
    return <p className="text-sm text-surface-400">読み込み中…</p>;
  }

  const invoiceNumberInvalid =
    Boolean(form.invoice_registration_number) &&
    !/^T\d{13}$/.test(form.invoice_registration_number as string);

  const handleSubmit = async (): Promise<void> => {
    await updateMutation.mutateAsync({
      ...form,
      invoice_registration_number: form.invoice_registration_number || undefined,
    });
  };

  return (
    <div className="card space-y-4 p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">会社名</label>
          <input
            type="text"
            disabled={!canEdit}
            value={form.name ?? ''}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">正式名称(法人名)</label>
          <input
            type="text"
            disabled={!canEdit}
            value={form.legal_name ?? ''}
            onChange={(e) => setForm((prev) => ({ ...prev, legal_name: e.target.value }))}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">代表者名</label>
          <input
            type="text"
            disabled={!canEdit}
            value={form.representative_name ?? ''}
            onChange={(e) => setForm((prev) => ({ ...prev, representative_name: e.target.value }))}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">所在地</label>
          <input
            type="text"
            disabled={!canEdit}
            value={form.address ?? ''}
            onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">会計年度開始月</label>
          <select
            disabled={!canEdit}
            value={form.fiscal_year_start_month ?? 4}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, fiscal_year_start_month: Number(e.target.value) }))
            }
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
              <option key={month} value={month}>
                {month}月
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">基準通貨</label>
          <input
            type="text"
            disabled={!canEdit}
            maxLength={3}
            value={form.base_currency_code ?? ''}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, base_currency_code: e.target.value.toUpperCase() }))
            }
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">
            インボイス登録番号(T+数字13桁)
          </label>
          <input
            type="text"
            disabled={!canEdit}
            placeholder="T1234567890123"
            value={form.invoice_registration_number ?? ''}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, invoice_registration_number: e.target.value }))
            }
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
          />
          {invoiceNumberInvalid && (
            <p className="mt-1 text-xs text-negative">「T」+数字13桁の形式で入力してください</p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">消費税申告方式</label>
          <select
            disabled={!canEdit}
            value={form.consumption_tax_filing_method ?? 'general'}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                consumption_tax_filing_method: e.target
                  .value as TenantSettingsUpdate['consumption_tax_filing_method'],
              }))
            }
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
          >
            {TAX_FILING_METHOD_OPTIONS.map((method) => (
              <option key={method} value={method}>
                {TAX_FILING_METHOD_LABEL[method]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {canEdit ? (
        <div className="flex justify-end">
          <button
            type="button"
            className="btn-primary"
            disabled={updateMutation.isPending || invoiceNumberInvalid}
            onClick={() => void handleSubmit()}
          >
            {updateMutation.isPending ? '保存中…' : '保存する'}
          </button>
        </div>
      ) : (
        <p className="text-xs text-surface-500">自社情報の変更は owner / accounting_manager ロールのみ実行できます。</p>
      )}
    </div>
  );
}

function AccountingTab({ canEdit }: { canEdit: boolean }) {
  const { data: settings, isLoading } = useAccountingSettings();
  const { data: taxCategories = [] } = useTaxCategories();
  const updateMutation = useUpdateAccountingSettings();

  const [form, setForm] = useState<AccountingSettingsUpdate>({});

  useEffect(() => {
    if (!settings) return;
    setForm({
      rounding_rule: settings.rounding_rule,
      default_tax_category_id: settings.default_tax_category_id ?? undefined,
    });
  }, [settings]);

  if (isLoading || !settings) {
    return <p className="text-sm text-surface-400">読み込み中…</p>;
  }

  const handleSubmit = async (): Promise<void> => {
    await updateMutation.mutateAsync({
      rounding_rule: form.rounding_rule,
      default_tax_category_id: form.default_tax_category_id || null,
    });
  };

  return (
    <div className="card space-y-4 p-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">端数処理ルール</label>
          <select
            disabled={!canEdit}
            value={form.rounding_rule ?? 'floor'}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                rounding_rule: e.target.value as AccountingSettingsUpdate['rounding_rule'],
              }))
            }
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
          >
            {ROUNDING_RULE_OPTIONS.map((rule) => (
              <option key={rule} value={rule}>
                {ROUNDING_RULE_LABEL[rule]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">デフォルト税区分</label>
          <select
            disabled={!canEdit}
            value={form.default_tax_category_id ?? ''}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, default_tax_category_id: e.target.value || null }))
            }
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
          >
            <option value="">未設定</option>
            {taxCategories.map((tax) => (
              <option key={tax.id} value={tax.id}>
                {tax.name}({tax.tax_rate}%)
              </option>
            ))}
          </select>
        </div>
      </div>

      {canEdit ? (
        <div className="flex justify-end">
          <button
            type="button"
            className="btn-primary"
            disabled={updateMutation.isPending}
            onClick={() => void handleSubmit()}
          >
            {updateMutation.isPending ? '保存中…' : '保存する'}
          </button>
        </div>
      ) : (
        <p className="text-xs text-surface-500">会計処理設定の変更は owner / accounting_manager ロールのみ実行できます。</p>
      )}
    </div>
  );
}

const invitationDateFormatter = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });

function MembersTab({ canEdit, currentUserId }: { canEdit: boolean; currentUserId?: string }) {
  const { data: members = [], isLoading } = useMembers();
  const { data: invitations = [], isLoading: isLoadingInvitations } = useInvitations();
  const updateRoleMutation = useUpdateMemberRole();
  const cancelInvitationMutation = useCancelInvitation();

  const [isInviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TenantMember | null>(null);

  const activeOwnerCount = members.filter(
    (m) => m.is_active && (m.roles ?? []).includes('owner'),
  ).length;

  return (
    <div className="space-y-6">
      {canEdit && (
        <div className="flex justify-end">
          <button type="button" className="btn-primary" onClick={() => setInviteOpen(true)}>
            <UserPlus className="h-4 w-4" />
            メンバーを招待
          </button>
        </div>
      )}

      {canEdit && (invitations.length > 0 || isLoadingInvitations) && (
        <div className="card overflow-x-auto">
          <p className="border-b border-surface-800 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-surface-500">
            招待中(承認待ち)
          </p>
          {isLoadingInvitations && <p className="px-4 py-3 text-sm text-surface-400">読み込み中…</p>}
          {!isLoadingInvitations && (
            <table className="w-full min-w-[600px] text-left text-sm">
              <tbody>
                {invitations.map((invitation) => (
                  <tr key={invitation.id} className="border-b border-surface-800/60 last:border-0">
                    <td className="px-4 py-3 text-surface-100">{invitation.email}</td>
                    <td className="px-4 py-3 text-surface-300">
                      {invitation.role ? ROLE_LABEL[invitation.role] : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-surface-400">
                      期限: {invitation.expires_at ? invitationDateFormatter.format(new Date(invitation.expires_at)) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className="btn-secondary !py-1 text-xs"
                        disabled={cancelInvitationMutation.isPending}
                        onClick={() => cancelInvitationMutation.mutate(invitation.id as string)}
                      >
                        招待を取消
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="card overflow-x-auto">
        {isLoading && <p className="p-4 text-sm text-surface-400">読み込み中…</p>}
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-4 py-3 font-medium">氏名</th>
              <th className="px-4 py-3 font-medium">メールアドレス</th>
              <th className="px-4 py-3 font-medium">部門</th>
              <th className="px-4 py-3 font-medium">状態</th>
              <th className="px-4 py-3 font-medium">ロール</th>
              {canEdit && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody>
            {members.length === 0 && !isLoading && (
              <tr>
                <td colSpan={canEdit ? 6 : 5} className="px-4 py-8 text-center text-surface-500">
                  所属メンバーがいません
                </td>
              </tr>
            )}
            {members.map((member) => {
              const isSelf = member.user_id === currentUserId;
              const isSoleOwner = (member.roles ?? []).includes('owner') && activeOwnerCount <= 1;
              const canRemove = canEdit && member.is_active && !isSelf && !isSoleOwner;
              return (
                <tr key={member.user_id} className="border-b border-surface-800/60">
                  <td className="px-4 py-3 text-surface-100">
                    {member.name}
                    {isSelf && <span className="ml-1.5 text-xs text-surface-500">(自分)</span>}
                  </td>
                  <td className="px-4 py-3 text-surface-300">{member.email ?? '—'}</td>
                  <td className="px-4 py-3 text-surface-300">{member.department ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={member.is_active ? 'badge-posted' : 'badge-draft'}>
                      {member.is_active ? '在籍中' : '離籍'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {canEdit && member.is_active ? (
                      <select
                        value={(member.roles ?? [])[0] ?? ''}
                        disabled={updateRoleMutation.isPending}
                        onChange={(e) =>
                          updateRoleMutation.mutate({
                            userId: member.user_id as string,
                            role: e.target.value as RoleCode,
                          })
                        }
                        className="rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                      >
                        <option value="" disabled>
                          未設定
                        </option>
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABEL[role]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-surface-300">
                        {(member.roles ?? []).map((role) => ROLE_LABEL[role]).join(', ') || '—'}
                      </span>
                    )}
                  </td>
                  {canEdit && (
                    <td className="px-4 py-3 text-right">
                      {canRemove && (
                        <button
                          type="button"
                          className="btn-secondary !py-1 text-xs !text-negative"
                          onClick={() => setRemoveTarget(member)}
                        >
                          削除/停止
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!canEdit && (
        <p className="text-xs text-surface-500">
          メンバーの招待・ロール変更・削除は owner (招待は owner/accounting_manager) ロールのみ実行できます。
        </p>
      )}

      {isInviteOpen && <InviteMemberModal onClose={() => setInviteOpen(false)} />}
      {removeTarget && (
        <ConfirmRemoveMemberModal member={removeTarget} onCancel={() => setRemoveTarget(null)} />
      )}
    </div>
  );
}

function InviteMemberModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<RoleCode>('employee');
  const [created, setCreated] = useState<MemberInvitationCreated | null>(null);
  const createMutation = useCreateInvitation();

  const handleSubmit = async (): Promise<void> => {
    const result = await createMutation.mutateAsync({ email, role });
    setCreated(result);
  };

  const handleCopy = async (): Promise<void> => {
    if (!created?.invite_url) return;
    await navigator.clipboard.writeText(created.invite_url);
    toast.success('招待リンクをコピーしました');
  };

  return (
    <Modal title="メンバーを招待" onClose={onClose}>
      {created ? (
        <div className="space-y-3">
          <p className="text-sm text-surface-300">
            <span className="text-surface-100">{created.email}</span> 宛の招待を発行しました。
            以下のリンクを本人に共有してください(このリンクは再表示されません)。
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={created.invite_url ?? ''}
              onFocus={(e) => e.target.select()}
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-xs text-surface-300 outline-none"
            />
            <button
              type="button"
              className="btn-secondary shrink-0 !py-2"
              onClick={() => void handleCopy()}
              aria-label="招待リンクをコピー"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
          <div className="flex justify-end">
            <button type="button" className="btn-primary" onClick={onClose}>
              閉じる
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">メールアドレス</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="taro@example.com"
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">ロール</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as RoleCode)}
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={createMutation.isPending}
            >
              キャンセル
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!email || createMutation.isPending}
              onClick={() => void handleSubmit()}
            >
              {createMutation.isPending ? '発行中…' : '招待を発行'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ConfirmRemoveMemberModal({
  member,
  onCancel,
}: {
  member: TenantMember;
  onCancel: () => void;
}) {
  const removeMutation = useRemoveMember();

  const handleConfirm = async (): Promise<void> => {
    await removeMutation.mutateAsync(member.user_id as string);
    onCancel();
  };

  return (
    <Modal title="メンバーのアクセス権を剥奪" onClose={onCancel}>
      <p className="text-sm text-surface-300">
        <span className="text-surface-100">{member.name}</span>
        {member.email ? `(${member.email})` : ''} のアクセス権を剥奪しますか？
        テナントへのアクセスが即時停止されます。
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          className="btn-secondary"
          onClick={onCancel}
          disabled={removeMutation.isPending}
        >
          キャンセル
        </button>
        <button
          type="button"
          className="btn-secondary !border-negative !text-negative"
          disabled={removeMutation.isPending}
          onClick={() => void handleConfirm()}
        >
          {removeMutation.isPending ? '処理中…' : 'アクセス権を剥奪する'}
        </button>
      </div>
    </Modal>
  );
}

const AI_PROVIDER_OPTIONS: AiProvider[] = ['gemini', 'openai', 'anthropic'];

function IntegrationsTab({ canEdit }: { canEdit: boolean }) {
  const { data: integrations, isLoading } = useIntegrationSettings();
  const updateAiMutation = useUpdateAiIntegrationSettings();
  const testMutation = useTestAiIntegrationConnection();

  const [provider, setProvider] = useState<AiProvider>('anthropic');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    if (!integrations) return;
    setProvider(integrations.ai?.provider ?? 'anthropic');
    setApiKeyInput('');
  }, [integrations]);

  if (isLoading || !integrations) {
    return <p className="text-sm text-surface-400">読み込み中…</p>;
  }

  const ai = integrations.ai;
  const bank = integrations.bank_connector;

  const handleSave = async (): Promise<void> => {
    await updateAiMutation.mutateAsync({
      provider,
      ...(apiKeyInput ? { api_key: apiKeyInput } : {}),
    });
    setApiKeyInput('');
  };

  return (
    <div className="space-y-6">
      <div className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-surface-100">AIサービス設定</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">プロバイダー</label>
            <select
              disabled={!canEdit}
              value={provider}
              onChange={(e) => setProvider(e.target.value as AiProvider)}
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
            >
              {AI_PROVIDER_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {AI_PROVIDER_LABEL[p]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">
              APIキー
              {ai?.has_api_key && (
                <span className="ml-1.5 font-mono text-surface-500">
                  (現在: {ai.api_key_masked})
                </span>
              )}
            </label>
            <div className="flex gap-2">
              <input
                type={showApiKey ? 'text' : 'password'}
                disabled={!canEdit}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={ai?.has_api_key ? '変更する場合のみ入力' : 'APIキーを入力'}
                className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
              />
              <button
                type="button"
                className="btn-secondary shrink-0 !py-2 text-xs"
                onClick={() => setShowApiKey((v) => !v)}
              >
                {showApiKey ? '隠す' : '表示'}
              </button>
            </div>
          </div>
        </div>

        {ai?.last_tested_at && (
          <div className="flex items-center gap-2 text-xs">
            {ai.last_test_result === 'success' ? (
              <span className="flex items-center gap-1 text-positive">
                <CheckCircle2 className="h-4 w-4" />
                前回の接続テスト: 成功
              </span>
            ) : (
              <span className="flex items-center gap-1 text-negative">
                <XCircle className="h-4 w-4" />
                前回の接続テスト: 失敗
              </span>
            )}
            <span className="text-surface-500">
              ({new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(
                new Date(ai.last_tested_at),
              )})
            </span>
          </div>
        )}

        {canEdit ? (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={!ai?.has_api_key || testMutation.isPending}
              onClick={() => testMutation.mutate()}
            >
              {testMutation.isPending ? 'テスト中…' : '接続テスト'}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={updateAiMutation.isPending}
              onClick={() => void handleSave()}
            >
              {updateAiMutation.isPending ? '保存中…' : '保存する'}
            </button>
          </div>
        ) : (
          <p className="text-xs text-surface-500">
            AI連携設定の変更は owner / accounting_manager ロールのみ実行できます。
          </p>
        )}
      </div>

      <div className="card space-y-4 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-surface-100">
          <Landmark className="h-4 w-4" />
          銀行・外部決済コネクタ
        </h2>
        <div className="flex items-center justify-between rounded-lg border border-surface-800 bg-surface-850/60 px-4 py-3">
          <div>
            <p className="text-sm text-surface-100">銀行API / 外部決済連携</p>
            <span className={bank?.status === 'connected' ? 'badge-posted mt-1 inline-flex' : 'badge-draft mt-1 inline-flex'}>
              {bank?.status === 'connected' ? '接続済み' : '未連携'}
            </span>
          </div>
          <button type="button" className="btn-secondary" disabled title="対応する銀行/決済プロバイダのOAuth連携は今後の実装予定です">
            認証連携する
          </button>
        </div>
        <p className="text-xs text-surface-500">
          現時点では特定の銀行/決済プロバイダとのOAuth連携先が未実装のため、ステータス表示のみのプレースホルダーです。銀行口座情報自体は「銀行口座」画面から手動で登録できます。
        </p>
      </div>
    </div>
  );
}
