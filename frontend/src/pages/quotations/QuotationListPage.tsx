import {
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Plus,
  Search,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from './StatusBadge';
import { useCustomers, useQuotations } from './hooks';
import {
  QUOTATION_STATUS_LABELS,
  type QuotationStatus,
} from './types';

const PAGE_SIZE = 20;
const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

export function QuotationListPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<QuotationStatus | ''>('');
  const [customerId, setCustomerId] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading, isError } = useQuotations({
    page,
    limit: PAGE_SIZE,
    status: status || undefined,
    customer_id: customerId || undefined,
    search: search.trim() || undefined,
  });

  const { data: customers = [] } = useCustomers();

  const quotations = data?.quotations ?? [];
  const pagination = data?.pagination;
  const totalPages = pagination?.total_pages ?? 1;

  return (
    <div className="space-y-6">
      {/* ページヘッダー */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-6 w-6 text-indigo-400" />
            <h1 className="text-2xl font-bold tracking-tight text-surface-100">見積書一覧</h1>
          </div>
          <p className="mt-1 text-sm text-surface-400">
            営業案件や顧客向けの見積作成・確定送付・改訂管理・受注転換を行います。
          </p>
        </div>
        <Link
          to="/quotations/new"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500"
        >
          <Plus className="h-4 w-4" />
          新規見積作成
        </Link>
      </div>

      {/* 検索・絞り込みフィルターバー */}
      <div className="rounded-xl border border-surface-800 bg-surface-900/60 p-4 backdrop-blur">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-surface-400" />
            <input
              type="text"
              placeholder="見積番号・件名・顧客名で検索..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-surface-700 bg-surface-800/80 py-2 pl-9 pr-3 text-sm text-surface-200 placeholder-surface-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as QuotationStatus | '');
                setPage(1);
              }}
              className="w-full rounded-lg border border-surface-700 bg-surface-800/80 px-3 py-2 text-sm text-surface-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">すべてのステータス</option>
              {Object.entries(QUOTATION_STATUS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <select
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-surface-700 bg-surface-800/80 px-3 py-2 text-sm text-surface-200 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">すべての顧客</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-end text-sm text-surface-400">
            全 <span className="font-semibold text-surface-200 mx-1">{pagination?.total_count ?? 0}</span> 件
          </div>
        </div>
      </div>

      {/* 一覧テーブル */}
      <div className="overflow-hidden rounded-xl border border-surface-800 bg-surface-900 shadow-sm">
        {isLoading ? (
          <div className="flex h-64 items-center justify-center text-surface-400">
            読み込み中...
          </div>
        ) : isError ? (
          <div className="flex h-64 items-center justify-center text-rose-400">
            見積書データの取得に失敗しました
          </div>
        ) : quotations.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-surface-400">
            <FileSpreadsheet className="h-10 w-10 text-surface-600 mb-2" />
            <p>見積書が登録されていません</p>
            <Link to="/quotations/new" className="mt-2 text-sm text-indigo-400 hover:underline">
              新しい見積書を作成する
            </Link>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-surface-800 bg-surface-950/50 text-xs uppercase text-surface-400">
              <tr>
                <th className="px-5 py-3 font-semibold">見積番号</th>
                <th className="px-5 py-3 font-semibold">件名</th>
                <th className="px-5 py-3 font-semibold">顧客名</th>
                <th className="px-5 py-3 font-semibold">発行日 / 有効期限</th>
                <th className="px-5 py-3 font-semibold text-right">見積金額 (税込)</th>
                <th className="px-5 py-3 font-semibold">ステータス</th>
                <th className="px-5 py-3 font-semibold text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-800">
              {quotations.map((q) => (
                <tr key={q.id} className="transition hover:bg-surface-800/40">
                  <td className="px-5 py-3.5">
                    <Link
                      to={`/quotations/${q.id}`}
                      className="font-medium text-indigo-400 hover:text-indigo-300"
                    >
                      {q.quote_no}
                    </Link>
                    <span className="ml-1.5 inline-block rounded bg-surface-800 px-1.5 py-0.5 text-xs text-surface-400">
                      v{q.version}
                    </span>
                    {q.superseded_by && (
                      <span className="ml-1 text-xs text-amber-400" title="改訂版発行済">
                        (旧版)
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 font-medium text-surface-200">
                    {q.title}
                  </td>
                  <td className="px-5 py-3.5 text-surface-300">
                    {q.customer_name ?? '—'}
                  </td>
                  <td className="px-5 py-3.5 text-xs text-surface-400">
                    <div>{q.issue_date}</div>
                    {q.valid_until && (
                      <div className="text-surface-500">~ {q.valid_until}</div>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right font-semibold text-surface-100">
                    {currencyFormatter.format(q.total_amount)}
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge
                      status={q.status}
                      isConverted={Boolean(q.converted_invoice_id)}
                      convertedInvoiceNo={q.converted_invoice_no}
                    />
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <Link
                      to={`/quotations/${q.id}`}
                      className="rounded-md border border-surface-700 bg-surface-800/80 px-2.5 py-1 text-xs font-medium text-surface-200 hover:bg-surface-700"
                    >
                      詳細
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* ページネーション */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-surface-800 px-5 py-3 text-xs text-surface-400">
            <div>
              ページ {page} / {totalPages}
            </div>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 rounded border border-surface-700 bg-surface-800 px-2.5 py-1 font-medium disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                前へ
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="inline-flex items-center gap-1 rounded border border-surface-700 bg-surface-800 px-2.5 py-1 font-medium disabled:opacity-40"
              >
                次へ
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
