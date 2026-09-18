import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  FileCheck,
  FileText,
  Percent,
  Plus,
  RefreshCw,
  RotateCw,
  TrendingUp,
} from 'lucide-react';
import { toast } from '../../stores/toastStore';
import { salesDashboardApi } from './salesDashboardApi';
import {
  DEAL_STAGE_CONFIG,
  QUOTATION_STATUS_CONFIG,
  type DealStage,
  type QuotationStatus,
  type SalesDashboardSummaryDto,
} from './types';

const currencyFormatter = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
});

export function SalesDashboardPage() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<SalesDashboardSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchSummary = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoading(true);

    try {
      const data = await salesDashboardApi.getSummary();
      setSummary(data);
    } catch (err) {
      toast.error('営業ダッシュボードデータの取得に失敗しました');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  const pipeline = summary?.pipeline;
  const quotations = summary?.quotations;
  const renewals = summary?.renewals;

  const totalPipelineAmount = pipeline?.total_deals.total_amount || 1;
  const maxStageAmount = Math.max(
    1,
    pipeline?.lead.total_amount || 0,
    pipeline?.qualified.total_amount || 0,
    pipeline?.proposal.total_amount || 0,
    pipeline?.negotiation.total_amount || 0,
    pipeline?.won.total_amount || 0,
    pipeline?.lost.total_amount || 0,
  );

  return (
    <div className="space-y-6 pb-12">
      {/* ヘッダーエリア */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-surface-50">営業ダッシュボード</h1>
            <span className="rounded-md border border-sky-800/60 bg-sky-950/40 px-2 py-0.5 text-xs font-medium text-sky-400">
              Phase 4
            </span>
          </div>
          <p className="mt-1 text-sm text-surface-400">
            案件パイプライン・見積成約率・契約更新提案の進捗サマリー
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
            to="/quotations"
            className="btn-secondary flex items-center gap-1.5 text-xs"
          >
            <FileText className="h-3.5 w-3.5" />
            見積一覧
          </Link>
          <Link
            to="/deals"
            className="btn-secondary flex items-center gap-1.5 text-xs"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            案件一覧
          </Link>
          <button
            type="button"
            onClick={() => navigate('/deals/new')}
            className="btn-primary flex items-center gap-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            新規案件登録
          </button>
        </div>
      </div>

      {/* KPIカード グリッド (4枚) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* 1. 進行中パイプライン総額 */}
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-surface-400">進行中パイプライン</span>
            <div className="rounded-lg bg-sky-950/60 p-2 text-sky-400 border border-sky-800/40">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-surface-50">
            {loading ? '—' : currencyFormatter.format(pipeline?.open_deals.total_amount ?? 0)}
          </p>
          <div className="mt-2 flex items-center justify-between text-xs text-surface-400">
            <span>進行中案件: {pipeline?.open_deals.count ?? 0} 件</span>
            <span className="text-surface-500">
              全商談: {currencyFormatter.format(pipeline?.total_deals.total_amount ?? 0)}
            </span>
          </div>
        </div>

        {/* 2. 受注商談額 & 勝率 */}
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-surface-400">受注商談額 (Won)</span>
            <div className="rounded-lg bg-emerald-950/60 p-2 text-emerald-400 border border-emerald-800/40">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-emerald-400">
            {loading ? '—' : currencyFormatter.format(pipeline?.won_deals.total_amount ?? 0)}
          </p>
          <div className="mt-2 flex items-center justify-between text-xs text-surface-400">
            <span>
              勝率:{' '}
              <strong className="text-emerald-300">
                {loading ? '—' : `${((pipeline?.win_rate ?? 0) * 100).toFixed(1)}%`}
              </strong>
            </span>
            <span className="text-surface-500">
              受注 {pipeline?.won_deals.count ?? 0} / 失注 {pipeline?.lost_deals.count ?? 0} 件
            </span>
          </div>
        </div>

        {/* 3. 見積成約率 */}
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-surface-400">見積成約率 (CVR)</span>
            <div className="rounded-lg bg-indigo-950/60 p-2 text-indigo-400 border border-indigo-800/40">
              <Percent className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-indigo-300">
            {loading ? '—' : `${((quotations?.conversion_rate ?? 0) * 100).toFixed(1)}%`}
          </p>
          <div className="mt-2 flex items-center justify-between text-xs text-surface-400">
            <span>成約: {quotations?.accepted.count ?? 0} 件</span>
            <span className="text-surface-500">
              提示済計: {quotations?.actionable_count ?? 0} 件
            </span>
          </div>
        </div>

        {/* 4. 契約更新提案起票率 */}
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-surface-400">契約更新提案起票率</span>
            <div className="rounded-lg bg-amber-950/60 p-2 text-amber-400 border border-amber-800/40">
              <RotateCw className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-2xl font-bold text-amber-300">
            {loading ? '—' : `${((renewals?.renewal_proposal_rate ?? 0) * 100).toFixed(1)}%`}
          </p>
          <div className="mt-2 flex items-center justify-between text-xs text-surface-400">
            <span>
              起票済 {renewals?.linked_contracts_count ?? 0} / 対象 {renewals?.expiring_contracts_count ?? 0} 契約
            </span>
            <Link
              to="/contracts"
              className="inline-flex items-center gap-0.5 text-amber-400 hover:underline"
            >
              契約一覧 <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>

      {/* メイングリッド (案件パイプライン進捗 & 見積ステータス内訳) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* 左側2カラム: 案件パイプライン・ステージ別進捗 */}
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between pb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-sky-400" />
              <h2 className="text-base font-semibold text-surface-100">案件パイプライン状況</h2>
            </div>
            <span className="text-xs text-surface-400">
              全 {pipeline?.total_deals.count ?? 0} 件 / 総額 {currencyFormatter.format(pipeline?.total_deals.total_amount ?? 0)}
            </span>
          </div>

          <div className="space-y-4">
            {(['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as DealStage[]).map((stage) => {
              const item = pipeline ? pipeline[stage] : { count: 0, total_amount: 0 };
              const cfg = DEAL_STAGE_CONFIG[stage];
              const pctOfMax = Math.round((item.total_amount / maxStageAmount) * 100);
              const pctOfTotal = Math.round((item.total_amount / totalPipelineAmount) * 100);

              return (
                <div
                  key={stage}
                  className="rounded-lg border border-surface-800 bg-surface-900/50 p-3 transition-colors hover:border-surface-700"
                >
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 font-medium ${cfg.bg} ${cfg.text} ${cfg.border}`}
                      >
                        {cfg.label}
                      </span>
                      <span className="text-surface-400">{item.count} 件</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-surface-500">構成比 {pctOfTotal}%</span>
                      <span className="font-semibold text-surface-100">
                        {currencyFormatter.format(item.total_amount)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-800">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(100, Math.max(0, pctOfMax))}%`,
                        backgroundColor: cfg.color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* 勝率サマリーバー */}
          <div className="mt-6 rounded-lg border border-surface-800 bg-surface-950/60 p-4">
            <div className="flex items-center justify-between text-xs text-surface-300">
              <span className="font-medium">商談成約状況 (Won / Lost 比率)</span>
              <span>勝率: {((pipeline?.win_rate ?? 0) * 100).toFixed(1)}%</span>
            </div>
            <div className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-surface-800">
              <div
                className="bg-emerald-500 transition-all duration-500"
                style={{
                  width: `${Math.min(100, Math.max(0, (pipeline?.win_rate ?? 0) * 100))}%`,
                }}
                title={`Won: ${pipeline?.won_deals.count ?? 0}件`}
              />
              <div
                className="bg-red-500/80 transition-all duration-500"
                style={{
                  width: `${Math.min(100, Math.max(0, 100 - (pipeline?.win_rate ?? 0) * 100))}%`,
                }}
                title={`Lost: ${pipeline?.lost_deals.count ?? 0}件`}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-surface-500">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                受注 {pipeline?.won_deals.count ?? 0} 件 ({currencyFormatter.format(pipeline?.won_deals.total_amount ?? 0)})
              </span>
              <span className="flex items-center gap-1.5 text-red-400">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                失注 {pipeline?.lost_deals.count ?? 0} 件 ({currencyFormatter.format(pipeline?.lost_deals.total_amount ?? 0)})
              </span>
            </div>
          </div>
        </div>

        {/* 右側1カラム: 見積ステータス別構成 */}
        <div className="card p-5">
          <div className="flex items-center justify-between pb-4">
            <div className="flex items-center gap-2">
              <FileCheck className="h-4 w-4 text-indigo-400" />
              <h2 className="text-base font-semibold text-surface-100">見積ステータス構成</h2>
            </div>
            <span className="text-xs text-surface-400">
              全 {quotations?.total_quotations.count ?? 0} 件
            </span>
          </div>

          <div className="space-y-3">
            {(['accepted', 'sent', 'draft', 'rejected', 'expired'] as QuotationStatus[]).map((status) => {
              const item = quotations ? quotations[status] : { count: 0, total_amount: 0 };
              const cfg = QUOTATION_STATUS_CONFIG[status];
              const totalAmount = quotations?.total_quotations.total_amount || 1;
              const pct = Math.round((item.total_amount / totalAmount) * 100);

              return (
                <div
                  key={status}
                  className="space-y-1.5 rounded-lg border border-surface-800 bg-surface-900/50 p-3"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 font-medium ${cfg.bg} ${cfg.text} ${cfg.border}`}
                    >
                      {cfg.label}
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
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${Math.min(100, Math.max(0, pct))}%`,
                        backgroundColor: cfg.color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* 見積成約率解説カード */}
          <div className="mt-5 rounded-lg border border-indigo-900/50 bg-indigo-950/20 p-3.5 text-xs text-surface-300">
            <div className="flex items-center gap-1.5 font-medium text-indigo-300">
              <Percent className="h-3.5 w-3.5" />
              <span>見積成約率の計算式</span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-surface-400">
              成約件数 ({quotations?.accepted.count ?? 0}) ÷ 提示済以上件数 ({quotations?.actionable_count ?? 0}) ＝{' '}
              <strong className="text-indigo-300">{((quotations?.conversion_rate ?? 0) * 100).toFixed(1)}%</strong>
            </p>
            <p className="mt-1 text-[10px] text-surface-500">
              ※下書き（draft）を除く、送付・成約・却下・期限切れの見積を母数として算出しています。
            </p>
          </div>
        </div>
      </div>

      {/* 契約更新提案の進捗 & リンク商談のステージ分布 */}
      <div className="card p-5">
        <div className="flex flex-col justify-between gap-2 border-b border-surface-800 pb-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <RotateCw className="h-4 w-4 text-amber-400" />
            <h2 className="text-base font-semibold text-surface-100">契約更新提案の進捗状況</h2>
          </div>
          <span className="text-xs text-surface-400">
            契約満了アラート対象に対する商談化カバレッジ
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* 左側: 更新起票進捗バー */}
          <div className="space-y-4 rounded-lg border border-surface-800 bg-surface-900/40 p-4">
            <h3 className="text-xs font-semibold text-surface-300">更新起票カバレッジ</h3>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-3xl font-bold text-amber-400">
                  {((renewals?.renewal_proposal_rate ?? 0) * 100).toFixed(1)}%
                </span>
                <span className="text-xs text-surface-400">
                  起票済 {renewals?.linked_contracts_count ?? 0} / 満了予告 {renewals?.expiring_contracts_count ?? 0} 件
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-800">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all duration-500"
                  style={{
                    width: `${Math.min(100, Math.max(0, (renewals?.renewal_proposal_rate ?? 0) * 100))}%`,
                  }}
                />
              </div>
            </div>
            <p className="text-[11px] text-surface-400">
              満了予告期間（標準30日以内）に到達している有効契約のうち、P4-T3の契約更新連携によって案件（Deal）が作成された割合です。
            </p>
          </div>

          {/* 右側2カラム: リンク商談のステージ分布 */}
          <div className="space-y-3 rounded-lg border border-surface-800 bg-surface-900/40 p-4 md:col-span-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-surface-300">
                契約更新から起票された案件のステージ分布
              </h3>
              <span className="text-xs text-surface-400">
                リンク案件数: {renewals?.linked_deals_stage_distribution.total.count ?? 0} 件
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as DealStage[]).map((stage) => {
                const item = renewals?.linked_deals_stage_distribution[stage] || { count: 0, total_amount: 0 };
                const cfg = DEAL_STAGE_CONFIG[stage];

                return (
                  <div
                    key={stage}
                    className="rounded border border-surface-800/80 bg-surface-950/60 p-2.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className={`font-medium ${cfg.text}`}>{cfg.label}</span>
                      <span className="font-bold text-surface-100">{item.count} 件</span>
                    </div>
                    <div className="mt-1 text-[11px] text-surface-400">
                      {currencyFormatter.format(item.total_amount)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
