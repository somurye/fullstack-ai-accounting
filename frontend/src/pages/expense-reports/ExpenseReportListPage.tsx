import { CheckCircle2, Plus, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { ApproveRejectDialog } from './ApproveRejectDialog';
import { StatusBadge } from './StatusBadge';
import { useApproveExpenseReport, useExpenseReports, useRejectExpenseReport } from './hooks';
import type { ExpenseReportDetail, ExpenseReportListParams, ExpenseReportStatus } from './types';

const PAGE_SIZE = 20;
const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

type TabKey = 'mine' | 'pending' | 'approved';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'mine', label: '自分の申請' },
  { key: 'pending', label: '未承認(承認待ち)' },
  { key: 'approved', label: '精算済み' },
];

type PendingAction = { type: 'approve' | 'reject'; report: ExpenseReportDetail } | null;

export function ExpenseReportListPage() {
  const navigate = useNavigate();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const [tab, setTab] = useState<TabKey>('mine');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const listParams = useMemo<ExpenseReportListParams>(() => {
    const base: ExpenseReportListParams = { page: 1, page_size: PAGE_SIZE };
    if (tab === 'mine') return { ...base, submitted_by: currentUserId };
    if (tab === 'pending') return { ...base, pending_approval: true };
    return { ...base, status: 'approved' };
  }, [tab, currentUserId]);

  const { data, isLoading, isError } = useExpenseReports(listParams);
  const approveMutation = useApproveExpenseReport();
  const rejectMutation = useRejectExpenseReport();

  const reports = data?.reports ?? [];
  const isActionSubmitting = approveMutation.isPending || rejectMutation.isPending;

  const handleConfirmAction = (comment: string): void => {
    if (!pendingAction) return;
    const id = pendingAction.report.id as string;
    if (pendingAction.type === 'approve') {
      approveMutation.mutate({ id, comment: comment || undefined }, { onSuccess: () => setPendingAction(null) });
    } else {
      rejectMutation.mutate({ id, comment }, { onSuccess: () => setPendingAction(null) });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-surface-50">経費精算</h1>
          <p className="mt-1 text-sm text-surface-400">経費申請の提出・承認・却下を行います。</p>
        </div>
        <Link to="/expense-reports/new" className="btn-primary">
          <Plus className="h-4 w-4" />
          新規申請
        </Link>
      </div>

      <div className="flex gap-1 border-b border-surface-800">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'border-b-2 border-brand-500 text-brand-300'
                : 'text-surface-400 hover:text-surface-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-4 py-3 font-medium">申請番号</th>
              <th className="px-4 py-3 font-medium">目的</th>
              <th className="px-4 py-3 font-medium">ステータス</th>
              <th className="px-4 py-3 text-right font-medium">合計金額</th>
              <th className="px-4 py-3 font-medium">アクション</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-surface-500">
                  読み込み中…
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-negative">
                  経費申請一覧の取得に失敗しました
                </td>
              </tr>
            )}
            {!isLoading && !isError && reports.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-surface-500">
                  該当する経費申請がありません
                </td>
              </tr>
            )}
            {reports.map((report) => {
              const canReview =
                tab === 'pending' &&
                report.submitted_by !== currentUserId &&
                (report.status === 'submitted' || report.status === 'in_review');
              return (
                <tr
                  key={report.id}
                  className="border-b border-surface-800/60 transition-colors hover:bg-surface-850/60"
                >
                  <td className="px-4 py-3 font-mono text-xs text-surface-300">
                    <Link to={`/expense-reports/${report.id}`} className="hover:text-brand-300">
                      {report.report_no}
                    </Link>
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-surface-300">{report.purpose || '—'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={report.status as ExpenseReportStatus} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-surface-200">
                    {currencyFormatter.format(report.total_amount ?? 0)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        className="rounded-md p-1.5 text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-100"
                        onClick={() => navigate(`/expense-reports/${report.id}`)}
                      >
                        詳細
                      </button>
                      {canReview && (
                        <>
                          <button
                            type="button"
                            className="rounded-md p-1.5 text-positive transition-colors hover:bg-positive-subtle"
                            title="承認"
                            onClick={() => setPendingAction({ type: 'approve', report })}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="rounded-md p-1.5 text-negative transition-colors hover:bg-negative-subtle"
                            title="却下"
                            onClick={() => setPendingAction({ type: 'reject', report })}
                          >
                            <XCircle className="h-4 w-4" />
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

      {pendingAction && (
        <ApproveRejectDialog
          mode={pendingAction.type}
          reportNo={pendingAction.report.report_no ?? ''}
          isSubmitting={isActionSubmitting}
          onCancel={() => setPendingAction(null)}
          onConfirm={handleConfirmAction}
        />
      )}
    </div>
  );
}
