import { ChevronLeft, ChevronRight, Play, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFiscalPeriods } from '../fiscal-periods/hooks';
import { DisposeDialog } from './DisposeDialog';
import { StatusBadge } from './StatusBadge';
import { useDisposeFixedAsset, useFixedAssets, useRunDepreciationBatch } from './hooks';
import { FIXED_ASSET_STATUS_LABEL, type FixedAsset, type FixedAssetStatus } from './types';

const PAGE_SIZE = 20;
const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

export function FixedAssetListPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<FixedAssetStatus | ''>('');
  const [page, setPage] = useState(1);
  const [disposeTarget, setDisposeTarget] = useState<FixedAsset | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');

  const { data, isLoading, isError } = useFixedAssets({
    page,
    page_size: PAGE_SIZE,
    status: status || undefined,
  });
  const { data: fiscalPeriods = [] } = useFiscalPeriods();
  const disposeMutation = useDisposeFixedAsset();
  const runMutation = useRunDepreciationBatch();

  const fixedAssets = data?.fixedAssets ?? [];
  const pagination = data?.meta?.pagination;
  const totalPages = pagination?.total_pages ?? 1;

  const statusOptions = useMemo(
    () => Object.entries(FIXED_ASSET_STATUS_LABEL) as [FixedAssetStatus, string][],
    [],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-surface-50">固定資産・減価償却</h1>
          <p className="mt-1 text-sm text-surface-400">固定資産台帳の管理と月次減価償却バッチを実行します。</p>
        </div>
        <Link to="/fixed-assets/new" className="btn-primary">
          <Plus className="h-4 w-4" />
          新規資産登録
        </Link>
      </div>

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">対象会計期間</label>
          <select
            value={selectedPeriodId}
            onChange={(e) => setSelectedPeriodId(e.target.value)}
            className="rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="">選択してください</option>
            {fiscalPeriods.map((p) => (
              <option key={p.id} value={p.id}>
                第{p.period_no}期({p.start_date} 〜 {p.end_date})
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={!selectedPeriodId || runMutation.isPending}
          onClick={() => runMutation.mutate({ fiscal_period_id: selectedPeriodId })}
        >
          <Play className="h-4 w-4" />
          {runMutation.isPending ? '実行中…' : '月次償却バッチ実行'}
        </button>
      </div>

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">ステータス</label>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as FixedAssetStatus | '');
              setPage(1);
            }}
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
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-4 py-3 font-medium">資産番号</th>
              <th className="px-4 py-3 font-medium">名称</th>
              <th className="px-4 py-3 font-medium">取得日</th>
              <th className="px-4 py-3 text-right font-medium">取得価額</th>
              <th className="px-4 py-3 text-right font-medium">償却累計額</th>
              <th className="px-4 py-3 font-medium">ステータス</th>
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
                  固定資産一覧の取得に失敗しました
                </td>
              </tr>
            )}
            {!isLoading && !isError && fixedAssets.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-surface-500">
                  該当する固定資産がありません
                </td>
              </tr>
            )}
            {fixedAssets.map((asset) => (
              <tr
                key={asset.id}
                className="border-b border-surface-800/60 transition-colors hover:bg-surface-850/60"
              >
                <td className="px-4 py-3 font-mono text-xs text-surface-300">
                  <Link to={`/fixed-assets/${asset.id}`} className="hover:text-brand-300">
                    {asset.asset_no}
                  </Link>
                </td>
                <td className="px-4 py-3 text-surface-200">{asset.name}</td>
                <td className="px-4 py-3 text-surface-300">{asset.acquisition_date}</td>
                <td className="px-4 py-3 text-right tabular-nums text-surface-200">
                  {currencyFormatter.format(asset.acquisition_cost ?? 0)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-surface-200">
                  {currencyFormatter.format(asset.accumulated_depreciation ?? 0)}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={asset.status as FixedAssetStatus} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-100"
                      onClick={() => navigate(`/fixed-assets/${asset.id}`)}
                    >
                      詳細
                    </button>
                    {asset.status === 'active' && (
                      <button
                        type="button"
                        className="rounded-md p-1.5 text-negative transition-colors hover:bg-negative-subtle"
                        title="除却・売却"
                        onClick={() => setDisposeTarget(asset)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-surface-400">
        <span>{pagination ? `全 ${pagination.total_count} 件中 ${fixedAssets.length} 件表示` : ''}</span>
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

      {disposeTarget && (
        <DisposeDialog
          assetName={`${disposeTarget.asset_no} ${disposeTarget.name}`}
          isSubmitting={disposeMutation.isPending}
          onCancel={() => setDisposeTarget(null)}
          onConfirm={({ disposalDate, disposalType, proceedsAmount }) =>
            disposeMutation.mutate(
              {
                id: disposeTarget.id as string,
                disposal_date: disposalDate,
                disposal_type: disposalType,
                proceeds_amount: proceedsAmount,
              },
              { onSuccess: () => setDisposeTarget(null) },
            )
          }
        />
      )}
    </div>
  );
}
