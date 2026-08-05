import { Pencil, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { useCreateCustomer, useCustomers, useUpdateCustomer } from './hooks';
import type { Customer, CustomerFormInput } from './types';

const EMPTY_FORM: CustomerFormInput = { code: '', name: '', kana_name: '' };

function CustomerForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
}: {
  initial: CustomerFormInput;
  submitting: boolean;
  onSubmit: (dto: CustomerFormInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<CustomerFormInput>(initial);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...form, kana_name: form.kana_name || undefined });
      }}
    >
      <div>
        <label className="mb-1 block text-xs font-medium text-surface-400">顧客コード</label>
        <input
          type="text"
          required
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-surface-400">顧客名</label>
        <input
          type="text"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-surface-400">カナ名</label>
        <input
          type="text"
          value={form.kana_name ?? ''}
          onChange={(e) => setForm({ ...form, kana_name: e.target.value })}
          className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
        />
      </div>
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

export function CustomerListPage() {
  const [q, setQ] = useState('');
  const { data, isLoading } = useCustomers({ q: q || undefined, page_size: 200 });
  const createMutation = useCreateCustomer();
  const updateMutation = useUpdateCustomer();

  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  const customers = data?.customers ?? [];

  const closeModal = (): void => {
    setModalMode(null);
    setEditingCustomer(null);
  };

  const handleCreate = async (dto: CustomerFormInput): Promise<void> => {
    await createMutation.mutateAsync(dto);
    closeModal();
  };

  const handleUpdate = async (dto: CustomerFormInput): Promise<void> => {
    if (!editingCustomer?.id) return;
    await updateMutation.mutateAsync({ id: editingCustomer.id, dto });
    closeModal();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-surface-50">
            <Users className="h-5 w-5 text-brand-400" />
            顧客マスタ
          </h1>
          <p className="mt-1 text-sm text-surface-400">売上請求書の請求先となる顧客を管理します。</p>
        </div>
        <button type="button" className="btn-primary flex items-center gap-1.5" onClick={() => setModalMode('create')}>
          <Plus className="h-4 w-4" />
          新規顧客
        </button>
      </div>

      <div className="max-w-sm">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="名称・カナ名で検索"
          className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
        />
      </div>

      {isLoading && <p className="text-sm text-surface-400">読み込み中…</p>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-4 py-3 font-medium">コード</th>
              <th className="px-4 py-3 font-medium">顧客名</th>
              <th className="px-4 py-3 font-medium">カナ名</th>
              <th className="px-4 py-3 font-medium">状態</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-surface-500">
                  顧客が登録されていません
                </td>
              </tr>
            )}
            {customers.map((customer) => (
              <tr key={customer.id} className="border-b border-surface-800/60">
                <td className="px-4 py-3 font-mono text-xs text-surface-300">{customer.code}</td>
                <td className="px-4 py-3 text-surface-100">{customer.name}</td>
                <td className="px-4 py-3 text-surface-400">{customer.kana_name ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={customer.is_active ? 'badge-posted' : 'badge-draft'}>
                    {customer.is_active ? '有効' : '無効'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    className="btn-secondary flex items-center gap-1 !py-1 text-xs"
                    onClick={() => {
                      setEditingCustomer(customer);
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
        <Modal title="顧客を新規作成" onClose={closeModal}>
          <CustomerForm
            initial={EMPTY_FORM}
            submitting={createMutation.isPending}
            onSubmit={(dto) => void handleCreate(dto)}
            onCancel={closeModal}
          />
        </Modal>
      )}

      {modalMode === 'edit' && editingCustomer && (
        <Modal title="顧客を編集" onClose={closeModal}>
          <CustomerForm
            initial={{
              code: editingCustomer.code ?? '',
              name: editingCustomer.name ?? '',
              kana_name: editingCustomer.kana_name ?? '',
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
