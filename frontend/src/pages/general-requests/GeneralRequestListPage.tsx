import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FileText,
  Plus,
  Search,
  ArrowRight,
  Send,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
  Paperclip,
} from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import type { components } from '../../types/api.generated';
import {
  GENERAL_REQUEST_CATEGORIES,
  STATUS_LABELS,
  type GeneralRequest,
} from './types';

type GeneralRequestListResponse = components['schemas']['GeneralRequestListResponse'];

export function GeneralRequestListPage() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<GeneralRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, page_size: 20 };
      if (search) params.search = search;
      if (selectedStatus) params.status = selectedStatus;
      if (selectedCategory) params.category = selectedCategory;

      const res = await apiClient.get<GeneralRequestListResponse>(
        '/general-requests',
        { params },
      );
      setRequests(res.data.data);
      if (res.data.meta?.pagination) {
        setTotalPages(res.data.meta.pagination.total_pages || 1);
      }
    } catch (err: any) {
      toast.error('稟議一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, [page, selectedStatus, selectedCategory]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchRequests();
  };

  const handleSubmitApproval = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('この稟議の承認申請を提出しますか？')) return;

    setSubmittingId(id);
    try {
      const res = await apiClient.post<{ data: GeneralRequest }>(
        `/general-requests/${id}/submit-approval`,
      );
      const updated = res.data.data;
      if (updated.status === 'active') {
        toast.success('自動承認ルールが適用され、稟議が即時承認されました');
      } else {
        toast.success('承認申請を提出しました');
      }
      fetchRequests();
    } catch (err: any) {
      toast.error(err.message || '承認申請の提出に失敗しました');
    } finally {
      setSubmittingId(null);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('この下書き稟議を削除しますか？')) return;

    try {
      await apiClient.delete(`/general-requests/${id}`);
      toast.success('稟議を削除しました');
      fetchRequests();
    } catch (err: any) {
      toast.error(err.message || '削除に失敗しました');
    }
  };

  const getCategoryLabel = (category: string) => {
    const found = GENERAL_REQUEST_CATEGORIES.find((c) => c.value === category);
    return found ? found.label : category;
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* ヘッダーエリア */}
      <div className="sm:flex sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <FileText className="h-7 w-7 text-brand-400" />
            <h1 className="text-2xl font-bold tracking-tight text-surface-50">
              稟議・社内申請
            </h1>
          </div>
          <p className="mt-1 text-sm text-surface-400">
            備品購入、規程変更、出張申請など、専用テーブルを持たない汎用的な社内ワークフローを起票・管理します。
          </p>
        </div>
        <div className="mt-4 sm:ml-16 sm:mt-0 sm:flex-none">
          <Link
            to="/general-requests/new"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
          >
            <Plus className="h-4 w-4" />
            新規稟議を起票
          </Link>
        </div>
      </div>

      {/* 検索・絞り込みフィルター */}
      <div className="mt-6 rounded-xl border border-surface-800 bg-surface-900/50 p-4 shadow-sm backdrop-blur">
        <form onSubmit={handleSearchSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="タイトル・説明で検索..."
              className="w-full rounded-lg border border-surface-700 bg-surface-800/80 py-2 pl-10 pr-3 text-sm text-surface-100 placeholder-surface-500 transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div>
            <select
              value={selectedCategory}
              onChange={(e) => {
                setSelectedCategory(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-surface-700 bg-surface-800/80 px-3 py-2 text-sm text-surface-100 transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">すべてのカテゴリ</option>
              {GENERAL_REQUEST_CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-lg border border-surface-700 bg-surface-800/80 px-3 py-2 text-sm text-surface-100 transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">すべてのステータス</option>
              <option value="draft">下書き</option>
              <option value="pending_approval">承認待ち</option>
              <option value="active">承認済</option>
              <option value="rejected">却下</option>
            </select>
          </div>
        </form>
      </div>

      {/* 一覧テーブル */}
      <div className="mt-6 overflow-hidden rounded-xl border border-surface-800 bg-surface-900/60 shadow">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-surface-800 text-left text-sm">
            <thead className="bg-surface-800/50 text-xs uppercase tracking-wider text-surface-400">
              <tr>
                <th scope="col" className="px-6 py-3.5 font-medium">
                  申請番号 / タイトル
                </th>
                <th scope="col" className="px-6 py-3.5 font-medium">
                  カテゴリ
                </th>
                <th scope="col" className="px-6 py-3.5 font-medium">
                  申請金額
                </th>
                <th scope="col" className="px-6 py-3.5 font-medium">
                  ステータス
                </th>
                <th scope="col" className="px-6 py-3.5 font-medium">
                  起票日時
                </th>
                <th scope="col" className="px-6 py-3.5 text-right font-medium">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-800/60">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-surface-500">
                    読み込み中…
                  </td>
                </tr>
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-surface-500">
                    該当する稟議申請はありません
                  </td>
                </tr>
              ) : (
                requests.map((req) => {
                  const statusInfo = STATUS_LABELS[req.status] || STATUS_LABELS.draft;
                  return (
                    <tr
                      key={req.id}
                      onClick={() => navigate(`/general-requests/${req.id}`)}
                      className="cursor-pointer transition-colors hover:bg-surface-800/40"
                    >
                      <td className="px-6 py-4">
                        <div className="font-mono text-xs text-brand-400">
                          {req.request_no}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 font-medium text-surface-100">
                          {req.title}
                          {req.attachment_id && (
                            <Paperclip className="h-3.5 w-3.5 text-surface-400" />
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-surface-300">
                        {getCategoryLabel(req.category)}
                      </td>
                      <td className="px-6 py-4 font-mono text-surface-200">
                        {req.amount !== null && req.amount !== undefined
                          ? `¥${Number(req.amount).toLocaleString()}`
                          : '-'}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusInfo.bg} ${statusInfo.text} ${statusInfo.border}`}
                        >
                          {req.status === 'active' && <CheckCircle2 className="h-3 w-3" />}
                          {req.status === 'pending_approval' && <Clock className="h-3 w-3" />}
                          {req.status === 'rejected' && <AlertCircle className="h-3 w-3" />}
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-surface-400">
                        {new Date(req.created_at).toLocaleDateString('ja-JP')}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {req.status === 'draft' && (
                            <>
                              <button
                                type="button"
                                disabled={submittingId === req.id}
                                onClick={(e) => handleSubmitApproval(req.id, e)}
                                title="承認申請"
                                className="inline-flex items-center gap-1 rounded bg-brand-600/20 px-2.5 py-1 text-xs font-medium text-brand-400 hover:bg-brand-600/30 disabled:opacity-50"
                              >
                                <Send className="h-3 w-3" />
                                申請
                              </button>
                              <button
                                type="button"
                                onClick={(e) => handleDelete(req.id, e)}
                                title="削除"
                                className="rounded p-1 text-surface-400 hover:bg-surface-800 hover:text-rose-400"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                          <ArrowRight className="h-4 w-4 text-surface-500" />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* ページネーション */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-surface-800 px-6 py-3">
            <div className="text-xs text-surface-400">
              ページ {page} / {totalPages}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                className="rounded-lg border border-surface-700 px-3 py-1 text-xs text-surface-300 transition-colors hover:bg-surface-800 disabled:opacity-40"
              >
                前へ
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                className="rounded-lg border border-surface-700 px-3 py-1 text-xs text-surface-300 transition-colors hover:bg-surface-800 disabled:opacity-40"
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
