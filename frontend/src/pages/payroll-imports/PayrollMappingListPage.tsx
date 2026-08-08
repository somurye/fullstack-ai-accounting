import { Pencil, Plus, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { useAccounts } from '../settings/accounts/hooks';
import {
  useCreatePayrollImportMapping,
  usePayrollImportMappings,
  useUpdatePayrollImportMapping,
} from './hooks';
import type { PayrollImportMapping, PayrollImportMappingFormInput } from './types';

const EMPTY_FORM: PayrollImportMappingFormInput = {
  name: '',
  column_mapping: { employee_name: '' },
  account_mapping: { net_payment_account_id: '' },
  is_active: true,
};

const ITEM_ROWS: Array<{
  label: string;
  columnKey: keyof PayrollImportMappingFormInput['column_mapping'];
  accountKey?: keyof PayrollImportMappingFormInput['account_mapping'];
  required?: boolean;
}> = [
  { label: '役員報酬(借方)', columnKey: 'executive_compensation_amount', accountKey: 'executive_compensation_account_id' },
  { label: '給料手当(借方)', columnKey: 'salary_amount', accountKey: 'salary_account_id' },
  { label: '源泉所得税(貸方・預り金)', columnKey: 'withholding_tax_amount', accountKey: 'withholding_tax_account_id' },
  { label: '住民税(貸方・預り金)', columnKey: 'resident_tax_amount', accountKey: 'resident_tax_account_id' },
  {
    label: '社会保険料 本人負担(貸方・預り金)',
    columnKey: 'social_insurance_employee_amount',
    accountKey: 'social_insurance_employee_account_id',
  },
  {
    label: '差引支給額(貸方) *必須',
    columnKey: 'net_payment_amount',
    accountKey: 'net_payment_account_id',
    required: true,
  },
];

function inputClass() {
  return 'w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400';
}

function MappingForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
}: {
  initial: PayrollImportMappingFormInput;
  submitting: boolean;
  onSubmit: (dto: PayrollImportMappingFormInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<PayrollImportMappingFormInput>(initial);
  const { data: accountsData } = useAccounts({ page_size: 200 });
  const accounts = accountsData?.accounts ?? [];

  const setColumn = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, column_mapping: { ...prev.column_mapping, [key]: value || undefined } }));
  const setAccount = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, account_mapping: { ...prev.account_mapping, [key]: value || undefined } }));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
    >
      <div>
        <label className="mb-1 block text-xs font-medium text-surface-400">マッピング名</label>
        <input
          type="text"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className={inputClass()}
          placeholder="例: 弥生給与CSV標準マッピング"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">従業員名(列見出し) *必須</label>
          <input
            type="text"
            required
            value={form.column_mapping.employee_name}
            onChange={(e) => setColumn('employee_name', e.target.value)}
            className={inputClass()}
            placeholder="例: 氏名"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">従業員コード(列見出し・任意)</label>
          <input
            type="text"
            value={form.column_mapping.employee_code ?? ''}
            onChange={(e) => setColumn('employee_code', e.target.value)}
            className={inputClass()}
            placeholder="例: 社員番号"
          />
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-surface-800 p-3">
        <p className="text-xs font-semibold text-surface-300">給与項目マッピング(列見出し + 計上先勘定科目)</p>
        {ITEM_ROWS.map((item) => (
          <div key={item.columnKey} className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-surface-400">{item.label} 列見出し</label>
              <input
                type="text"
                required={item.required}
                value={(form.column_mapping[item.columnKey] as string | undefined) ?? ''}
                onChange={(e) => setColumn(item.columnKey, e.target.value)}
                className={inputClass()}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-surface-400">計上先勘定科目</label>
              <select
                required={item.required}
                value={
                  (form.account_mapping as Record<string, string | null | undefined>)[
                    item.accountKey as string
                  ] ?? ''
                }
                onChange={(e) => setAccount(item.accountKey as string, e.target.value)}
                className={inputClass()}
              >
                <option value="">未設定</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}

        <div className="space-y-3 border-t border-surface-800 pt-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">
              社会保険料 会社負担(列見出し)
            </label>
            <input
              type="text"
              value={form.column_mapping.social_insurance_company_amount ?? ''}
              onChange={(e) => setColumn('social_insurance_company_amount', e.target.value)}
              className={inputClass()}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-surface-400">法定福利費(借方)</label>
              <select
                value={form.account_mapping.social_insurance_company_expense_account_id ?? ''}
                onChange={(e) => setAccount('social_insurance_company_expense_account_id', e.target.value)}
                className={inputClass()}
              >
                <option value="">未設定</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-surface-400">未払法定福利費(貸方)</label>
              <select
                value={form.account_mapping.social_insurance_company_payable_account_id ?? ''}
                onChange={(e) => setAccount('social_insurance_company_payable_account_id', e.target.value)}
                className={inputClass()}
              >
                <option value="">未設定</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-surface-300">
        <input
          type="checkbox"
          checked={form.is_active}
          onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
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

export function PayrollMappingListPage() {
  const { data, isLoading } = usePayrollImportMappings({ page_size: 200 });
  const createMutation = useCreatePayrollImportMapping();
  const updateMutation = useUpdatePayrollImportMapping();

  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<PayrollImportMapping | null>(null);

  const mappings = data?.mappings ?? [];

  const closeModal = (): void => {
    setModalMode(null);
    setEditing(null);
  };

  const handleCreate = async (dto: PayrollImportMappingFormInput): Promise<void> => {
    await createMutation.mutateAsync(dto);
    closeModal();
  };

  const handleUpdate = async (dto: PayrollImportMappingFormInput): Promise<void> => {
    if (!editing?.id) return;
    await updateMutation.mutateAsync({ id: editing.id, dto });
    closeModal();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-surface-50">
            <Settings2 className="h-5 w-5 text-brand-400" />
            給与CSV取込マッピング設定
          </h1>
          <p className="mt-1 text-sm text-surface-400">
            給与ソフトCSVの列見出しと、計上先勘定科目の対応を設定します。
          </p>
        </div>
        <button type="button" className="btn-primary flex items-center gap-1.5" onClick={() => setModalMode('create')}>
          <Plus className="h-4 w-4" />
          新規マッピング
        </button>
      </div>

      {isLoading && <p className="text-sm text-surface-400">読み込み中…</p>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-4 py-3 font-medium">マッピング名</th>
              <th className="px-4 py-3 font-medium">従業員名列</th>
              <th className="px-4 py-3 font-medium">状態</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {mappings.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-surface-500">
                  給与CSV取込マッピングが登録されていません
                </td>
              </tr>
            )}
            {mappings.map((mapping) => (
              <tr key={mapping.id} className="border-b border-surface-800/60">
                <td className="px-4 py-3 text-surface-100">{mapping.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-surface-400">
                  {mapping.column_mapping?.employee_name}
                </td>
                <td className="px-4 py-3">
                  <span className={mapping.is_active ? 'badge-posted' : 'badge-draft'}>
                    {mapping.is_active ? '有効' : '無効'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    className="btn-secondary flex items-center gap-1 !py-1 text-xs"
                    onClick={() => {
                      setEditing(mapping);
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
        <Modal title="給与CSV取込マッピングを新規作成" onClose={closeModal}>
          <MappingForm
            initial={EMPTY_FORM}
            submitting={createMutation.isPending}
            onSubmit={(dto) => void handleCreate(dto)}
            onCancel={closeModal}
          />
        </Modal>
      )}

      {modalMode === 'edit' && editing && (
        <Modal title="給与CSV取込マッピングを編集" onClose={closeModal}>
          <MappingForm
            initial={{
              name: editing.name ?? '',
              column_mapping: editing.column_mapping ?? { employee_name: '' },
              account_mapping: editing.account_mapping ?? { net_payment_account_id: '' },
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
