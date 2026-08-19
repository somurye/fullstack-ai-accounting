import { Receipt } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useExpenseReports } from '../expense-reports/hooks';
import { StatusBadge } from '../expense-reports/StatusBadge';

const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });
const dateFormatter = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium' });

/**
 * MobileMyApplicationsPage
 * =========================
 * 自分が申請した経費精算の履歴一覧(スマホ向け縦1カラムのカード表示)。
 * PC版の`ExpenseReportListPage`と異なり、承認/却下操作は持たない
 * (それらはPCの承認待ち画面の役割であり、一般社員のスマホ画面では
 * 自分の申請状況の確認のみに用途を絞る)。
 */
export function MobileMyApplicationsPage() {
  const navigate = useNavigate();
  const currentUserId = useAuthStore((state) => state.user?.id);

  const { data, isLoading } = useExpenseReports({
    submitted_by: currentUserId,
    page_size: 50,
  });
  const reports = data?.reports ?? [];

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 pb-4">
      <h1 className="text-base font-semibold text-surface-50">申請履歴</h1>

      {isLoading && <p className="text-sm text-surface-400">読み込み中…</p>}

      {!isLoading && reports.length === 0 && (
        <div className="card flex flex-col items-center gap-3 p-8 text-center">
          <Receipt className="h-8 w-8 text-surface-600" />
          <p className="text-sm text-surface-500">まだ申請はありません</p>
          <button type="button" className="btn-primary min-h-[48px]" onClick={() => navigate('/mobile/expense-apply')}>
            経費申請を作成する
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {reports.map((report) => (
          <div key={report.id} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-surface-100">{report.purpose || report.report_no}</p>
                <p className="mt-0.5 text-xs text-surface-500">{report.report_no}</p>
              </div>
              {report.status && <StatusBadge status={report.status} />}
            </div>
            <div className="mt-3 flex items-end justify-between">
              <span className="text-xs text-surface-500">
                {report.lines?.[0]?.expense_date ? dateFormatter.format(new Date(report.lines[0].expense_date)) : '—'}
              </span>
              <span className="text-lg font-semibold tabular-nums text-surface-100">
                {currencyFormatter.format(report.total_amount ?? 0)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
