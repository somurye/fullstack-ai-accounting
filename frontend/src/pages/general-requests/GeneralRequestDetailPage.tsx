import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Edit,
  Trash2,
  Send,
  CheckCircle2,
  Clock,
  AlertCircle,
  Paperclip,
  Loader2,
  Download,
} from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import {
  GENERAL_REQUEST_CATEGORIES,
  STATUS_LABELS,
  type GeneralRequest,
} from './types';

export function GeneralRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [request, setRequest] = useState<GeneralRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await apiClient.get<{ data: GeneralRequest }>(
        `/general-requests/${id}`,
      );
      setRequest(res.data.data);
    } catch (err: any) {
      toast.error('稟議詳細の取得に失敗しました');
      navigate('/general-requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [id]);

  const handleSubmitApproval = async () => {
    if (!id || !confirm('この稟議の承認申請を提出しますか？')) return;

    setIsSubmitting(true);
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
      setRequest(updated);
    } catch (err: any) {
      toast.error(err.message || '承認申請の提出に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!id || !confirm('この下書き稟議を削除しますか？')) return;

    try {
      await apiClient.delete(`/general-requests/${id}`);
      toast.success('稟議を削除しました');
      navigate('/general-requests');
    } catch (err: any) {
      toast.error(err.message || '削除に失敗しました');
    }
  };

  if (loading || !request) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
      </div>
    );
  }

  const statusInfo = STATUS_LABELS[request.status] || STATUS_LABELS.draft;
  const categoryLabel =
    GENERAL_REQUEST_CATEGORIES.find((c) => c.value === request.category)?.label ||
    request.category;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* 戻るリンク */}
      <div className="mb-6 flex items-center justify-between">
        <Link
          to="/general-requests"
          className="inline-flex items-center gap-1.5 text-sm text-surface-400 transition-colors hover:text-surface-200"
        >
          <ArrowLeft className="h-4 w-4" />
          稟議一覧へ戻る
        </Link>
        <div className="flex items-center gap-2">
          {request.status === 'draft' && (
            <>
              <Link
                to={`/general-requests/${request.id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-surface-700 bg-surface-800 px-3.5 py-1.5 text-xs font-medium text-surface-200 transition-colors hover:bg-surface-700"
              >
                <Edit className="h-3.5 w-3.5" />
                編集
              </Link>
              <button
                type="button"
                onClick={handleDelete}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-900/50 bg-rose-950/20 px-3.5 py-1.5 text-xs font-medium text-rose-400 transition-colors hover:bg-rose-900/30"
              >
                <Trash2 className="h-3.5 w-3.5" />
                削除
              </button>
            </>
          )}
        </div>
      </div>

      {/* メインカード */}
      <div className="overflow-hidden rounded-2xl border border-surface-800 bg-surface-900/80 shadow-xl backdrop-blur">
        {/* ヘッダー */}
        <div className="border-b border-surface-800 p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 font-mono text-xs text-brand-400">
                <span>{request.request_no}</span>
                <span>•</span>
                <span>{categoryLabel}</span>
              </div>
              <h1 className="mt-1 text-2xl font-bold text-surface-50">
                {request.title}
              </h1>
            </div>
            <div>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${statusInfo.bg} ${statusInfo.text} ${statusInfo.border}`}
              >
                {request.status === 'active' && <CheckCircle2 className="h-3.5 w-3.5" />}
                {request.status === 'pending_approval' && <Clock className="h-3.5 w-3.5" />}
                {request.status === 'rejected' && <AlertCircle className="h-3.5 w-3.5" />}
                {statusInfo.label}
              </span>
            </div>
          </div>

          {/* メタ情報 */}
          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-surface-800/60 pt-4 sm:grid-cols-4">
            <div>
              <div className="text-xs text-surface-500">申請金額</div>
              <div className="mt-0.5 font-mono text-base font-semibold text-surface-100">
                {request.amount !== null && request.amount !== undefined
                  ? `¥${Number(request.amount).toLocaleString()}`
                  : '金銭支出なし'}
              </div>
            </div>
            <div>
              <div className="text-xs text-surface-500">起票日時</div>
              <div className="mt-0.5 text-sm text-surface-200">
                {new Date(request.created_at).toLocaleString('ja-JP')}
              </div>
            </div>
            <div>
              <div className="text-xs text-surface-500">承認日時</div>
              <div className="mt-0.5 text-sm text-surface-200">
                {request.approved_at
                  ? new Date(request.approved_at).toLocaleString('ja-JP')
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-xs text-surface-500">添付ファイル</div>
              <div className="mt-0.5 text-sm text-surface-200">
                {request.attachment_id ? (
                  <span className="inline-flex items-center gap-1 text-brand-400">
                    <Paperclip className="h-3.5 w-3.5" />
                    あり
                  </span>
                ) : (
                  'なし'
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 申請内容 */}
        <div className="p-6 sm:p-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-surface-400">
            申請理由・詳細内容
          </h2>
          <div className="mt-3 whitespace-pre-wrap rounded-xl border border-surface-800 bg-surface-950/60 p-5 text-sm leading-relaxed text-surface-200">
            {request.description}
          </div>

          {/* 添付ファイルエリア */}
          {request.attachment_id && (
            <div className="mt-6">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-surface-400">
                添付証憑
              </h2>
              <div className="mt-3 flex items-center justify-between rounded-xl border border-surface-800 bg-surface-950/40 p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-surface-800 p-2 text-brand-400">
                    <Paperclip className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-surface-200">
                      稟議添付資料
                    </div>
                    <div className="font-mono text-xs text-surface-500">
                      ID: {request.attachment_id}
                    </div>
                  </div>
                </div>
                <a
                  href={`/api/attachments/${request.attachment_id}/download`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-surface-700 bg-surface-800 px-3 py-1.5 text-xs font-medium text-surface-300 transition-colors hover:bg-surface-700"
                >
                  <Download className="h-3.5 w-3.5" />
                  ダウンロード
                </a>
              </div>
            </div>
          )}

          {/* 承認申請提出アクション */}
          {(request.status === 'draft' || request.status === 'rejected') && (
            <div className="mt-8 rounded-xl border border-brand-800/40 bg-brand-950/20 p-5">
              <div className="sm:flex sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-brand-300">
                    承認フローへの提出
                  </h3>
                  <p className="mt-0.5 text-xs text-surface-400">
                    社内承認ルールに従って承認依頼を起票します。
                  </p>
                </div>
                <div className="mt-3 sm:mt-0">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handleSubmitApproval}
                    className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-500 disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    承認申請を提出
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 承認中インフォメーション */}
          {request.status === 'pending_approval' && (
            <div className="mt-8 rounded-xl border border-amber-800/40 bg-amber-950/20 p-5">
              <div className="flex items-start gap-3">
                <Clock className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-amber-300">
                    承認者による確認中
                  </h3>
                  <p className="mt-1 text-xs text-surface-400 leading-relaxed">
                    現在、割り当てられた承認ステップにて確認が行われています。承認が完了すると自動的に「承認済」となります。
                    承認担当者は「承認待ち」メニューから承認・却下操作を実行できます。
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 承認完了インフォメーション */}
          {request.status === 'active' && (
            <div className="mt-8 rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-5">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-emerald-300">
                    承認完了
                  </h3>
                  <p className="mt-1 text-xs text-surface-400 leading-relaxed">
                    この稟議申請は承認されました。本レコードは改ざん防止のため保護されています。
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
