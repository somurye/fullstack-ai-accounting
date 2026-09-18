import { useEffect, useState } from 'react';
import {
  Briefcase,
  Clock,
  ExternalLink,
  FileCheck,
  RefreshCw,
  ScrollText,
  ShieldAlert,
  ShoppingCart,
  TrendingUp,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { executiveDashboardApi } from './executiveDashboardApi';
import type { ExecutiveDashboardSummary } from './types';

const currencyFormatter = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
});

export function ExecutiveDashboardPage() {
  const [summary, setSummary] = useState<ExecutiveDashboardSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const fetchSummary = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await executiveDashboardApi.getSummary();
      setSummary(data);
      setLastRefreshed(new Date());
    } catch (err: any) {
      if (err.response?.status === 403) {
        setError('エグゼクティブダッシュボードを閲覧する権限がありません (403 Forbidden)');
      } else {
        setError(err.message || 'ダッシュボードデータの取得に失敗しました');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  return (
    <div className="space-y-6">
      {/* ページヘッダー */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-50 flex items-center gap-2">
            全社横断KPIエグゼクティブダッシュボード
          </h1>
          <p className="mt-1 text-sm text-surface-400">
            Phase 0〜4（承認・契約・購買・労務・営業）の主要KPIを一元統合表示し、全社状況を俯瞰します。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-surface-500">
            最終更新: {lastRefreshed.toLocaleTimeString('ja-JP')}
          </span>
          <button
            onClick={fetchSummary}
            disabled={loading}
            className="btn btn-secondary inline-flex items-center gap-1.5 text-sm"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            更新
          </button>
        </div>
      </div>

      {error && (
        <div className="card border-negative/30 bg-negative/10 p-4 text-sm text-negative flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !summary && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5].map((idx) => (
            <div key={idx} className="card p-6 animate-pulse space-y-4">
              <div className="h-6 bg-surface-700/50 rounded w-1/3"></div>
              <div className="h-10 bg-surface-700/30 rounded w-2/3"></div>
              <div className="h-16 bg-surface-700/20 rounded"></div>
            </div>
          ))}
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* 1. 承認ワークフロー (Phase 0) */}
          {summary.approvals ? (
            <div className="card p-6 flex flex-col justify-between hover:border-primary/50 transition-colors shadow-sm">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-warning/10 text-warning rounded-lg">
                      <ScrollText className="h-5 w-5" />
                    </div>
                    <h2 className="font-semibold text-surface-100">承認ワークフロー</h2>
                  </div>
                  <span className="badge badge-pending">進行中</span>
                </div>

                <div>
                  <p className="text-xs text-surface-400">現在承認待ちの申請</p>
                  <p className="text-3xl font-bold text-surface-50 mt-1">
                    {summary.approvals.pending_total_count}
                    <span className="text-sm font-normal text-surface-400 ml-1">件</span>
                  </p>
                </div>

                <div className="border-t border-surface-700/60 pt-3 space-y-1.5 text-xs text-surface-300">
                  <div className="flex justify-between">
                    <span>契約書承認:</span>
                    <span className="font-medium text-surface-100">
                      {summary.approvals.pending_by_target.contract} 件
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>購買・発注申請:</span>
                    <span className="font-medium text-surface-100">
                      {summary.approvals.pending_by_target.purchase_request} 件
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>一般稟議:</span>
                    <span className="font-medium text-surface-100">
                      {summary.approvals.pending_by_target.general_request} 件
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-3 border-t border-surface-700/60">
                <Link
                  to="/approval-requests"
                  className="text-xs text-primary hover:text-primary-focus inline-flex items-center gap-1 font-medium"
                >
                  承認インボックスを開く <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </div>
          ) : (
            <div className="card p-6 border-dashed border-surface-700/60 bg-surface-800/30 flex flex-col items-center justify-center text-center text-surface-500">
              <ScrollText className="h-8 w-8 mb-2 opacity-40" />
              <p className="text-sm font-medium">承認ワークフロー</p>
              <p className="text-xs mt-1">閲覧権限がありません</p>
            </div>
          )}

          {/* 2. 契約・更新期限 (Phase 1) */}
          {summary.contracts ? (
            <div className="card p-6 flex flex-col justify-between hover:border-primary/50 transition-colors shadow-sm">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-info/10 text-info rounded-lg">
                      <FileCheck className="h-5 w-5" />
                    </div>
                    <h2 className="font-semibold text-surface-100">契約管理・更新期限</h2>
                  </div>
                  <span className="badge badge-posted">有効</span>
                </div>

                <div>
                  <p className="text-xs text-surface-400">有効管理契約数</p>
                  <p className="text-3xl font-bold text-surface-50 mt-1">
                    {summary.contracts.active_contracts_count}
                    <span className="text-sm font-normal text-surface-400 ml-1">件</span>
                  </p>
                </div>

                <div className="border-t border-surface-700/60 pt-3 space-y-1.5 text-xs text-surface-300">
                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-warning" /> 更新予告期間内:
                    </span>
                    <span className="font-semibold text-warning">
                      {summary.contracts.expiring_soon_count} 件
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>30日以内満了:</span>
                    <span className="font-medium text-surface-100">
                      {summary.contracts.expiring_within_30_days} 件
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>60日以内満了:</span>
                    <span className="font-medium text-surface-100">
                      {summary.contracts.expiring_within_60_days} 件
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-3 border-t border-surface-700/60">
                <Link
                  to="/contracts"
                  className="text-xs text-primary hover:text-primary-focus inline-flex items-center gap-1 font-medium"
                >
                  契約書管理一覧へ <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </div>
          ) : (
            <div className="card p-6 border-dashed border-surface-700/60 bg-surface-800/30 flex flex-col items-center justify-center text-center text-surface-500">
              <FileCheck className="h-8 w-8 mb-2 opacity-40" />
              <p className="text-sm font-medium">契約管理・更新期限</p>
              <p className="text-xs mt-1">閲覧権限がありません</p>
            </div>
          )}

          {/* 3. 購買・調達 (Phase 2) */}
          {summary.purchase ? (
            <div className="card p-6 flex flex-col justify-between hover:border-primary/50 transition-colors shadow-sm">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-success/10 text-success rounded-lg">
                      <ShoppingCart className="h-5 w-5" />
                    </div>
                    <h2 className="font-semibold text-surface-100">購買・調達</h2>
                  </div>
                  <span className="badge badge-posted">概況</span>
                </div>

                <div>
                  <p className="text-xs text-surface-400">現在稟議中の発注金額</p>
                  <p className="text-2xl font-bold text-surface-50 mt-1">
                    {currencyFormatter.format(summary.purchase.pending_approval_amount)}
                  </p>
                  <p className="text-xs text-surface-400 mt-0.5">
                    ({summary.purchase.pending_approval_count} 件の申請中)
                  </p>
                </div>

                <div className="border-t border-surface-700/60 pt-3 space-y-1.5 text-xs text-surface-300">
                  <div className="flex justify-between">
                    <span>今月の確定発注額:</span>
                    <span className="font-medium text-surface-100">
                      {currencyFormatter.format(summary.purchase.current_month_order_amount)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>検収・受領待ち:</span>
                    <span className="font-medium text-surface-100">
                      {summary.purchase.pending_receipts_count} 件
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-3 border-t border-surface-700/60">
                <Link
                  to="/purchase-dashboard"
                  className="text-xs text-primary hover:text-primary-focus inline-flex items-center gap-1 font-medium"
                >
                  購買ダッシュボードへ <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </div>
          ) : (
            <div className="card p-6 border-dashed border-surface-700/60 bg-surface-800/30 flex flex-col items-center justify-center text-center text-surface-500">
              <ShoppingCart className="h-8 w-8 mb-2 opacity-40" />
              <p className="text-sm font-medium">購買・調達</p>
              <p className="text-xs mt-1">閲覧権限がありません</p>
            </div>
          )}

          {/* 4. 人事労務 (Phase 3) */}
          {summary.hr ? (
            <div className="card p-6 flex flex-col justify-between hover:border-primary/50 transition-colors shadow-sm">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-purple-500/10 text-purple-400 rounded-lg">
                      <Users className="h-5 w-5" />
                    </div>
                    <h2 className="font-semibold text-surface-100">人事労務</h2>
                  </div>
                  <span className="badge badge-posted">労務概況</span>
                </div>

                <div>
                  <p className="text-xs text-surface-400">在籍従業員数</p>
                  <p className="text-3xl font-bold text-surface-50 mt-1">
                    {summary.hr.active_employees_count}
                    <span className="text-sm font-normal text-surface-400 ml-1">名</span>
                  </p>
                </div>

                <div className="border-t border-surface-700/60 pt-3 space-y-1.5 text-xs text-surface-300">
                  <div className="flex justify-between items-center">
                    <span>打刻漏れ・未退勤:</span>
                    <span
                      className={`font-semibold ${
                        summary.hr.unresolved_attendance_count > 0
                          ? 'text-negative'
                          : 'text-surface-100'
                      }`}
                    >
                      {summary.hr.unresolved_attendance_count} 件
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>勤怠承認待ち:</span>
                    <span className="font-medium text-surface-100">
                      {summary.hr.pending_attendance_approvals} 件
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>当月残業超過(45h超):</span>
                    <span
                      className={`font-semibold ${
                        summary.hr.overtime_alert_count > 0 ? 'text-warning' : 'text-surface-100'
                      }`}
                    >
                      {summary.hr.overtime_alert_count} 名
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-3 border-t border-surface-700/60">
                <Link
                  to="/attendance"
                  className="text-xs text-primary hover:text-primary-focus inline-flex items-center gap-1 font-medium"
                >
                  勤怠管理へ <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </div>
          ) : (
            <div className="card p-6 border-dashed border-surface-700/60 bg-surface-800/30 flex flex-col items-center justify-center text-center text-surface-500">
              <Users className="h-8 w-8 mb-2 opacity-40" />
              <p className="text-sm font-medium">人事労務</p>
              <p className="text-xs mt-1">閲覧権限がありません</p>
            </div>
          )}

          {/* 5. 営業事務 (Phase 4) */}
          {summary.sales ? (
            <div className="card p-6 flex flex-col justify-between hover:border-primary/50 transition-colors shadow-sm">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg">
                      <Briefcase className="h-5 w-5" />
                    </div>
                    <h2 className="font-semibold text-surface-100">営業パイプライン</h2>
                  </div>
                  <span className="badge badge-posted">商談進捗</span>
                </div>

                <div>
                  <p className="text-xs text-surface-400">進行中商談見込金額</p>
                  <p className="text-2xl font-bold text-surface-50 mt-1">
                    {currencyFormatter.format(summary.sales.open_deals_amount)}
                  </p>
                  <p className="text-xs text-surface-400 mt-0.5">
                    ({summary.sales.open_deals_count} 件の進行中案件)
                  </p>
                </div>

                <div className="border-t border-surface-700/60 pt-3 space-y-1.5 text-xs text-surface-300">
                  <div className="flex justify-between items-center">
                    <span className="flex items-center gap-1">
                      <TrendingUp className="h-3 w-3 text-emerald-400" /> 案件勝率:
                    </span>
                    <span className="font-semibold text-emerald-400">
                      {(summary.sales.win_rate * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>見積成約率:</span>
                    <span className="font-medium text-surface-100">
                      {(summary.sales.quotation_conversion_rate * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>契約更新起票率:</span>
                    <span className="font-medium text-surface-100">
                      {(summary.sales.renewal_proposal_rate * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-3 border-t border-surface-700/60">
                <Link
                  to="/sales-dashboard"
                  className="text-xs text-primary hover:text-primary-focus inline-flex items-center gap-1 font-medium"
                >
                  営業ダッシュボードへ <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </div>
          ) : (
            <div className="card p-6 border-dashed border-surface-700/60 bg-surface-800/30 flex flex-col items-center justify-center text-center text-surface-500">
              <Briefcase className="h-8 w-8 mb-2 opacity-40" />
              <p className="text-sm font-medium">営業パイプライン</p>
              <p className="text-xs mt-1">閲覧権限がありません</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
