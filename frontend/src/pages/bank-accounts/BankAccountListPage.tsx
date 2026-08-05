import { Landmark, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { useAccounts } from '../settings/accounts/hooks';
import { useBankAccounts, useCreateBankAccount, useUpdateBankAccount } from './hooks';
import type { BankAccount, BankAccountFormInput } from './types';

const EMPTY_FORM: BankAccountFormInput = {
  bank_name: '',
  bank_code: '',
  branch_name: '',
  branch_code: '',
  account_type: 'ordinary',
  account_number: '',
  account_holder_kana: '',
  currency_code: 'JPY',
  opening_balance: 0,
  linked_account_id: '',
};

function BankAccountForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
}: {
  initial: BankAccountFormInput;
  submitting: boolean;
  onSubmit: (dto: BankAccountFormInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<BankAccountFormInput>(initial);
  const { data: accountsData } = useAccounts({ page_size: 200 });
  const cashAccounts = (accountsData?.accounts ?? []).filter((a) => a.account_type === 'asset');

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          ...form,
          bank_code: form.bank_code || undefined,
          branch_name: form.branch_name || undefined,
          branch_code: form.branch_code || undefined,
          account_holder_kana: form.account_holder_kana || undefined,
          linked_account_id: form.linked_account_id || undefined,
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">銀行名</label>
          <input
            type="text"
            required
            value={form.bank_name}
            onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">銀行コード</label>
          <input
            type="text"
            value={form.bank_code ?? ''}
            onChange={(e) => setForm({ ...form, bank_code: e.target.value })}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">支店名</label>
          <input
            type="text"
            value={form.branch_name ?? ''}
            onChange={(e) => setForm({ ...form, branch_name: e.target.value })}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">支店コード</label>
          <input
            type="text"
            value={form.branch_code ?? ''}
            onChange={(e) => setForm({ ...form, branch_code: e.target.value })}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">口座種別</label>
          <select
            value={form.account_type}
            onChange={(e) => setForm({ ...form, account_type: e.target.value as BankAccountFormInput['account_type'] })}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="ordinary">普通</option>
            <option value="checking">当座</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">口座番号</label>
          <input
            type="text"
            required
            value={form.account_number}
            onChange={(e) => setForm({ ...form, account_number: e.target.value })}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-surface-400">名義カナ</label>
        <input
          type="text"
          value={form.account_holder_kana ?? ''}
          onChange={(e) => setForm({ ...form, account_holder_kana: e.target.value })}
          className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">期首残高</label>
          <input
            type="number"
            step="1"
            value={form.opening_balance}
            onChange={(e) => setForm({ ...form, opening_balance: Number(e.target.value) })}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">対応する現金預金勘定</label>
          <select
            value={form.linked_account_id ?? ''}
            onChange={(e) => setForm({ ...form, linked_account_id: e.target.value })}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="">未設定(自動仕訳ルール適用不可)</option>
            {cashAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-surface-500">
        対応する現金預金勘定を設定すると、CSV取込時・明細マッチング時の自動仕訳ルール適用が可能になります。
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

export function BankAccountListPage() {
  const { data, isLoading } = useBankAccounts({ page_size: 200 });
  const createMutation = useCreateBankAccount();
  const updateMutation = useUpdateBankAccount();

  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<BankAccount | null>(null);

  const bankAccounts = data?.bankAccounts ?? [];

  const closeModal = (): void => {
    setModalMode(null);
    setEditing(null);
  };

  const handleCreate = async (dto: BankAccountFormInput): Promise<void> => {
    await createMutation.mutateAsync(dto);
    closeModal();
  };

  const handleUpdate = async (dto: BankAccountFormInput): Promise<void> => {
    if (!editing?.id) return;
    await updateMutation.mutateAsync({ id: editing.id, dto });
    closeModal();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-surface-50">
            <Landmark className="h-5 w-5 text-brand-400" />
            銀行口座マスタ
          </h1>
          <p className="mt-1 text-sm text-surface-400">銀行明細の取込・自動仕訳ルール適用の対象となる口座を管理します。</p>
        </div>
        <button type="button" className="btn-primary flex items-center gap-1.5" onClick={() => setModalMode('create')}>
          <Plus className="h-4 w-4" />
          新規口座
        </button>
      </div>

      {isLoading && <p className="text-sm text-surface-400">読み込み中…</p>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-4 py-3 font-medium">銀行/支店</th>
              <th className="px-4 py-3 font-medium">口座種別</th>
              <th className="px-4 py-3 font-medium">口座番号</th>
              <th className="px-4 py-3 font-medium">連携勘定</th>
              <th className="px-4 py-3 font-medium">状態</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {bankAccounts.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-surface-500">
                  銀行口座が登録されていません
                </td>
              </tr>
            )}
            {bankAccounts.map((bankAccount) => (
              <tr key={bankAccount.id} className="border-b border-surface-800/60">
                <td className="px-4 py-3 text-surface-100">
                  {bankAccount.bank_name}
                  {bankAccount.branch_name && (
                    <span className="ml-1 text-xs text-surface-400">{bankAccount.branch_name}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-surface-400">
                  {bankAccount.account_type === 'ordinary' ? '普通' : '当座'}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-surface-300">{bankAccount.account_number}</td>
                <td className="px-4 py-3 text-xs text-surface-400">
                  {bankAccount.linked_account_id ? '設定済み' : '未設定'}
                </td>
                <td className="px-4 py-3">
                  <span className={bankAccount.is_active ? 'badge-posted' : 'badge-draft'}>
                    {bankAccount.is_active ? '有効' : '無効'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    className="btn-secondary flex items-center gap-1 !py-1 text-xs"
                    onClick={() => {
                      setEditing(bankAccount);
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
        <Modal title="銀行口座を新規作成" onClose={closeModal}>
          <BankAccountForm
            initial={EMPTY_FORM}
            submitting={createMutation.isPending}
            onSubmit={(dto) => void handleCreate(dto)}
            onCancel={closeModal}
          />
        </Modal>
      )}

      {modalMode === 'edit' && editing && (
        <Modal title="銀行口座を編集" onClose={closeModal}>
          <BankAccountForm
            initial={{
              bank_name: editing.bank_name ?? '',
              bank_code: editing.bank_code ?? '',
              branch_name: editing.branch_name ?? '',
              branch_code: editing.branch_code ?? '',
              account_type: (editing.account_type ?? 'ordinary') as BankAccountFormInput['account_type'],
              account_number: editing.account_number ?? '',
              account_holder_kana: editing.account_holder_kana ?? '',
              currency_code: editing.currency_code ?? 'JPY',
              opening_balance: editing.opening_balance ?? 0,
              linked_account_id: editing.linked_account_id ?? '',
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
