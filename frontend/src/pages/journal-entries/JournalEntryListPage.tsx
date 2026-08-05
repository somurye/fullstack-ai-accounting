import { CheckCircle2, ChevronLeft, ChevronRight, Plus, RotateCcw, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ActionReasonDialog } from './ActionReasonDialog';
import { StatusBadge } from './StatusBadge';
import { usePostJournalEntry, useReverseJournalEntry, useVoidJournalEntry, useJournalEntries } from './hooks';
import { JOURNAL_ENTRY_STATUS_LABEL, type JournalEntry, type JournalEntryStatus } from './types';

const PAGE_SIZE = 20;

const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

function lineTotals(entry: JournalEntry): { debit: number; credit: number } {
  const lines = entry.lines ?? [];
  const debit = lines.filter((l) => l.debit_credit === 'debit').reduce((sum, l) => sum + (l.amount ?? 0), 0);
  const credit = lines.filter((l) => l.debit_credit === 'credit').reduce((sum, l) => sum + (l.amount ?? 0), 0);
  return { debit, credit };
}

type PendingAction =
  | { type: 'void'; entry: JournalEntry }
  | { type: 'reverse'; entry: JournalEntry }
  | null;

export function JournalEntryListPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<JournalEntryStatus | ''>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const { data, isLoading, isError } = useJournalEntries({
    page,
    page_size: PAGE_SIZE,
    status: status || undefined,
    entry_date_from: dateFrom || undefined,
    entry_date_to: dateTo || undefined,
  });

  const postMutation = usePostJournalEntry();
  const voidMutation = useVoidJournalEntry();
  const reverseMutation = useReverseJournalEntry();

  const entries = data?.entries ?? [];
  const pagination = data?.meta?.pagination;
  const totalPages = pagination?.total_pages ?? 1;

  const isActionSubmitting = voidMutation.isPending || reverseMutation.isPending;

  const statusOptions = useMemo(
    () => Object.entries(JOURNAL_ENTRY_STATUS_LABEL) as [JournalEntryStatus, string][],
    [],
  );

  const handleFilterSubmit = (): void => {
    setPage(1);
  };

  const handleConfirmAction = (input: { reason: string; entryDate?: string }): void => {
    if (!pendingAction) return;
    if (pendingAction.type === 'void') {
      voidMutation.mutate(
        { id: pendingAction.entry.id as string, reason: input.reason || undefined },
        { onSuccess: () => setPendingAction(null) },
      );
    } else {
      reverseMutation.mutate(
        { id: pendingAction.entry.id as string, reason: input.reason, entry_date: input.entryDate },
        { onSuccess: () => setPendingAction(null) },
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-surface-50">仕訳帳</h1>
          <p className="mt-1 text-sm text-surface-400">仕訳の検索・確定・取消・反対仕訳の起票を行います。</p>
        </div>
        <Link to="/journal-entries/new" className="btn-primary">
          <Plus className="h-4 w-4" />
          新規起票
        </Link>
      </div>

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">ステータス</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as JournalEntryStatus | '')}
            className="rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="">すべて</option>
            {statusOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">伝票日付(開始)</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">伝票日付(終了)</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <button type="button" className="btn-secondary" onClick={handleFilterSubmit}>
          検索
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-4 py-3 font-medium">伝票番号</th>
              <th className="px-4 py-3 font-medium">伝票日付</th>
              <th className="px-4 py-3 font-medium">摘要</th>
              <th className="px-4 py-3 font-medium">ステータス</th>
              <th className="px-4 py-3 text-right font-medium">借方合計</th>
              <th className="px-4 py-3 text-right font-medium">貸方合計</th>
              <th className="px-4 py-3 font-medium">アクション</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-surface-500">
                  読み込み中…
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-negative">
                  仕訳一覧の取得に失敗しました
                </td>
              </tr>
            )}
            {!isLoading && !isError && entries.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-surface-500">
                  該当する仕訳がありません
                </td>
              </tr>
            )}
            {entries.map((entry) => {
              const { debit, credit } = lineTotals(entry);
              return (
                <tr
                  key={entry.id}
                  className="border-b border-surface-800/60 transition-colors hover:bg-surface-850/60"
                >
                  <td className="px-4 py-3 font-mono text-xs text-surface-300">
                    <Link to={`/journal-entries/${entry.id}`} className="hover:text-brand-300">
                      {entry.entry_no}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-surface-200">{entry.entry_date}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-surface-300">
                    {entry.description || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={entry.status as JournalEntryStatus} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-surface-200">
                    {currencyFormatter.format(debit)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-surface-200">
                    {currencyFormatter.format(credit)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        className="rounded-md p-1.5 text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-100"
                        title="詳細閲覧"
                        onClick={() => navigate(`/journal-entries/${entry.id}`)}
                      >
                        詳細
                      </button>
                      {entry.status === 'draft' && (
                        <button
                          type="button"
                          className="rounded-md p-1.5 text-positive transition-colors hover:bg-positive-subtle"
                          title="確定"
                          disabled={postMutation.isPending}
                          onClick={() => postMutation.mutate(entry.id as string)}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                      )}
                      {entry.status === 'posted' && (
                        <>
                          <button
                            type="button"
                            className="rounded-md p-1.5 text-negative transition-colors hover:bg-negative-subtle"
                            title="Void(即時取消)"
                            onClick={() => setPendingAction({ type: 'void', entry })}
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="rounded-md p-1.5 text-info transition-colors hover:bg-info-subtle"
                            title="反対仕訳を起票"
                            onClick={() => setPendingAction({ type: 'reverse', entry })}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-surface-400">
        <span>
          {pagination ? `全 ${pagination.total_count} 件中 ${entries.length} 件表示` : ''}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary !px-2.5 !py-1.5"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span>
            {page} / {Math.max(totalPages, 1)}
          </span>
          <button
            type="button"
            className="btn-secondary !px-2.5 !py-1.5"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {pendingAction && (
        <ActionReasonDialog
          mode={pendingAction.type}
          entryNo={pendingAction.entry.entry_no ?? ''}
          isSubmitting={isActionSubmitting}
          onCancel={() => setPendingAction(null)}
          onConfirm={handleConfirmAction}
        />
      )}
    </div>
  );
}
