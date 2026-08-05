import { CheckCircle2, ScrollText, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '../../components/ui/Modal';
import { useAuthStore } from '../../stores/authStore';
import { ApproveRejectDialog } from '../expense-reports/ApproveRejectDialog';
import { fetchExpenseReport } from '../expense-reports/api';
import { fetchJournalEntry } from '../journal-entries/api';
import { fetchVendorBill } from '../vendor-bills/api';
import { useApprovalRequests, useApproveApprovalRequest, useRejectApprovalRequest } from './hooks';
import { TARGET_TYPE_LABEL } from './types';
import type { ApprovalRequest } from './types';

const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

type TabKey = 'pending_for_me' | 'mine' | 'history';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'pending_for_me', label: '承認待ち(自分宛)' },
  { key: 'mine', label: '自分が申請' },
  { key: 'history', label: '完了済み' },
];

const STATUS_LABEL: Record<string, string> = { pending: '承認待ち', approved: '承認済み', rejected: '却下' };
const STATUS_BADGE: Record<string, string> = {
  pending: 'badge-pending',
  approved: 'badge-posted',
  rejected: 'badge-rejected',
};

type PendingAction = { type: 'approve' | 'reject'; request: ApprovalRequest } | null;

/** 対象種別ごとに対象データの要約(金額・件名)を取得して表示する */
function TargetSummary({ request }: { request: ApprovalRequest }) {
  const targetType = request.target_type;
  const targetId = request.target_id;

  const journalEntryQuery = useQuery({
    queryKey: ['approval-target', 'journal_entry', targetId],
    queryFn: () => fetchJournalEntry(targetId as string),
    enabled: targetType === 'journal_entry' && Boolean(targetId),
  });
  const expenseReportQuery = useQuery({
    queryKey: ['approval-target', 'expense_report', targetId],
    queryFn: () => fetchExpenseReport(targetId as string),
    enabled: targetType === 'expense_report' && Boolean(targetId),
  });
  const vendorBillQuery = useQuery({
    queryKey: ['approval-target', 'vendor_bill', targetId],
    queryFn: () => fetchVendorBill(targetId as string),
    enabled: targetType === 'vendor_bill' && Boolean(targetId),
  });

  if (targetType === 'journal_entry') {
    const entry = journalEntryQuery.data;
    if (journalEntryQuery.isLoading) return <p className="text-xs text-surface-500">読み込み中…</p>;
    if (!entry) return <p className="text-xs text-surface-500">仕訳データを取得できませんでした</p>;
    const total = (entry.lines ?? [])
      .filter((l) => l.debit_credit === 'debit')
      .reduce((sum, l) => sum + (l.amount ?? 0), 0);
    return (
      <div className="space-y-1 text-sm">
        <p className="text-surface-100">{entry.entry_no}</p>
        <p className="text-surface-400">{entry.description ?? '(摘要なし)'}</p>
        <p className="text-surface-300">金額(借方合計): {currencyFormatter.format(total)}</p>
        <p className="text-xs text-surface-500">明細行数: {entry.lines?.length ?? 0}</p>
      </div>
    );
  }

  if (targetType === 'expense_report') {
    const report = expenseReportQuery.data;
    if (expenseReportQuery.isLoading) return <p className="text-xs text-surface-500">読み込み中…</p>;
    if (!report) return <p className="text-xs text-surface-500">経費申請データを取得できませんでした</p>;
    return (
      <div className="space-y-1 text-sm">
        <p className="text-surface-100">{report.report_no}</p>
        <p className="text-surface-400">{report.purpose || '(目的未記載)'}</p>
        <p className="text-surface-300">合計金額: {currencyFormatter.format(report.total_amount ?? 0)}</p>
        <p className="text-xs text-surface-500">明細行数: {report.lines?.length ?? 0}</p>
      </div>
    );
  }

  if (targetType === 'vendor_bill') {
    const bill = vendorBillQuery.data;
    if (vendorBillQuery.isLoading) return <p className="text-xs text-surface-500">読み込み中…</p>;
    if (!bill) return <p className="text-xs text-surface-500">仕入請求書データを取得できませんでした</p>;
    return (
      <div className="space-y-1 text-sm">
        <p className="text-surface-100">{bill.bill_no}</p>
        <p className="text-surface-300">合計金額: {currencyFormatter.format(bill.total_amount ?? 0)}</p>
        <p className="text-xs text-surface-500">支払期日: {bill.due_date}</p>
      </div>
    );
  }

  return null;
}

function DetailModal({ request, onClose }: { request: ApprovalRequest; onClose: () => void }) {
  return (
    <Modal title="承認申請の詳細" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg border border-surface-800 bg-surface-900 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-surface-400">
              {TARGET_TYPE_LABEL[request.target_type as keyof typeof TARGET_TYPE_LABEL]}
            </span>
            <span className={request.status ? STATUS_BADGE[request.status] : 'badge-draft'}>
              {request.status ? STATUS_LABEL[request.status] : '—'}
            </span>
          </div>
          <TargetSummary request={request} />
          <p className="mt-2 text-xs text-surface-500">
            承認ステップ: {request.current_step} / {request.total_steps}
          </p>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold text-surface-300">承認履歴</h3>
          {(request.history ?? []).length === 0 && (
            <p className="text-xs text-surface-500">履歴はまだありません</p>
          )}
          <ul className="space-y-2">
            {(request.history ?? []).map((h) => (
              <li key={h.id} className="rounded-lg border border-surface-800 bg-surface-900 p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className={h.action === 'approve' ? 'text-positive' : 'text-negative'}>
                    ステップ{h.step_number}: {h.action === 'approve' ? '承認' : '却下'}
                  </span>
                  <span className="text-surface-500">{h.acted_at && new Date(h.acted_at).toLocaleString('ja-JP')}</span>
                </div>
                {h.comment && <p className="mt-1 text-surface-400">{h.comment}</p>}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function ApprovalRequestListPage() {
  const currentUserId = useAuthStore((state) => state.user?.id);
  const [tab, setTab] = useState<TabKey>('pending_for_me');
  const [viewing, setViewing] = useState<ApprovalRequest | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const listParams = useMemo(() => {
    if (tab === 'pending_for_me') return { page_size: 100, pending_for_me: true as const };
    return { page_size: 200 };
  }, [tab]);

  const { data, isLoading, isError } = useApprovalRequests(listParams);
  const approveMutation = useApproveApprovalRequest();
  const rejectMutation = useRejectApprovalRequest();

  const allRequests = data?.requests ?? [];
  const requests = useMemo(() => {
    if (tab === 'mine') return allRequests.filter((r) => r.submitted_by === currentUserId);
    if (tab === 'history') return allRequests.filter((r) => r.status !== 'pending');
    return allRequests;
  }, [allRequests, tab, currentUserId]);

  const isActionSubmitting = approveMutation.isPending || rejectMutation.isPending;

  const handleConfirmAction = (comment: string): void => {
    if (!pendingAction?.request.id) return;
    const id = pendingAction.request.id;
    if (pendingAction.type === 'approve') {
      approveMutation.mutate({ id, comment: comment || undefined }, { onSuccess: () => setPendingAction(null) });
    } else {
      rejectMutation.mutate({ id, comment }, { onSuccess: () => setPendingAction(null) });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-surface-50">
          <ScrollText className="h-5 w-5 text-brand-400" />
          承認インボックス
        </h1>
        <p className="mt-1 text-sm text-surface-400">
          仕訳・経費精算・仕入請求書にまたがる承認依頼を横断的に確認・処理します。
        </p>
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
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-4 py-3 font-medium">対象種別</th>
              <th className="px-4 py-3 font-medium">承認ステップ</th>
              <th className="px-4 py-3 font-medium">ステータス</th>
              <th className="px-4 py-3 font-medium">アクション</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-surface-500">
                  読み込み中…
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-negative">
                  承認依頼一覧の取得に失敗しました
                </td>
              </tr>
            )}
            {!isLoading && !isError && requests.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-surface-500">
                  該当する承認依頼がありません
                </td>
              </tr>
            )}
            {requests.map((request) => {
              const canReview = tab === 'pending_for_me' && request.status === 'pending';
              return (
                <tr key={request.id} className="border-b border-surface-800/60 hover:bg-surface-850/60">
                  <td className="px-4 py-3 text-surface-100">
                    <button type="button" className="hover:text-brand-300" onClick={() => setViewing(request)}>
                      {TARGET_TYPE_LABEL[request.target_type as keyof typeof TARGET_TYPE_LABEL]}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-surface-300">
                    {request.current_step} / {request.total_steps}
                  </td>
                  <td className="px-4 py-3">
                    <span className={request.status ? STATUS_BADGE[request.status] : 'badge-draft'}>
                      {request.status ? STATUS_LABEL[request.status] : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        className="rounded-md p-1.5 text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-100"
                        onClick={() => setViewing(request)}
                      >
                        詳細
                      </button>
                      {canReview && (
                        <>
                          <button
                            type="button"
                            className="rounded-md p-1.5 text-positive transition-colors hover:bg-positive-subtle"
                            title="承認"
                            onClick={() => setPendingAction({ type: 'approve', request })}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="rounded-md p-1.5 text-negative transition-colors hover:bg-negative-subtle"
                            title="却下"
                            onClick={() => setPendingAction({ type: 'reject', request })}
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

      {viewing && <DetailModal request={viewing} onClose={() => setViewing(null)} />}

      {pendingAction && (
        <ApproveRejectDialog
          mode={pendingAction.type}
          reportNo={`${TARGET_TYPE_LABEL[pendingAction.request.target_type as keyof typeof TARGET_TYPE_LABEL]} (${pendingAction.request.target_id})`}
          isSubmitting={isActionSubmitting}
          onCancel={() => setPendingAction(null)}
          onConfirm={handleConfirmAction}
          titleOverride={{ approve: '承認申請を承認', reject: '承認申請を却下' }}
        />
      )}
    </div>
  );
}
