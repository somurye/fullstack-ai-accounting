import { Pencil, Plus, Wand2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { useAccounts } from './accounts/hooks';
import {
  useAutoJournalRules,
  useCreateAutoJournalRule,
  useDeactivateAutoJournalRule,
  useUpdateAutoJournalRule,
} from './auto-journal-rules/hooks';
import type { AutoJournalRule, AutoJournalRuleFormInput } from './auto-journal-rules/types';

const EMPTY_FORM: AutoJournalRuleFormInput = {
  rule_name: '',
  priority: 100,
  source: 'bank',
  match_pattern: '',
  min_amount: undefined,
  max_amount: undefined,
  debit_account_id: '',
  credit_account_id: '',
};

function RuleForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
}: {
  initial: AutoJournalRuleFormInput;
  submitting: boolean;
  onSubmit: (dto: AutoJournalRuleFormInput) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<AutoJournalRuleFormInput>(initial);
  const { data: accountsData } = useAccounts({ page_size: 200 });
  const accounts = accountsData?.accounts ?? [];

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          ...form,
          debit_account_id: form.debit_account_id || undefined,
          credit_account_id: form.credit_account_id || undefined,
        });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">ルール名</label>
          <input
            type="text"
            required
            value={form.rule_name}
            onChange={(e) => setForm({ ...form, rule_name: e.target.value })}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">優先度(小さいほど優先)</label>
          <input
            type="number"
            required
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-surface-400">摘要パターン(正規表現または部分一致文字列)</label>
        <input
          type="text"
          required
          placeholder="例: 家賃|振込手数料"
          value={form.match_pattern}
          onChange={(e) => setForm({ ...form, match_pattern: e.target.value })}
          className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">最小金額(任意)</label>
          <input
            type="number"
            value={form.min_amount ?? ''}
            onChange={(e) => setForm({ ...form, min_amount: e.target.value ? Number(e.target.value) : undefined })}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">最大金額(任意)</label>
          <input
            type="number"
            value={form.max_amount ?? ''}
            onChange={(e) => setForm({ ...form, max_amount: e.target.value ? Number(e.target.value) : undefined })}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">出金時の借方科目</label>
          <select
            value={form.debit_account_id ?? ''}
            onChange={(e) => setForm({ ...form, debit_account_id: e.target.value })}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
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
          <label className="mb-1 block text-xs font-medium text-surface-400">入金時の貸方科目</label>
          <select
            value={form.credit_account_id ?? ''}
            onChange={(e) => setForm({ ...form, credit_account_id: e.target.value })}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
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
      <p className="text-xs text-surface-500">
        入金(入金額が正)の明細には貸方科目、出金(負)の明細には借方科目が銀行口座の相手勘定として使用されます。
        該当する側が未設定の場合、そのルールは該当方向の明細には適用されません。
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

export function AutoJournalRuleListPage() {
  const { data, isLoading } = useAutoJournalRules({ page_size: 200 });
  const createMutation = useCreateAutoJournalRule();
  const updateMutation = useUpdateAutoJournalRule();
  const deactivateMutation = useDeactivateAutoJournalRule();

  const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<AutoJournalRule | null>(null);

  const rules = data?.rules ?? [];

  const closeModal = (): void => {
    setModalMode(null);
    setEditing(null);
  };

  const handleCreate = async (dto: AutoJournalRuleFormInput): Promise<void> => {
    await createMutation.mutateAsync(dto);
    closeModal();
  };

  const handleUpdate = async (dto: AutoJournalRuleFormInput): Promise<void> => {
    if (!editing?.id) return;
    await updateMutation.mutateAsync({ id: editing.id, dto });
    closeModal();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-surface-50">
            <Wand2 className="h-5 w-5 text-brand-400" />
            自動仕訳ルール
          </h1>
          <p className="mt-1 text-sm text-surface-400">
            銀行明細の摘要・金額に基づき、消込仕訳を自動起票するルールを管理します。優先度の小さいルールから評価されます。
          </p>
        </div>
        <button type="button" className="btn-primary flex items-center gap-1.5" onClick={() => setModalMode('create')}>
          <Plus className="h-4 w-4" />
          新規ルール
        </button>
      </div>

      {isLoading && <p className="text-sm text-surface-400">読み込み中…</p>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-4 py-3 font-medium">優先度</th>
              <th className="px-4 py-3 font-medium">ルール名</th>
              <th className="px-4 py-3 font-medium">対象</th>
              <th className="px-4 py-3 font-medium">摘要パターン</th>
              <th className="px-4 py-3 font-medium">金額範囲</th>
              <th className="px-4 py-3 font-medium">状態</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-surface-500">
                  自動仕訳ルールが登録されていません
                </td>
              </tr>
            )}
            {rules.map((rule) => (
              <tr key={rule.id} className="border-b border-surface-800/60">
                <td className="px-4 py-3 font-mono text-xs text-surface-300">{rule.priority}</td>
                <td className="px-4 py-3 text-surface-100">{rule.rule_name}</td>
                <td className="px-4 py-3 text-surface-400">{rule.source === 'bank' ? '銀行明細' : 'カード明細'}</td>
                <td className="px-4 py-3 font-mono text-xs text-surface-400">{rule.match_pattern}</td>
                <td className="px-4 py-3 text-xs text-surface-400">
                  {rule.min_amount ?? '—'} 〜 {rule.max_amount ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <span className={rule.is_active ? 'badge-posted' : 'badge-draft'}>
                    {rule.is_active ? '有効' : '無効'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      className="btn-secondary flex items-center gap-1 !py-1 text-xs"
                      onClick={() => {
                        setEditing(rule);
                        setModalMode('edit');
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                      編集
                    </button>
                    {rule.is_active && (
                      <button
                        type="button"
                        className="btn-secondary flex items-center gap-1 !py-1 text-xs"
                        disabled={deactivateMutation.isPending}
                        onClick={() => rule.id && deactivateMutation.mutate(rule.id)}
                      >
                        <XCircle className="h-3 w-3" />
                        無効化
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalMode === 'create' && (
        <Modal title="自動仕訳ルールを新規作成" onClose={closeModal}>
          <RuleForm
            initial={EMPTY_FORM}
            submitting={createMutation.isPending}
            onSubmit={(dto) => void handleCreate(dto)}
            onCancel={closeModal}
          />
        </Modal>
      )}

      {modalMode === 'edit' && editing && (
        <Modal title="自動仕訳ルールを編集" onClose={closeModal}>
          <RuleForm
            initial={{
              rule_name: editing.rule_name ?? '',
              priority: editing.priority ?? 100,
              source: (editing.source ?? 'bank') as AutoJournalRuleFormInput['source'],
              match_pattern: editing.match_pattern ?? '',
              min_amount: editing.min_amount ?? undefined,
              max_amount: editing.max_amount ?? undefined,
              debit_account_id: editing.debit_account_id ?? '',
              credit_account_id: editing.credit_account_id ?? '',
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
