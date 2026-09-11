import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ShoppingCart,
  Plus,
  Search,
  ArrowRight,
  Send,
  Trash2,
  Calendar,
  Building2,
  Package,
} from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import type { components } from '../../types/api.generated';
import {
  STATUS_LABELS,
  type PurchaseRequest,
  type PurchaseRequestStatus,
} from './types';

type PurchaseRequestListResponse = components['schemas']['PurchaseRequestListResponse'];

export function PurchaseRequestListPage() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, page_size: 20 };
      if (search) params.search = search;
      if (selectedStatus) params.status = selectedStatus;

      const res = await apiClient.get<PurchaseRequestListResponse>(
        '/purchase-requests',
        { params },
      );
      setRequests(res.data.data);
      if (res.data.meta?.pagination) {
        setTotalPages(res.data.meta.pagination.total_pages || 1);
      }
    } catch (err: any) {
      toast.error('発注申請一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, [page, selectedStatus]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchRequests();
  };

  const handleSubmitApproval = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('この発注申請の承認申請を送信しますか？')) return;

    setSubmittingId(id);
    try {
      await apiClient.post(`/purchase-requests/${id}/submit`);
      toast.success('承認申請を送信しました');
      fetchRequests();
    } catch (err: any) {
      const msg = err.response?.data?.message || '承認申請の送信に失敗しました';
      toast.error(msg);
    } finally {
      setSubmittingId(null);
    }
  };

  const handleDelete = async (id: string, requestNo: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`下書き発注申請「${requestNo}」を削除しますか？`)) return;

    try {
      await apiClient.delete(`/purchase-requests/${id}`);
      toast.success('発注申請を削除しました');
      fetchRequests();
    } catch (err: any) {
      const msg = err.response?.data?.message || '削除に失敗しました';
      toast.error(msg);
    }
  };

  return (
    <div className="space-y-6">
      {/* ページヘッダー */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-surface-400 text-sm mb-1">
            <span>購買・調達</span>
            <span>/</span>
            <span className="text-surface-200">発注申請</span>
          </div>
          <h1 className="text-2xl font-bold text-surface-50 flex items-center gap-2">
            <ShoppingCart className="w-7 h-7 text-indigo-400" />
            発注申請
          </h1>
          <p className="text-sm text-surface-400 mt-1">
            購買・備品発注の起票、多段階承認ワークフロー、進捗ステータスを管理します
          </p>
        </div>
        <Link
          to="/purchase-requests/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-colors shadow-sm self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          新規発注起票
        </Link>
      </div>

      {/* 検索・フィルタツールバー */}
      <div className="p-4 bg-surface-900 border border-surface-800 rounded-xl space-y-4">
        <div className="flex flex-col md:flex-row gap-4">
          <form onSubmit={handleSearchSubmit} className="flex-1 flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="発注番号、件名、サプライヤー、品目名で検索..."
                className="w-full pl-10 pr-4 py-2 bg-surface-950 border border-surface-800 rounded-lg text-sm text-surface-100 placeholder-surface-500 focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-surface-800 hover:bg-surface-700 text-surface-200 text-sm font-medium rounded-lg transition-colors"
            >
              検索
            </button>
          </form>

          <div className="flex flex-wrap gap-2">
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 bg-surface-950 border border-surface-800 rounded-lg text-sm text-surface-200 focus:outline-none focus:border-indigo-500"
            >
              <option value="">すべてのステータス</option>
              <option value="draft">下書き</option>
              <option value="pending_approval">承認待ち</option>
              <option value="active">承認済(発注確定)</option>
              <option value="rejected">却下</option>
              <option value="terminated">解約・取消</option>
            </select>
          </div>
        </div>
      </div>

      {/* 発注申請テーブル */}
      <div className="bg-surface-900 border border-surface-800 rounded-xl overflow-hidden shadow-sm">
        {loading ? (
          <div className="p-12 text-center text-surface-400">読み込み中...</div>
        ) : requests.length === 0 ? (
          <div className="p-12 text-center">
            <ShoppingCart className="w-12 h-12 text-surface-600 mx-auto mb-3" />
            <p className="text-surface-300 font-medium">発注申請がありません</p>
            <p className="text-surface-500 text-sm mt-1">
              {search || selectedStatus
                ? '検索条件に一致する申請が見つかりませんでした'
                : '「新規発注起票」ボタンから新しい発注申請を作成してください'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-surface-800 bg-surface-950/50 text-xs font-semibold text-surface-400 uppercase tracking-wider">
                  <th className="py-3 px-4">発注番号 / 件名</th>
                  <th className="py-3 px-4">サプライヤー / 品目</th>
                  <th className="py-3 px-4 text-right">数量 × 単価</th>
                  <th className="py-3 px-4 text-right">合計金額</th>
                  <th className="py-3 px-4">ステータス</th>
                  <th className="py-3 px-4">希望納期</th>
                  <th className="py-3 px-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-800 text-sm">
                {requests.map((item) => {
                  const statusInfo = STATUS_LABELS[item.status as PurchaseRequestStatus] || {
                    label: item.status,
                    bg: 'bg-surface-800',
                    text: 'text-surface-400',
                    border: 'border-surface-700',
                  };

                  return (
                    <tr
                      key={item.id}
                      onClick={() => navigate(`/purchase-requests/${item.id}`)}
                      className="hover:bg-surface-800/50 cursor-pointer transition-colors"
                    >
                      <td className="py-3.5 px-4">
                        <div className="font-mono text-xs text-indigo-400 font-medium">
                          {item.request_no}
                        </div>
                        <div className="font-medium text-surface-100 mt-0.5 line-clamp-1">
                          {item.title}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5 text-surface-200">
                          <Building2 className="w-3.5 h-3.5 text-surface-400 shrink-0" />
                          <span className="truncate max-w-[180px]">{item.supplier_name}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-surface-400 mt-0.5">
                          <Package className="w-3.5 h-3.5 text-surface-500 shrink-0" />
                          <span className="truncate max-w-[180px]">{item.item_description}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right text-surface-300 font-mono text-xs">
                        {Number(item.quantity).toLocaleString()} × ¥{Number(item.unit_price).toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="font-semibold text-surface-100 font-mono">
                          ¥{Number(item.total_amount).toLocaleString()}
                        </div>
                        <div className="text-[11px] text-surface-500">{item.currency}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${statusInfo.bg} ${statusInfo.text} ${statusInfo.border}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-surface-400 text-xs">
                        {item.requested_delivery_date ? (
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5 text-surface-500" />
                            <span>{item.requested_delivery_date}</span>
                          </div>
                        ) : (
                          <span className="text-surface-600">-</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {item.status === 'draft' && (
                            <>
                              <button
                                onClick={(e) => handleSubmitApproval(item.id, e)}
                                disabled={submittingId === item.id}
                                title="承認申請を送信"
                                className="p-1.5 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-950/50 rounded-lg transition-colors"
                              >
                                <Send className="w-4 h-4" />
                              </button>
                              <button
                                onClick={(e) => handleDelete(item.id, item.request_no, e)}
                                title="削除"
                                className="p-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-950/50 rounded-lg transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          <div className="text-surface-500">
                            <ArrowRight className="w-4 h-4" />
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ページネーション */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-surface-800 flex items-center justify-between text-sm">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 bg-surface-800 hover:bg-surface-700 disabled:opacity-50 disabled:pointer-events-none rounded-lg text-surface-200"
            >
              前へ
            </button>
            <span className="text-surface-400">
              {page} / {totalPages} ページ
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 bg-surface-800 hover:bg-surface-700 disabled:opacity-50 disabled:pointer-events-none rounded-lg text-surface-200"
            >
              次へ
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
