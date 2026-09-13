import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Building2,
  Calendar,
  Clock,
  Package,
  Plus,
  RefreshCw,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import {
  STATUS_LABELS,
  type MonthlyTrendItem,
  type PurchaseDashboardSummary,
  type PurchaseRequestStatus,
} from './types';

const currencyFormatter = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
});

const compactYen = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/**
 * 月次推移チャート (軽量SVG描画・外部依存ゼロ)
 */
function PurchaseMonthlyTrendChart({ data }: { data: MonthlyTrendItem[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-surface-500">
        データがありません
      </div>
    );
  }

  const WIDTH = 680;
  const HEIGHT = 260;
  const MARGIN = { top: 20, right: 20, bottom: 32, left: 60 };
  const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
  const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

  const maxVal = Math.max(1, ...data.map((d) => Math.max(d.total_amount, d.active_amount)));

  const slotWidth = PLOT_WIDTH / data.length;
  const barWidth = Math.min(28, slotWidth * 0.45);

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-64 w-full min-w-[500px]"
      >
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {/* Y軸グリッド線 & ラベル */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = PLOT_HEIGHT * (1 - ratio);
            const val = maxVal * ratio;
            return (
              <g key={ratio}>
                <line
                  x1={0}
                  y1={y}
                  x2={PLOT_WIDTH}
                  y2={y}
                  stroke="currentColor"
                  className="text-surface-800"
                  strokeDasharray="4 4"
                />
                <text
                  x={-8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-surface-500 text-[10px]"
                >
                  {compactYen.format(val)}
                </text>
              </g>
            );
          })}

          {/* 棒グラフ (月別) */}
          {data.map((d, i) => {
            const xCenter = slotWidth * i + slotWidth / 2;
            const x = xCenter - barWidth / 2;
            const hTotal = Math.max(0, (d.total_amount / maxVal) * PLOT_HEIGHT);
            const hActive = Math.max(0, (d.active_amount / maxVal) * PLOT_HEIGHT);
            const yTotal = PLOT_HEIGHT - hTotal;
            const yActive = PLOT_HEIGHT - hActive;

            return (
              <g key={d.month} className="group cursor-pointer">
                {/* 全体申請額バー (薄い背景) */}
                <rect
                  x={x}
                  y={yTotal}
                  width={barWidth}
                  height={hTotal}
                  rx={3}
                  className="fill-surface-700/60 transition-colors group-hover:fill-surface-600/70"
                />
                {/* 確定発注額バー (エメラルド) */}
                <rect
                  x={x}
                  y={yActive}
                  width={barWidth}
                  height={hActive}
                  rx={3}
                  className="fill-emerald-500/80 transition-colors group-hover:fill-emerald-400"
                />
                {/* X軸ラベル */}
                <text
                  x={xCenter}
                  y={PLOT_HEIGHT + 18}
                  textAnchor="middle"
                  className="fill-surface-400 text-[11px]"
                >
                  {d.month.slice(2)}
                </text>
                {/* ホバー時件数 */}
                <title>{`${d.month}\n確定発注額: ${currencyFormatter.format(d.active_amount)}\n全体申請額: ${currencyFormatter.format(d.total_amount)}\n件数: ${d.request_count}件`}</title>
              </g>
            );
          })}
        </g>
      </svg>
      {/* 凡例 */}
      <div className="mt-2 flex items-center justify-center gap-6 text-xs text-surface-400">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-emerald-500" />
          <span>確定発注額 (active)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm bg-surface-700" />
          <span>全体起票額 (全ステータス)</span>
        </div>
      </div>
    </div>
  );
}

export function PurchaseDashboardPage() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<PurchaseDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSummary = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await apiClient.get<{ data: PurchaseDashboardSummary }>(
        '/purchase-dashboard/summary',
        { params: { supplier_limit: 5 } },
      );
      setSummary(res.data.data);
    } catch (err) {
      toast.error('購買ダッシュボードデータの取得に失敗しました');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  const totalStatusAmount = summary?.status_counts.total.total_amount || 1;

  return (
    <div className="space-y-6 pb-12">
      {/* ヘッダーエリア */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-surface-50">購買ダッシュボード</h1>
            <span className="rounded-md border border-emerald-800/60 bg-emerald-950/40 px-2 py-0.5 text-xs font-medium text-emerald-400">
              Phase 2
            </span>
          </div>
          <p className="mt-1 text-sm text-surface-400">
            発注申請・サプライヤー・検収状況・支払連携の全体サマリー
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchSummary(true)}
            disabled={refreshing || loading}
            className="btn-secondary flex items-center gap-1.5 text-xs"
            title="データを再読み込み"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            更新
          </button>
          <Link
            to="/purchase-requests"
            className="btn-secondary flex items-center gap-1.5 text-xs"
          >
            <ShoppingCart className="h-3.5 w-3.5" />
            発注申請一覧
          </Link>
          <button
            type="button"
            onClick={() => navigate('/purchase-requests/new')}
            className="btn-primary flex items-center gap-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            新規発注申請
          </button>
        </div>
      </div>

      {/* KPIカード グリッド (4枚) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* 1. 今期確定発注額 */}
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-surface-400">今期確定発注額</span>
            <div className="rounded-lg bg-emerald-950/60 p-2 text-emerald-400 border border-emerald-800/40">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-surface-50">
            {loading ? '—' : currencyFormatter.format(summary?.amount_summary.current_period_active_amount ?? 0)}
          </p>
          <div className="mt-2 flex items-center justify-between text-xs text-surface-400">
            <span>{summary?.amount_summary.current_period_label || '当期'}</span>
            <span className="text-surface-500">
              全体: {currencyFormatter.format(summary?.amount_summary.current_period_total_amount ?? 0)}
            </span>
          </div>
        </div>

        {/* 2. 今月確定発注額 */}
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-surface-400">今月確定発注額</span>
            <div className="rounded-lg bg-blue-950/60 p-2 text-blue-400 border border-blue-800/40">
              <Calendar className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-surface-50">
            {loading ? '—' : currencyFormatter.format(summary?.amount_summary.current_month_active_amount ?? 0)}
          </p>
          <div className="mt-2 flex items-center justify-between text-xs text-surface-400">
            <span>{summary?.amount_summary.current_month_label || '当月'}</span>
            <span className="text-surface-500">
              全体: {currencyFormatter.format(summary?.amount_summary.current_month_total_amount ?? 0)}
            </span>
          </div>
        </div>

        {/* 3. 検収待ち発注 */}
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-surface-400">検収待ち発注</span>
            <div className="rounded-lg bg-amber-950/60 p-2 text-amber-400 border border-amber-800/40">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-amber-300">
            {loading ? '—' : `${summary?.pending_receipts.total_pending_receipt_count ?? 0} 件`}
          </p>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="rounded bg-amber-950/80 px-1.5 py-0.5 text-amber-400 border border-amber-800/40">
              未検収 {summary?.pending_receipts.unreceived_count ?? 0}
            </span>
            <span className="rounded bg-sky-950/80 px-1.5 py-0.5 text-sky-400 border border-sky-800/40">
              一部検収 {summary?.pending_receipts.partially_received_count ?? 0}
            </span>
          </div>
        </div>

        {/* 4. 承認待ち発注 */}
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-surface-400">承認待ち発注</span>
            <div className="rounded-lg bg-purple-950/60 p-2 text-purple-400 border border-purple-800/40">
              <AlertCircle className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-purple-300">
            {loading ? '—' : `${summary?.status_counts.pending_approval.count ?? 0} 件`}
          </p>
          <div className="mt-2 flex items-center justify-between text-xs text-surface-400">
            <span>
              金額: {currencyFormatter.format(summary?.status_counts.pending_approval.total_amount ?? 0)}
            </span>
            <Link
              to="/purchase-requests?status=pending_approval"
              className="inline-flex items-center gap-0.5 text-purple-400 hover:underline"
            >
              一覧へ <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>

      {/* メイングリッド (月次推移チャート & ステータス別内訳) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* 左側2カラム: 月次発注推移 */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between pb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-emerald-400" />
              <h2 className="text-base font-semibold text-surface-100">月次発注推移 (直近6ヶ月)</h2>
            </div>
            <span className="text-xs text-surface-400">棒: 確定発注額 / 背景: 全体申請額</span>
          </div>
          <PurchaseMonthlyTrendChart data={summary?.monthly_trends ?? []} />
        </div>

        {/* 右側1カラム: ステータス別構成 */}
        <div className="card p-5">
          <div className="flex items-center justify-between pb-4">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-sky-400" />
              <h2 className="text-base font-semibold text-surface-100">ステータス別構成</h2>
            </div>
            <span className="text-xs text-surface-400">
              全 {summary?.status_counts.total.count ?? 0} 件
            </span>
          </div>

          <div className="space-y-3">
            {(['active', 'pending_approval', 'draft', 'rejected', 'terminated'] as PurchaseRequestStatus[]).map((status) => {
              const item = summary?.status_counts[status] || { count: 0, total_amount: 0 };
              const meta = STATUS_LABELS[status];
              const pct = Math.round((item.total_amount / totalStatusAmount) * 100);

              return (
                <div key={status} className="space-y-1.5 rounded-lg border border-surface-800 bg-surface-900/50 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 font-medium ${meta.bg} ${meta.text} ${meta.border}`}>
                      {meta.label}
                    </span>
                    <span className="font-semibold text-surface-200">
                      {currencyFormatter.format(item.total_amount)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-surface-400">
                    <span>{item.count} 件</span>
                    <span>{pct}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-800">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        status === 'active'
                          ? 'bg-emerald-500'
                          : status === 'pending_approval'
                            ? 'bg-amber-500'
                            : status === 'draft'
                              ? 'bg-surface-500'
                              : status === 'rejected'
                                ? 'bg-rose-500'
                                : 'bg-zinc-600'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* サプライヤー別発注金額ランキング (Top 5) */}
      <div className="card p-5">
        <div className="flex items-center justify-between pb-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-amber-400" />
            <h2 className="text-base font-semibold text-surface-100">
              サプライヤー別確定発注ランキング (上位5社)
            </h2>
          </div>
          <Link
            to="/suppliers"
            className="inline-flex items-center gap-1 text-xs text-surface-400 hover:text-surface-200"
          >
            サプライヤーマスタ一覧 <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {summary?.supplier_ranking && summary.supplier_ranking.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-surface-800 text-xs text-surface-400">
                <tr>
                  <th className="pb-2 font-medium">順位</th>
                  <th className="pb-2 font-medium">サプライヤー名</th>
                  <th className="pb-2 font-medium text-right">発注件数</th>
                  <th className="pb-2 font-medium text-right">確定発注合計額</th>
                  <th className="pb-2 font-medium text-right">構成比</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-800/60">
                {summary.supplier_ranking.map((s, idx) => {
                  const maxRankingAmount = summary.supplier_ranking[0]?.total_amount || 1;
                  const sharePct = Math.round((s.total_amount / maxRankingAmount) * 100);

                  return (
                    <tr key={s.supplier_id || s.supplier_name} className="hover:bg-surface-800/30">
                      <td className="py-3">
                        <span
                          className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                            idx === 0
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                              : idx === 1
                                ? 'bg-slate-400/20 text-slate-300 border border-slate-400/40'
                                : idx === 2
                                  ? 'bg-amber-700/20 text-amber-500 border border-amber-700/40'
                                  : 'bg-surface-800 text-surface-400'
                          }`}
                        >
                          {idx + 1}
                        </span>
                      </td>
                      <td className="py-3 font-medium text-surface-100">
                        {s.supplier_name}
                      </td>
                      <td className="py-3 text-right text-surface-300">
                        {s.request_count} 件
                      </td>
                      <td className="py-3 text-right font-semibold text-surface-50">
                        {currencyFormatter.format(s.total_amount)}
                      </td>
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-800">
                            <div
                              className="h-full rounded-full bg-amber-500"
                              style={{ width: `${sharePct}%` }}
                            />
                          </div>
                          <span className="w-8 text-right text-xs text-surface-400">
                            {sharePct}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-surface-500">
            確定発注データが存在しません
          </div>
        )}
      </div>
    </div>
  );
}
