import { BookOpen, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { useAccounts, useCreateAccount, useUpdateAccount } from './accounts/hooks';
import type { Account, AccountCreateFormInput, AccountUpdateFormInput } from './accounts/types';

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  asset: '資産',
  liability: '負債',
  equity: '純資産',
  revenue: '収益',
  expense: '費用',
};

const EMPTY_CREATE_FORM: AccountCreateFormInput = {
  code: '',
  name: '',
  account_type: 'asset',
  normal_balance: 'debit',
  category_id: '',
  parent_account_id: '',
  default_tax_category_code: '',
  allow_manual_entry: true,
};

function CreateAccountForm({
  submitting,
  onSubmit,
  onCancel,
}: {
  submitting: boolean;
  onSubmit: (dto: AccountCreateFormInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<AccountCreateFormInput>(EMPTY_CREATE_FORM);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          ...form,
          category_id: form.category_id || undefined,
          parent_account_id: form.parent_account_id || undefined,
          default_tax_category_code: form.default_tax_category_code || undefined,
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">科目コード</label>
          <input
            type="text"
            required
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">既定税区分コード(任意)</label>
          <input
            type="text"
            value={form.default_tax_category_code ?? ''}
            onChange={(e) => setForm({ ...form, default_tax_category_code: e.target.value })}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-surface-400">科目名</label>
        <input
          type="text"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">科目区分</label>
          <select
            value={form.account_type}
            onChange={(e) => setForm({ ...form, account_type: e.target.value as AccountCreateFormInput['account_type'] })}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          >
            {Object.entries(ACCOUNT_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">貸借区分</label>
          <select
            value={form.normal_balance}
            onChange={(e) => setForm({ ...form, normal_balance: e.target.value as AccountCreateFormInput['normal_balance'] })}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="debit">借方</option>
            <option value="credit">貸方</option>
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-surface-300">
        <input
          type="checkbox"
          checked={form.allow_manual_entry}
          onChange={(e) => setForm({ ...form, allow_manual_entry: e.target.checked })}
          className="h-4 w-4 rounded border-surface-700 bg-surface-850"
        />
        仕訳での手動選択を許可する
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          キャンセル
        </button>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? '保存中…' : '保存する'}
        </button>
      </div>
    </form>
  );
}

function EditAccountForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
}: {
  initial: AccountUpdateFormInput;
  submitting: boolean;
  onSubmit: (dto: AccountUpdateFormInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<AccountUpdateFormInput>(initial);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...form, category_id: form.category_id || undefined });
      }}
    >
      <div>
        <label className="mb-1 block text-xs font-medium text-surface-400">科目名</label>
        <input
          type="text"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-surface-300">
        <input
          type="checkbox"
          checked={form.allow_manual_entry}
          onChange={(e) => setForm({ ...form, allow_manual_entry: e.target.checked })}
          className="h-4 w-4 rounded border-surface-700 bg-surface-850"
        />
        仕訳での手動選択を許可する
      </label>
      <label className="flex items-center gap-2 text-sm text-surface-300">
        <input
          type="checkbox"
          checked={form.is_active}
          onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          className="h-4 w-4 rounded border-surface-700 bg-surface-850"
        />
        有効
      </label>
      <p className="text-xs text-surface-500">
        科目区分・貸借区分・科目コードは確定仕訳との整合性のため作成後は変更できません。
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          キャンセル
        </button>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? '保存中…' : '保存する'}
        </button>
      </div>
    </form>
  );
}

export function AccountsSettingsPage() {
  const { data, isLoading } = useAccounts({ page_size: 200 });
  const createMutation = useCreateAccount();
  const updateMutation = useUpdateAccount();

  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);

  const accounts = data?.accounts ?? [];

  const closeModal = (): void => {
    setModalMode(null);
    setEditingAccount(null);
  };

  const handleCreate = async (dto: AccountCreateFormInput): Promise<void> => {
    await createMutation.mutateAsync(dto);
    closeModal();
  };

  const handleUpdate = async (dto: AccountUpdateFormInput): Promise<void> => {
    if (!editingAccount?.id) return;
    await updateMutation.mutateAsync({ id: editingAccount.id, dto });
    closeModal();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-surface-50">
            <BookOpen className="h-5 w-5 text-brand-400" />
            勘定科目マスタ
          </h1>
          <p className="mt-1 text-sm text-surface-400">仕訳入力で使用する勘定科目を管理します。</p>
        </div>
        <button type="button" className="btn-primary flex items-center gap-1.5" onClick={() => setModalMode('create')}>
          <Plus className="h-4 w-4" />
          新規科目
        </button>
      </div>

      {isLoading && <p className="text-sm text-surface-400">読み込み中…</p>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-4 py-3 font-medium">コード</th>
              <th className="px-4 py-3 font-medium">科目名</th>
              <th className="px-4 py-3 font-medium">区分</th>
              <th className="px-4 py-3 font-medium">貸借</th>
              <th className="px-4 py-3 font-medium">状態</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-surface-500">
                  勘定科目が登録されていません
                </td>
              </tr>
            )}
            {accounts.map((account) => (
              <tr key={account.id} className="border-b border-surface-800/60">
                <td className="px-4 py-3 font-mono text-xs text-surface-300">{account.code}</td>
                <td className="px-4 py-3 text-surface-100">{account.name}</td>
                <td className="px-4 py-3 text-surface-400">
                  {account.account_type ? ACCOUNT_TYPE_LABEL[account.account_type] : '—'}
                </td>
                <td className="px-4 py-3 text-surface-400">
                  {account.normal_balance === 'debit' ? '借方' : '貸方'}
                </td>
                <td className="px-4 py-3">
                  <span className={account.is_active ? 'badge-posted' : 'badge-draft'}>
                    {account.is_active ? '有効' : '無効'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    className="btn-secondary flex items-center gap-1 !py-1 text-xs"
                    onClick={() => {
                      setEditingAccount(account);
                      setModalMode('edit');
                    }}
                  >
                    <Pencil className="h-3 w-3" />
                    編集
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalMode === 'create' && (
        <Modal title="勘定科目を新規作成" onClose={closeModal}>
          <CreateAccountForm
            submitting={createMutation.isPending}
            onSubmit={(dto) => void handleCreate(dto)}
            onCancel={closeModal}
          />
        </Modal>
      )}

      {modalMode === 'edit' && editingAccount && (
        <Modal title="勘定科目を編集" onClose={closeModal}>
          <EditAccountForm
            initial={{
              name: editingAccount.name ?? '',
              category_id: editingAccount.category_id ?? undefined,
              allow_manual_entry: editingAccount.allow_manual_entry ?? true,
              is_active: editingAccount.is_active ?? true,
            }}
            submitting={updateMutation.isPending}
            onSubmit={(dto) => void handleUpdate(dto)}
            onCancel={closeModal}
          />
        </Modal>
      )}
    </div>
  );
}
