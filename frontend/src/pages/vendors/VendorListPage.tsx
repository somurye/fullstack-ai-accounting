import { Pencil, Plus, Truck } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { useCreateVendor, useUpdateVendor, useVendors } from './hooks';
import type { BankAccountInfo, Vendor, VendorFormInput } from './types';

const EMPTY_FORM: VendorFormInput = {
  code: '',
  name: '',
  kana_name: '',
  invoice_registration_number: '',
  bank_account_info: {},
};

function VendorForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
}: {
  initial: VendorFormInput;
  submitting: boolean;
  onSubmit: (dto: VendorFormInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<VendorFormInput>(initial);
  const bank: BankAccountInfo = form.bank_account_info ?? {};

  const setBank = (patch: Partial<BankAccountInfo>): void => {
    setForm({ ...form, bank_account_info: { ...bank, ...patch } });
  };

  const hasBankInfo = Object.values(bank).some((v) => v);

  return (
    <form
      className="max-h-[70vh] space-y-4 overflow-y-auto pr-1"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          ...form,
          kana_name: form.kana_name || undefined,
          invoice_registration_number: form.invoice_registration_number || undefined,
          bank_account_info: hasBankInfo ? bank : undefined,
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">仕入先コード</label>
          <input
            type="text"
            required
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">インボイス登録番号</label>
          <input
            type="text"
            placeholder="T1234567890123"
            value={form.invoice_registration_number ?? ''}
            onChange={(e) => setForm({ ...form, invoice_registration_number: e.target.value })}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-surface-400">仕入先名</label>
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

      <div className="rounded-lg border border-surface-800 p-3">
        <p className="mb-2 text-xs font-semibold text-surface-300">全銀FB振込先情報(任意)</p>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            placeholder="銀行名"
            value={bank.bank_name ?? ''}
            onChange={(e) => setBank({ bank_name: e.target.value })}
            className="rounded-lg border border-surface-700 bg-surface-850 px-2.5 py-1.5 text-xs text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
          <input
            type="text"
            placeholder="銀行コード"
            value={bank.bank_code ?? ''}
            onChange={(e) => setBank({ bank_code: e.target.value })}
            className="rounded-lg border border-surface-700 bg-surface-850 px-2.5 py-1.5 text-xs text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
          <input
            type="text"
            placeholder="支店名"
            value={bank.branch_name ?? ''}
            onChange={(e) => setBank({ branch_name: e.target.value })}
            className="rounded-lg border border-surface-700 bg-surface-850 px-2.5 py-1.5 text-xs text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
          <input
            type="text"
            placeholder="支店コード"
            value={bank.branch_code ?? ''}
            onChange={(e) => setBank({ branch_code: e.target.value })}
            className="rounded-lg border border-surface-700 bg-surface-850 px-2.5 py-1.5 text-xs text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
          <select
            value={bank.account_type ?? ''}
            onChange={(e) => setBank({ account_type: (e.target.value || undefined) as BankAccountInfo['account_type'] })}
            className="rounded-lg border border-surface-700 bg-surface-850 px-2.5 py-1.5 text-xs text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="">口座種別</option>
            <option value="ordinary">普通</option>
            <option value="checking">当座</option>
          </select>
          <input
            type="text"
            placeholder="口座番号"
            value={bank.account_number ?? ''}
            onChange={(e) => setBank({ account_number: e.target.value })}
            className="rounded-lg border border-surface-700 bg-surface-850 px-2.5 py-1.5 text-xs text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
          <input
            type="text"
            placeholder="名義カナ"
            value={bank.account_holder_kana ?? ''}
            onChange={(e) => setBank({ account_holder_kana: e.target.value })}
            className="col-span-2 rounded-lg border border-surface-700 bg-surface-850 px-2.5 py-1.5 text-xs text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
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

export function VendorListPage() {
  const [q, setQ] = useState('');
  const { data, isLoading } = useVendors({ q: q || undefined, page_size: 200 });
  const createMutation = useCreateVendor();
  const updateMutation = useUpdateVendor();

  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);

  const vendors = data?.vendors ?? [];

  const closeModal = (): void => {
    setModalMode(null);
    setEditingVendor(null);
  };

  const handleCreate = async (dto: VendorFormInput): Promise<void> => {
    await createMutation.mutateAsync(dto);
    closeModal();
  };

  const handleUpdate = async (dto: VendorFormInput): Promise<void> => {
    if (!editingVendor?.id) return;
    await updateMutation.mutateAsync({ id: editingVendor.id, dto });
    closeModal();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-surface-50">
            <Truck className="h-5 w-5 text-brand-400" />
            仕入先マスタ
          </h1>
          <p className="mt-1 text-sm text-surface-400">
            仕入請求書・全銀FB振込データ出力に使用する仕入先を管理します。
          </p>
        </div>
        <button type="button" className="btn-primary flex items-center gap-1.5" onClick={() => setModalMode('create')}>
          <Plus className="h-4 w-4" />
          新規仕入先
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
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-4 py-3 font-medium">コード</th>
              <th className="px-4 py-3 font-medium">仕入先名</th>
              <th className="px-4 py-3 font-medium">インボイス登録番号</th>
              <th className="px-4 py-3 font-medium">振込先</th>
              <th className="px-4 py-3 font-medium">状態</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {vendors.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-surface-500">
                  仕入先が登録されていません
                </td>
              </tr>
            )}
            {vendors.map((vendor) => (
              <tr key={vendor.id} className="border-b border-surface-800/60">
                <td className="px-4 py-3 font-mono text-xs text-surface-300">{vendor.code}</td>
                <td className="px-4 py-3 text-surface-100">{vendor.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-surface-400">
                  {vendor.invoice_registration_number ?? '—'}
                </td>
                <td className="px-4 py-3 text-xs text-surface-400">
                  {vendor.bank_account_info?.bank_name
                    ? `${vendor.bank_account_info.bank_name} ${vendor.bank_account_info.branch_name ?? ''}`
                    : '—'}
                </td>
                <td className="px-4 py-3">
                  <span className={vendor.is_active ? 'badge-posted' : 'badge-draft'}>
                    {vendor.is_active ? '有効' : '無効'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    className="btn-secondary flex items-center gap-1 !py-1 text-xs"
                    onClick={() => {
                      setEditingVendor(vendor);
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
        <Modal title="仕入先を新規作成" onClose={closeModal}>
          <VendorForm
            initial={EMPTY_FORM}
            submitting={createMutation.isPending}
            onSubmit={(dto) => void handleCreate(dto)}
            onCancel={closeModal}
          />
        </Modal>
      )}

      {modalMode === 'edit' && editingVendor && (
        <Modal title="仕入先を編集" onClose={closeModal}>
          <VendorForm
            initial={{
              code: editingVendor.code ?? '',
              name: editingVendor.name ?? '',
              kana_name: editingVendor.kana_name ?? '',
              invoice_registration_number: editingVendor.invoice_registration_number ?? '',
              bank_account_info: editingVendor.bank_account_info ?? {},
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
