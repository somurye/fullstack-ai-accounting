import { Percent, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { useCreateTaxCategory, useTaxCategories, useUpdateTaxCategory } from './tax-categories/hooks';
import type { TaxCategory, TaxCategoryFormInput } from './tax-categories/types';

const TAX_TYPE_LABEL: Record<string, string> = {
  taxable: '課税',
  non_taxable: '非課税',
  exempt: '免税',
  out_of_scope: '不課税',
};

const EMPTY_FORM: TaxCategoryFormInput = {
  code: '',
  name: '',
  tax_type: 'taxable',
  tax_rate: 10,
  is_reduced_rate: false,
};

function TaxCategoryForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
}: {
  initial: TaxCategoryFormInput;
  submitting: boolean;
  onSubmit: (dto: TaxCategoryFormInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<TaxCategoryFormInput>(initial);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">税区分コード</label>
          <input
            type="text"
            required
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">税率(%)</label>
          <input
            type="number"
            step="0.01"
            min={0}
            max={100}
            required
            value={form.tax_rate}
            onChange={(e) => setForm({ ...form, tax_rate: Number(e.target.value) })}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-surface-400">名称</label>
        <input
          type="text"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-surface-400">課税区分</label>
        <select
          value={form.tax_type}
          onChange={(e) => setForm({ ...form, tax_type: e.target.value as TaxCategoryFormInput['tax_type'] })}
          className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
        >
          {Object.entries(TAX_TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm text-surface-300">
        <input
          type="checkbox"
          checked={form.is_reduced_rate}
          onChange={(e) => setForm({ ...form, is_reduced_rate: e.target.checked })}
          className="h-4 w-4 rounded border-surface-700 bg-surface-850"
        />
        軽減税率(8%)対象
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

export function TaxCategoriesSettingsPage() {
  const { data, isLoading } = useTaxCategories({ page_size: 200 });
  const createMutation = useCreateTaxCategory();
  const updateMutation = useUpdateTaxCategory();

  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<TaxCategory | null>(null);

  const taxCategories = data?.taxCategories ?? [];

  const closeModal = (): void => {
    setModalMode(null);
    setEditing(null);
  };

  const handleCreate = async (dto: TaxCategoryFormInput): Promise<void> => {
    await createMutation.mutateAsync(dto);
    closeModal();
  };

  const handleUpdate = async (dto: TaxCategoryFormInput): Promise<void> => {
    if (!editing?.id) return;
    await updateMutation.mutateAsync({ id: editing.id, dto });
    closeModal();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-surface-50">
            <Percent className="h-5 w-5 text-brand-400" />
            税区分マスタ
          </h1>
          <p className="mt-1 text-sm text-surface-400">仕訳・請求書で使用する消費税区分を管理します。</p>
        </div>
        <button type="button" className="btn-primary flex items-center gap-1.5" onClick={() => setModalMode('create')}>
          <Plus className="h-4 w-4" />
          新規税区分
        </button>
      </div>

      {isLoading && <p className="text-sm text-surface-400">読み込み中…</p>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-4 py-3 font-medium">コード</th>
              <th className="px-4 py-3 font-medium">名称</th>
              <th className="px-4 py-3 font-medium">区分</th>
              <th className="px-4 py-3 font-medium">税率</th>
              <th className="px-4 py-3 font-medium">状態</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {taxCategories.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-surface-500">
                  税区分が登録されていません
                </td>
              </tr>
            )}
            {taxCategories.map((taxCategory) => (
              <tr key={taxCategory.id} className="border-b border-surface-800/60">
                <td className="px-4 py-3 font-mono text-xs text-surface-300">{taxCategory.code}</td>
                <td className="px-4 py-3 text-surface-100">{taxCategory.name}</td>
                <td className="px-4 py-3 text-surface-400">
                  {taxCategory.tax_type ? TAX_TYPE_LABEL[taxCategory.tax_type] : '—'}
                  {taxCategory.is_reduced_rate ? '(軽減)' : ''}
                </td>
                <td className="px-4 py-3 text-surface-400">{taxCategory.tax_rate}%</td>
                <td className="px-4 py-3">
                  <span className={taxCategory.is_active ? 'badge-posted' : 'badge-draft'}>
                    {taxCategory.is_active ? '有効' : '無効'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    className="btn-secondary flex items-center gap-1 !py-1 text-xs"
                    onClick={() => {
                      setEditing(taxCategory);
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
        <Modal title="税区分を新規作成" onClose={closeModal}>
          <TaxCategoryForm
            initial={EMPTY_FORM}
            submitting={createMutation.isPending}
            onSubmit={(dto) => void handleCreate(dto)}
            onCancel={closeModal}
          />
        </Modal>
      )}

      {modalMode === 'edit' && editing && (
        <Modal title="税区分を編集" onClose={closeModal}>
          <TaxCategoryForm
            initial={{
              code: editing.code ?? '',
              name: editing.name ?? '',
              tax_type: (editing.tax_type ?? 'taxable') as TaxCategoryFormInput['tax_type'],
              tax_rate: editing.tax_rate ?? 0,
              is_reduced_rate: editing.is_reduced_rate ?? false,
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
