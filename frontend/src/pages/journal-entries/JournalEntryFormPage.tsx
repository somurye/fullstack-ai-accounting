import { ArrowLeft, Check, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from '../../stores/toastStore';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { useAcceptAiSuggestion, useAiSuggestions, useRejectAiSuggestion } from '../ai-suggestions/hooks';
import type { AiSuggestion } from '../ai-suggestions/types';
import { ActionReasonDialog } from './ActionReasonDialog';
import {
  useAccounts,
  useCreateJournalEntry,
  useDeleteJournalEntryLine,
  useDepartments,
  useJournalEntry,
  usePostJournalEntry,
  useReverseJournalEntry,
  useTaxCategories,
  useUpdateJournalEntry,
  useVoidJournalEntry,
} from './hooks';
import { StatusBadge } from './StatusBadge';
import type { DebitCredit, JournalEntryLineCreate, JournalEntryStatus } from './types';

interface LineItemState {
  key: string;
  /** サーバーに永続化済みの明細行のid(新規追加でまだ保存前の行はundefined) */
  id?: string;
  account_id: string;
  debit_credit: DebitCredit;
  amount: string;
  tax_category_id: string;
  department_id: string;
  description: string;
}

function emptyLine(debitCredit: DebitCredit): LineItemState {
  return {
    key: crypto.randomUUID(),
    account_id: '',
    debit_credit: debitCredit,
    amount: '',
    tax_category_id: '',
    department_id: '',
    description: '',
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

export function JournalEntryFormPage() {
  const { id } = useParams<{ id: string }>();
  const isCreate = !id;
  const navigate = useNavigate();

  const { data: existingEntry, isLoading: isEntryLoading } = useJournalEntry(id);
  const { data: accounts = [] } = useAccounts();
  const { data: taxCategories = [] } = useTaxCategories();
  const { data: departments = [] } = useDepartments();

  const createMutation = useCreateJournalEntry();
  const updateMutation = useUpdateJournalEntry(id ?? '');
  const postMutation = usePostJournalEntry();
  const voidMutation = useVoidJournalEntry();
  const reverseMutation = useReverseJournalEntry();
  const deleteLineMutation = useDeleteJournalEntryLine(id ?? '');

  const [entryDate, setEntryDate] = useState(todayIso());
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<LineItemState[]>([emptyLine('debit'), emptyLine('credit')]);
  const [dialogMode, setDialogMode] = useState<'void' | 'reverse' | null>(null);

  useEffect(() => {
    if (!existingEntry) return;
    setEntryDate(existingEntry.entry_date ?? todayIso());
    setDescription(existingEntry.description ?? '');
    setLines(
      (existingEntry.lines ?? []).map((line) => ({
        key: line.id ?? crypto.randomUUID(),
        id: line.id,
        account_id: line.account_id ?? '',
        debit_credit: line.debit_credit ?? 'debit',
        amount: line.amount !== undefined ? String(line.amount) : '',
        tax_category_id: line.tax_category_id ?? '',
        department_id: line.department_id ?? '',
        description: line.description ?? '',
      })),
    );
  }, [existingEntry]);

  const status: JournalEntryStatus | undefined = existingEntry?.status as
    | JournalEntryStatus
    | undefined;
  const isDraft = isCreate || status === 'draft';
  const isReadOnly = !isDraft;

  // AI提案(勘定科目推測)。この仕訳が既にdraftとして保存されている場合のみ、
  // まだ判定されていない提案(未判定=accepted未指定でのデフォルト絞り込み)を取得する。
  const aiSuggestionsQuery = useAiSuggestions(
    { target_type: 'journal_entry', target_id: id, page_size: 20 },
    { enabled: Boolean(id) && isDraft },
  );
  const acceptSuggestion = useAcceptAiSuggestion();
  const rejectSuggestion = useRejectAiSuggestion();
  const suggestionByLineNo = useMemo(() => {
    const map = new Map<number, AiSuggestion>();
    for (const s of aiSuggestionsQuery.data?.suggestions ?? []) {
      const lineNo = s.payload?.target_line_no;
      if (typeof lineNo === 'number') map.set(lineNo, s);
    }
    return map;
  }, [aiSuggestionsQuery.data]);

  const { debitTotal, creditTotal, diff } = useMemo(() => {
    const debit = lines
      .filter((l) => l.debit_credit === 'debit')
      .reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
    const credit = lines
      .filter((l) => l.debit_credit === 'credit')
      .reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
    return { debitTotal: debit, creditTotal: credit, diff: Math.round((debit - credit) * 100) / 100 };
  }, [lines]);

  const isBalanced = diff === 0 && debitTotal > 0;
  const hasValidLines =
    lines.length >= 2 && lines.every((l) => l.account_id && Number(l.amount) > 0);

  const updateLine = (key: string, patch: Partial<LineItemState>): void => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const addLine = (debitCredit: DebitCredit): void => {
    setLines((prev) => [...prev, emptyLine(debitCredit)]);
  };

  /**
   * 既に保存済み(サーバー側にidを持つ)の明細行は、`DELETE /journal-entries/:id/lines/:lineId`
   * を即時呼び出して削除する(下書き保存を待たずに反映される「操作感向上」)。
   * まだ保存されていない新規追加行(idなし)はローカル状態からの除去のみで完結する。
   */
  const removeLine = (line: LineItemState): void => {
    if (lines.length <= 2) return;
    if (line.id && id) {
      deleteLineMutation.mutate(line.id, {
        onSuccess: () => setLines((prev) => prev.filter((l) => l.key !== line.key)),
      });
      return;
    }
    setLines((prev) => prev.filter((l) => l.key !== line.key));
  };

  const buildLinePayload = (): JournalEntryLineCreate[] =>
    lines.map((l) => ({
      account_id: l.account_id,
      debit_credit: l.debit_credit,
      amount: Number(l.amount),
      tax_category_id: l.tax_category_id || undefined,
      department_id: l.department_id || undefined,
      description: l.description || undefined,
    }));

  const handleSaveDraft = async (): Promise<void> => {
    if (!hasValidLines) {
      toast.error('全ての明細行に勘定科目と金額(0より大きい値)を入力してください');
      return;
    }
    if (isCreate) {
      const entry = await createMutation.mutateAsync({
        entry_date: entryDate,
        description: description || undefined,
        currency_code: 'JPY',
        exchange_rate: 1,
        lines: buildLinePayload(),
      });
      navigate(`/journal-entries/${entry.id}`, { replace: true });
    } else {
      await updateMutation.mutateAsync({
        entry_date: entryDate,
        description: description || undefined,
        lines: buildLinePayload(),
      });
    }
  };

  const handleConfirmAndPost = async (): Promise<void> => {
    if (!hasValidLines) {
      toast.error('全ての明細行に勘定科目と金額(0より大きい値)を入力してください');
      return;
    }
    if (!isBalanced) {
      toast.error('借方合計と貸方合計が一致していません');
      return;
    }
    try {
      let targetId = id;
      if (isCreate) {
        const entry = await createMutation.mutateAsync({
          entry_date: entryDate,
          description: description || undefined,
          currency_code: 'JPY',
          exchange_rate: 1,
          lines: buildLinePayload(),
        });
        targetId = entry.id;
      } else {
        await updateMutation.mutateAsync({
          entry_date: entryDate,
          description: description || undefined,
          lines: buildLinePayload(),
        });
        targetId = id;
      }
      if (targetId) {
        await postMutation.mutateAsync(targetId);
        navigate(`/journal-entries/${targetId}`, { replace: true });
      }
    } catch (error) {
      // 個々のmutationのonErrorで既にtoast表示済みだが、フロー全体の失敗も明示しておく
      toast.error(formatApiErrorMessage(error));
    }
  };

  const isSubmitting =
    createMutation.isPending || updateMutation.isPending || postMutation.isPending;

  if (id && isEntryLoading) {
    return <p className="text-sm text-surface-400">読み込み中…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            to="/journal-entries"
            className="mb-2 inline-flex items-center gap-1 text-sm text-surface-400 hover:text-surface-200"
          >
            <ArrowLeft className="h-4 w-4" />
            仕訳帳へ戻る
          </Link>
          <h1 className="text-xl font-semibold text-surface-50">
            {isCreate ? '仕訳を新規起票' : `仕訳 ${existingEntry?.entry_no ?? ''}`}
          </h1>
        </div>
        {status && <StatusBadge status={status} />}
      </div>

      <div className="card space-y-4 p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">伝票日付</label>
            <input
              type="date"
              value={entryDate}
              disabled={isReadOnly}
              onChange={(e) => setEntryDate(e.target.value)}
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">摘要</label>
            <input
              type="text"
              value={description}
              disabled={isReadOnly}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例: 4月分オフィス賃料"
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
            />
          </div>
        </div>
      </div>

      <div className="card overflow-x-auto p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-surface-100">仕訳明細</h2>
          {!isReadOnly && (
            <div className="flex gap-2">
              <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => addLine('debit')}>
                <Plus className="h-3.5 w-3.5" />
                借方行を追加
              </button>
              <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => addLine('credit')}>
                <Plus className="h-3.5 w-3.5" />
                貸方行を追加
              </button>
            </div>
          )}
        </div>

        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-2 py-2 font-medium">貸借</th>
              <th className="px-2 py-2 font-medium">勘定科目</th>
              <th className="px-2 py-2 text-right font-medium">金額</th>
              <th className="px-2 py-2 font-medium">税区分</th>
              <th className="px-2 py-2 font-medium">部門</th>
              <th className="px-2 py-2 font-medium">摘要</th>
              {!isReadOnly && <th className="px-2 py-2" />}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const lineSuggestion = suggestionByLineNo.get(index + 1);
              return (
              <tr key={line.key} className="border-b border-surface-800/60">
                <td className="px-2 py-2">
                  <select
                    value={line.debit_credit}
                    disabled={isReadOnly}
                    onChange={(e) => updateLine(line.key, { debit_credit: e.target.value as DebitCredit })}
                    className="rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
                  >
                    <option value="debit">借方</option>
                    <option value="credit">貸方</option>
                  </select>
                </td>
                <td className="px-2 py-2">
                  <select
                    value={line.account_id}
                    disabled={isReadOnly}
                    onChange={(e) => updateLine(line.key, { account_id: e.target.value })}
                    className="w-48 rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
                  >
                    <option value="">選択してください</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code} {account.name}
                      </option>
                    ))}
                  </select>
                  {lineSuggestion && (
                    <div className="mt-1 flex w-48 items-center gap-1 rounded-md border border-brand-500/40 bg-brand-500/10 px-1.5 py-1 text-[11px] text-brand-200">
                      <Sparkles className="h-3 w-3 shrink-0" />
                      <span className="truncate" title={`AI推薦: ${lineSuggestion.payload?.suggested_account_code}`}>
                        AI推薦: {lineSuggestion.payload?.suggested_account_code}
                        {typeof lineSuggestion.confidence_score === 'number'
                          ? `(${Math.round(lineSuggestion.confidence_score * 100)}%)`
                          : ''}
                      </span>
                      <button
                        type="button"
                        title="この提案を採用する"
                        className="ml-auto rounded p-0.5 hover:bg-brand-500/30 disabled:opacity-50"
                        disabled={acceptSuggestion.isPending || rejectSuggestion.isPending}
                        onClick={() => acceptSuggestion.mutate(lineSuggestion.id as string)}
                      >
                        <Check className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        title="この提案を不採用にする"
                        className="rounded p-0.5 hover:bg-brand-500/30 disabled:opacity-50"
                        disabled={acceptSuggestion.isPending || rejectSuggestion.isPending}
                        onClick={() => rejectSuggestion.mutate({ id: lineSuggestion.id as string })}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={line.amount}
                    disabled={isReadOnly}
                    onChange={(e) => updateLine(line.key, { amount: e.target.value })}
                    className="w-32 rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-right text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
                  />
                </td>
                <td className="px-2 py-2">
                  <select
                    value={line.tax_category_id}
                    disabled={isReadOnly}
                    onChange={(e) => updateLine(line.key, { tax_category_id: e.target.value })}
                    className="w-36 rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
                  >
                    <option value="">なし</option>
                    {taxCategories.map((tax) => (
                      <option key={tax.id} value={tax.id}>
                        {tax.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2">
                  <select
                    value={line.department_id}
                    disabled={isReadOnly}
                    onChange={(e) => updateLine(line.key, { department_id: e.target.value })}
                    className="w-32 rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
                  >
                    <option value="">なし</option>
                    {departments.map((dept) => (
                      <option key={dept.id} value={dept.id}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2">
                  <input
                    type="text"
                    value={line.description}
                    disabled={isReadOnly}
                    onChange={(e) => updateLine(line.key, { description: e.target.value })}
                    className="w-40 rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
                  />
                </td>
                {!isReadOnly && (
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => removeLine(line)}
                      disabled={lines.length <= 2 || deleteLineMutation.isPending}
                      className="rounded-md p-1.5 text-negative transition-colors hover:bg-negative-subtle disabled:cursor-not-allowed disabled:opacity-30"
                      title="行を削除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-6 border-t border-surface-800 pt-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-surface-400">借方合計</span>
            <span className="tabular-nums font-medium text-surface-100">
              {currencyFormatter.format(debitTotal)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-surface-400">貸方合計</span>
            <span className="tabular-nums font-medium text-surface-100">
              {currencyFormatter.format(creditTotal)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-surface-400">差額</span>
            <span
              className={`tabular-nums font-semibold ${diff === 0 ? 'text-positive' : 'text-negative'}`}
            >
              {currencyFormatter.format(diff)}
            </span>
          </div>
        </div>
        {diff !== 0 && (
          <p className="mt-2 text-right text-xs text-negative">
            借方・貸方の合計が一致していません。確定するには差額を0にしてください。
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-3">
        {isDraft && (
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={isSubmitting}
              onClick={() => void handleSaveDraft()}
            >
              下書き保存
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!isBalanced || !hasValidLines || isSubmitting}
              onClick={() => void handleConfirmAndPost()}
              title={!isBalanced ? '借方・貸方の合計を一致させてください' : undefined}
            >
              確定
            </button>
          </>
        )}
        {status === 'posted' && (
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setDialogMode('void')}
            >
              Void(即時取消)
            </button>
            <button type="button" className="btn-primary" onClick={() => setDialogMode('reverse')}>
              反対仕訳を起票
            </button>
          </>
        )}
      </div>

      {dialogMode && existingEntry && (
        <ActionReasonDialog
          mode={dialogMode}
          entryNo={existingEntry.entry_no ?? ''}
          isSubmitting={voidMutation.isPending || reverseMutation.isPending}
          onCancel={() => setDialogMode(null)}
          onConfirm={({ reason, entryDate: reverseDate }) => {
            if (!id) return;
            if (dialogMode === 'void') {
              voidMutation.mutate(
                { id, reason: reason || undefined },
                { onSuccess: () => setDialogMode(null) },
              );
            } else {
              reverseMutation.mutate(
                { id, reason, entry_date: reverseDate },
                {
                  onSuccess: (entry) => {
                    setDialogMode(null);
                    navigate(`/journal-entries/${entry.id}`);
                  },
                },
              );
            }
          }}
        />
      )}
    </div>
  );
}
