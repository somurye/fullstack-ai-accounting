import { Clock, FileText, ScrollText, TrendingDown, TrendingUp } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useApprovalRequests } from './approval-requests/hooks';
import { TARGET_TYPE_LABEL } from './approval-requests/types';
import { MonthlyTrendChart } from './dashboard/MonthlyTrendChart';
import { useDashboardSummary } from './dashboard/hooks';
import type { DashboardRecentActivity } from './dashboard/types';

const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

const STATUS_LABEL: Record<string, string> = {
  draft: '下書き',
  pending_approval: '承認待ち',
  submitted: '申請済み',
  in_review: '審査中',
  posted: '確定済み',
  approved: '承認済み',
  rejected: '却下',
  voided: '取消済み',
  reversed: '反転仕訳',
  reimbursement_scheduled: '払戻予定',
  reimbursed: '払戻済み',
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  draft: 'badge-draft',
  pending_approval: 'badge-pending',
  submitted: 'badge-pending',
  in_review: 'badge-pending',
  posted: 'badge-posted',
  approved: 'badge-posted',
  reimbursement_scheduled: 'badge-pending',
  reimbursed: 'badge-posted',
  rejected: 'badge-rejected',
  voided: 'badge-void',
  reversed: 'badge-reversed',
};

const ACTIVITY_TYPE_LABEL: Record<DashboardRecentActivity['type'] & string, string> = {
  expense_report: '経費精算',
  journal_entry: '仕訳',
};

/** 変化率(%)。基準値が0の場合は比較不能として`null`を返す。 */
function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

interface DeltaBadgeProps {
  current: number;
  previous: number;
  /** true: 増加が好ましい指標(売上・純利益)、false: 増加が好ましくない指標(費用) */
  increaseIsGood: boolean;
}

function DeltaBadge({ current, previous, increaseIsGood }: DeltaBadgeProps) {
  const pct = percentChange(current, previous);
  if (pct === null) {
    return <span className="text-xs text-surface-500">前月比データなし</span>;
  }
  const isIncrease = pct >= 0;
  const isFavorable = isIncrease === increaseIsGood;
  const Icon = isIncrease ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${isFavorable ? 'text-positive' : 'text-negative'}`}>
      <Icon className="h-3.5 w-3.5" />
      前月比 {isIncrease ? '+' : ''}
      {pct.toFixed(1)}%
    </span>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { data: summary, isLoading, isError } = useDashboardSummary();
  const pendingApprovalsQuery = useApprovalRequests({ pending_for_me: true, page_size: 5 });
  const pendingApprovals = pendingApprovalsQuery.data?.requests ?? [];

  const netIncome = summary?.current_month_net_income ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-surface-50">ダッシュボード</h1>
        <p className="mt-1 text-sm text-surface-400">経理・会計オールインワンAIアプリケーションへようこそ。</p>
      </div>

      {isError && (
        <div className="card p-4 text-sm text-negative">ダッシュボードデータの取得に失敗しました。</div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-surface-500">当月売上高</p>
            <TrendingUp className="h-4 w-4 text-info" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-surface-50">
            {isLoading ? '—' : currencyFormatter.format(summary?.current_month_revenue ?? 0)}
          </p>
          <div className="mt-1.5">
            {!isLoading && summary && (
              <DeltaBadge
                current={summary.current_month_revenue ?? 0}
                previous={summary.previous_month_revenue ?? 0}
                increaseIsGood
              />
            )}
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-surface-500">当月費用</p>
            <FileText className="h-4 w-4 text-negative" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-surface-50">
            {isLoading ? '—' : currencyFormatter.format(summary?.current_month_expense ?? 0)}
          </p>
          <div className="mt-1.5">
            {!isLoading && summary && (
              <DeltaBadge
                current={summary.current_month_expense ?? 0}
                previous={summary.previous_month_expense ?? 0}
                increaseIsGood={false}
              />
            )}
          </div>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-surface-500">当月純利益</p>
            {netIncome >= 0 ? (
              <TrendingUp className="h-4 w-4 text-positive" />
            ) : (
              <TrendingDown className="h-4 w-4 text-negative" />
            )}
          </div>
          <p className={`mt-2 text-2xl font-semibold ${netIncome >= 0 ? 'text-surface-50' : 'text-negative'}`}>
            {isLoading ? '—' : currencyFormatter.format(netIncome)}
          </p>
          <div className="mt-1.5">
            {!isLoading && summary && (
              <DeltaBadge
                current={summary.current_month_net_income ?? 0}
                previous={summary.previous_month_net_income ?? 0}
                increaseIsGood
              />
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate('/approval-requests')}
          className="card p-4 text-left transition-colors hover:bg-surface-850"
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-surface-500">未承認タスク件数</p>
            <Clock className="h-4 w-4 text-warning" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-surface-50">
            {isLoading ? '—' : (summary?.pending_approvals_count ?? 0)}
          </p>
          <p className="mt-1.5 text-xs text-brand-300">承認インボックスへ →</p>
        </button>
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-surface-100">月次損益推移(直近12ヶ月)</h2>
        <p className="mt-0.5 text-xs text-surface-500">確定済み仕訳(posted)に基づくリアルタイム集計です。</p>
        <div className="mt-4">
          {isLoading ? (
            <div className="flex h-72 items-center justify-center text-sm text-surface-500">読み込み中…</div>
          ) : (
            <MonthlyTrendChart data={summary?.monthly_trends ?? []} />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-surface-100">
              <Clock className="h-4 w-4 text-warning" />
              承認待ちタスク
            </h2>
            <Link to="/approval-requests" className="text-xs font-medium text-brand-300 hover:text-brand-200">
              すべて見る →
            </Link>
          </div>
          {pendingApprovalsQuery.isLoading && <p className="text-sm text-surface-500">読み込み中…</p>}
          {!pendingApprovalsQuery.isLoading && pendingApprovals.length === 0 && (
            <p className="text-sm text-surface-500">承認待ちのタスクはありません</p>
          )}
          <ul className="space-y-2">
            {pendingApprovals.map((request) => (
              <li key={request.id}>
                <button
                  type="button"
                  onClick={() => navigate('/approval-requests')}
                  className="flex w-full items-center justify-between rounded-lg border border-surface-800 bg-surface-850/40 px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface-850"
                >
                  <span className="text-surface-200">
                    {TARGET_TYPE_LABEL[request.target_type as keyof typeof TARGET_TYPE_LABEL] ?? request.target_type}
                    <span className="ml-2 text-xs text-surface-500">
                      ステップ {request.current_step} / {request.total_steps}
                    </span>
                  </span>
                  <span className="badge-pending">承認待ち</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-surface-100">
            <ScrollText className="h-4 w-4 text-brand-400" />
            直近のアクティビティ
          </h2>
          {isLoading && <p className="text-sm text-surface-500">読み込み中…</p>}
          {!isLoading && (summary?.recent_activities ?? []).length === 0 && (
            <p className="text-sm text-surface-500">直近のアクティビティはありません</p>
          )}
          <ul className="space-y-2">
            {(summary?.recent_activities ?? []).map((activity) => (
              <li
                key={`${activity.type}-${activity.id}`}
                className="flex items-center justify-between rounded-lg border border-surface-800 bg-surface-850/40 px-3 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate text-surface-200">
                    <span className="mr-2 text-xs text-surface-500">
                      {activity.type ? ACTIVITY_TYPE_LABEL[activity.type] : ''}
                    </span>
                    {activity.title}
                  </p>
                  <p className="mt-0.5 text-xs text-surface-500">
                    {activity.created_at && new Date(activity.created_at).toLocaleString('ja-JP')}
                  </p>
                </div>
                <div className="ml-3 flex shrink-0 items-center gap-3">
                  <span className="tabular-nums text-surface-100">
                    {currencyFormatter.format(activity.amount ?? 0)}
                  </span>
                  <span className={(activity.status && STATUS_BADGE_CLASS[activity.status]) || 'badge-draft'}>
                    {(activity.status && STATUS_LABEL[activity.status]) || activity.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
