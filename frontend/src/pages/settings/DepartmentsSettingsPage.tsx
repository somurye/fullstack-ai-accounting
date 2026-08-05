import { Building2, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { useCreateDepartment, useDepartments, useUpdateDepartment } from './departments/hooks';
import type { Department, DepartmentFormInput } from './departments/types';

const EMPTY_FORM: DepartmentFormInput = { code: '', name: '', is_active: true };

function DepartmentForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
}: {
  initial: DepartmentFormInput;
  submitting: boolean;
  onSubmit: (dto: DepartmentFormInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<DepartmentFormInput>(initial);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
    >
      <div>
        <label className="mb-1 block text-xs font-medium text-surface-400">部門コード</label>
        <input
          type="text"
          required
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-surface-400">部門名</label>
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
          checked={form.is_active}
          onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
          className="h-4 w-4 rounded border-surface-700 bg-surface-850"
        />
        有効
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

export function DepartmentsSettingsPage() {
  const { data, isLoading } = useDepartments({ page_size: 200 });
  const createMutation = useCreateDepartment();
  const updateMutation = useUpdateDepartment();

  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<Department | null>(null);

  const departments = data?.departments ?? [];

  const closeModal = (): void => {
    setModalMode(null);
    setEditing(null);
  };

  const handleCreate = async (dto: DepartmentFormInput): Promise<void> => {
    await createMutation.mutateAsync(dto);
    closeModal();
  };

  const handleUpdate = async (dto: DepartmentFormInput): Promise<void> => {
    if (!editing?.id) return;
    await updateMutation.mutateAsync({ id: editing.id, dto });
    closeModal();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-surface-50">
            <Building2 className="h-5 w-5 text-brand-400" />
            部門マスタ
          </h1>
          <p className="mt-1 text-sm text-surface-400">仕訳・経費精算の部門別集計に使用する部門を管理します。</p>
        </div>
        <button type="button" className="btn-primary flex items-center gap-1.5" onClick={() => setModalMode('create')}>
          <Plus className="h-4 w-4" />
          新規部門
        </button>
      </div>

      {isLoading && <p className="text-sm text-surface-400">読み込み中…</p>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-4 py-3 font-medium">コード</th>
              <th className="px-4 py-3 font-medium">部門名</th>
              <th className="px-4 py-3 font-medium">状態</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {departments.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-surface-500">
                  部門が登録されていません
                </td>
              </tr>
            )}
            {departments.map((department) => (
              <tr key={department.id} className="border-b border-surface-800/60">
                <td className="px-4 py-3 font-mono text-xs text-surface-300">{department.code}</td>
                <td className="px-4 py-3 text-surface-100">{department.name}</td>
                <td className="px-4 py-3">
                  <span className={department.is_active ? 'badge-posted' : 'badge-draft'}>
                    {department.is_active ? '有効' : '無効'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    className="btn-secondary flex items-center gap-1 !py-1 text-xs"
                    onClick={() => {
                      setEditing(department);
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
        <Modal title="部門を新規作成" onClose={closeModal}>
          <DepartmentForm
            initial={EMPTY_FORM}
            submitting={createMutation.isPending}
            onSubmit={(dto) => void handleCreate(dto)}
            onCancel={closeModal}
          />
        </Modal>
      )}

      {modalMode === 'edit' && editing && (
        <Modal title="部門を編集" onClose={closeModal}>
          <DepartmentForm
            initial={{
              code: editing.code ?? '',
              name: editing.name ?? '',
              is_active: editing.is_active ?? true,
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
