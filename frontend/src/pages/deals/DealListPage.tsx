import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Briefcase,
  Plus,
  Search,
  Building2,
  ChevronRight,
} from 'lucide-react';
import { useDeals, useCustomers } from './hooks';
import { StatusBadge } from './StatusBadge';
import { type DealStage, DEAL_STAGES, DEAL_STAGE_LABELS } from './types';

export function DealListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<DealStage | ''>('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data: customerData } = useCustomers();
  const customers = customerData ?? [];

  const { data, isLoading, isError, error } = useDeals({
    page,
    limit,
    stage: stageFilter,
    customer_id: customerFilter || undefined,
    search: search || undefined,
  });

  const deals = data?.deals ?? [];
  const pagination = data?.pagination ?? { page: 1, page_size: 20, total_count: 0, total_pages: 1 };

  return (
    <div className="space-y-6">
      {/* ページヘッダー */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <Briefcase className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">案件管理</h1>
              <p className="text-sm text-slate-500">商談パイプライン・進捗状況および見積連携の管理</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/deals/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg shadow-sm hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            新規案件作成
          </Link>
        </div>
      </div>

      {/* ステージフィルタタブ */}
      <div className="flex overflow-x-auto gap-2 pb-1 border-b border-slate-200 scrollbar-thin">
        <button
          type="button"
          onClick={() => {
            setStageFilter('');
            setPage(1);
          }}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
            stageFilter === ''
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          すべてのステージ
        </button>
        {DEAL_STAGES.map((stg: DealStage) => (
          <button
            key={stg}
            type="button"
            onClick={() => {
              setStageFilter(stg);
              setPage(1);
            }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
              stageFilter === stg
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {DEAL_STAGE_LABELS[stg]}
          </button>
        ))}
      </div>

      {/* 検索・絞り込みフィルター */}
      <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="案件名または顧客名で検索..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          <div>
            <select
              value={customerFilter}
              onChange={(e) => {
                setCustomerFilter(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
            >
              <option value="">すべての顧客</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* 案件一覧テーブル */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-500">
            <div className="inline-block animate-spin w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full mb-2" />
            <p className="text-sm">案件データを読み込み中...</p>
          </div>
        ) : isError ? (
          <div className="p-8 text-center text-rose-600">
            <p className="text-sm font-semibold">データの読み込みに失敗しました</p>
            <p className="text-xs mt-1 text-slate-500">{(error as Error)?.message}</p>
          </div>
        ) : deals.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Briefcase className="w-12 h-12 mx-auto mb-3 text-slate-300 stroke-[1.5]" />
            <p className="text-base font-semibold text-slate-700">案件が登録されていません</p>
            <p className="text-xs text-slate-400 mt-1">「新規案件作成」ボタンから商談を追加してください</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700 divide-y divide-slate-200">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">案件名 / 顧客</th>
                  <th className="px-4 py-3">ステージ</th>
                  <th className="px-4 py-3 text-right">予想金額</th>
                  <th className="px-4 py-3">予定日</th>
                  <th className="px-4 py-3">担当者</th>
                  <th className="px-4 py-3">作成日</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {deals.map((deal) => (
                  <tr
                    key={deal.id}
                    className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                    onClick={() => navigate(`/deals/${deal.id}`)}
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">
                      <div className="flex flex-col">
                        <span className="group-hover:text-indigo-600 transition-colors font-semibold">
                          {deal.title}
                        </span>
                        <span className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                          <Building2 className="w-3 h-3" />
                          {deal.customer_name || '顧客名未設定'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge stage={deal.stage} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {deal.expected_amount.toLocaleString()} {deal.currency_code}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-600 font-mono">
                      {deal.expected_close_date || '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-600">
                      {deal.owner_name || '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-400 font-mono">
                      {deal.created_at.slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          to={`/deals/${deal.id}`}
                          className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-slate-100 transition-colors"
                          title="詳細"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ページネーション */}
        {pagination.total_pages > 1 && (
          <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
            <div>
              全 <span className="font-semibold">{pagination.total_count}</span> 件中{' '}
              <span className="font-semibold">{(page - 1) * limit + 1}</span> -{' '}
              <span className="font-semibold">{Math.min(page * limit, pagination.total_count)}</span> 件を表示
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 border border-slate-200 rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
              >
                前へ
              </button>
              <span className="px-2.5 py-1 font-mono">
                {page} / {pagination.total_pages}
              </span>
              <button
                type="button"
                disabled={page >= pagination.total_pages}
                onClick={() => setPage((p) => Math.min(pagination.total_pages, p + 1))}
                className="px-2.5 py-1 border border-slate-200 rounded-md disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
              >
                次へ
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
