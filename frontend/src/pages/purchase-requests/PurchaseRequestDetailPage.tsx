import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Edit,
  Send,
  Trash2,
  Building2,
  Package,
  Clock,
  CheckCircle2,
  Check,
  Ban,
} from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import type { components } from '../../types/api.generated';
import {
  STATUS_LABELS,
  type PurchaseRequestDetail,
  type PurchaseRequestStatus,
} from './types';

type PurchaseRequestDetailResponse = components['schemas']['PurchaseRequestDetailResponse'];

export function PurchaseRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<PurchaseRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [terminating, setTerminating] = useState(false);

  const fetchDetail = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<PurchaseRequestDetailResponse>(`/purchase-requests/${id}`);
      setDetail(res.data.data);
    } catch (err: any) {
      toast.error('発注申請データの取得に失敗しました');
      navigate('/purchase-requests');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) {
      fetchDetail();
    }
  }, [id]);

  const handleSubmitApproval = async () => {
    if (!detail) return;
    if (!confirm('この発注申請の承認申請を送信しますか？')) return;

    setSubmitting(true);
    try {
      await apiClient.post(`/purchase-requests/${detail.id}/submit`);
      toast.success('承認申請を送信しました');
      fetchDetail();
    } catch (err: any) {
      const msg = err.response?.data?.message || '承認申請の送信に失敗しました';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!detail) return;
    if (!confirm(`下書き発注申請「${detail.request_no}」を削除しますか？`)) return;

    try {
      await apiClient.delete(`/purchase-requests/${detail.id}`);
      toast.success('発注申請を削除しました');
      navigate('/purchase-requests');
    } catch (err: any) {
      const msg = err.response?.data?.message || '削除に失敗しました';
      toast.error(msg);
    }
  };

  const handleTerminate = async () => {
    if (!detail) return;
    if (!confirm(`承認済発注申請「${detail.request_no}」を解約・取消しますか？この操作は取り消せません。`)) return;

    setTerminating(true);
    try {
      await apiClient.post(`/purchase-requests/${detail.id}/terminate`);
      toast.success('発注申請を解約・取消しました');
      fetchDetail();
    } catch (err: any) {
      const msg = err.response?.data?.message || '解約・取消に失敗しました';
      toast.error(msg);
    } finally {
      setTerminating(false);
    }
  };

  if (loading) {
    return <div className="p-12 text-center text-surface-400">読み込み中...</div>;
  }

  if (!detail) {
    return (
      <div className="p-12 text-center text-surface-400">
        発注申請が見つかりませんでした
      </div>
    );
  }

  const statusInfo = STATUS_LABELS[detail.status as PurchaseRequestStatus] || {
    label: detail.status,
    bg: 'bg-surface-800',
    text: 'text-surface-400',
    border: 'border-surface-700',
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* ページ上部ナビゲーション & アクション */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            to="/purchase-requests"
            className="inline-flex items-center gap-1.5 text-sm text-surface-400 hover:text-surface-200 transition-colors mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            発注申請一覧に戻る
          </Link>
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm font-semibold text-indigo-400">
              {detail.request_no}
            </span>
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${statusInfo.bg} ${statusInfo.text} ${statusInfo.border}`}
            >
              {statusInfo.label}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-surface-50 mt-1">
            {detail.title}
          </h1>
        </div>

        {/* アクションボタン群 */}
        <div className="flex flex-wrap items-center gap-2">
          {detail.status === 'draft' && (
            <>
              <button
                onClick={handleSubmitApproval}
                disabled={submitting}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors shadow-sm disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                承認申請を送信
              </button>
              <Link
                to={`/purchase-requests/${detail.id}/edit`}
                className="inline-flex items-center gap-2 px-3.5 py-2 bg-surface-800 hover:bg-surface-700 text-surface-200 text-sm font-medium rounded-lg transition-colors"
              >
                <Edit className="w-4 h-4" />
                編集
              </Link>
              <button
                onClick={handleDelete}
                className="inline-flex items-center gap-2 px-3.5 py-2 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 text-sm font-medium rounded-lg transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                削除
              </button>
            </>
          )}

          {detail.status === 'active' && (
            <button
              onClick={handleTerminate}
              disabled={terminating}
              className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              <Ban className="w-4 h-4 text-zinc-400" />
              発注を解約・取消
            </button>
          )}
        </div>
      </div>

      {/* ステータスバナー */}
      {detail.status === 'pending_approval' && (
        <div className="p-4 bg-amber-950/30 border border-amber-800/50 rounded-xl flex items-start gap-3 text-amber-300">
          <Clock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <span className="font-semibold">承認審査中です。</span>
            承認者の審査完了後にステータスが「承認済(発注確定)」になります。
          </div>
        </div>
      )}

      {detail.status === 'active' && (
        <div className="p-4 bg-emerald-950/30 border border-emerald-800/50 rounded-xl flex items-start gap-3 text-emerald-300">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <span className="font-semibold">承認完了・発注確定済です。</span>
            {detail.approved_at && (
              <span className="ml-1 text-emerald-400/80">
                (承認日時: {new Date(detail.approved_at).toLocaleString('ja-JP')})
              </span>
            )}
            発注処理および納品受入の準備を進めてください。
          </div>
        </div>
      )}

      {detail.status === 'terminated' && (
        <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl flex items-start gap-3 text-zinc-400">
          <Ban className="w-5 h-5 text-zinc-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <span className="font-semibold">解約・取消済みの発注です。</span>
            この発注申請は解約処理が行われ、以降の変更・承認処理は行われません。
          </div>
        </div>
      )}

      {/* メイングリッド */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左側2カラム: 発注内容詳細 */}
        <div className="lg:col-span-2 space-y-6">
          {/* 金額・品目カード */}
          <div className="bg-surface-900 border border-surface-800 rounded-xl p-6 shadow-sm space-y-6">
            <div className="flex items-center justify-between border-b border-surface-800 pb-4">
              <h2 className="text-base font-semibold text-surface-100 flex items-center gap-2">
                <Package className="w-4 h-4 text-indigo-400" />
                品目・金額内訳
              </h2>
              <div className="text-right">
                <span className="text-xs text-surface-400">合計発注額</span>
                <div className="text-2xl font-bold font-mono text-indigo-400">
                  ¥{Number(detail.total_amount).toLocaleString()}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-3 bg-surface-950 border border-surface-800/80 rounded-lg">
                <span className="text-xs text-surface-400">品目説明 / 型番</span>
                <div className="font-medium text-surface-100 mt-1">
                  {detail.item_description}
                </div>
              </div>

              <div className="p-3 bg-surface-950 border border-surface-800/80 rounded-lg">
                <span className="text-xs text-surface-400">サプライヤー / 発注先</span>
                <div className="font-medium text-surface-100 mt-1 flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-surface-400 shrink-0" />
                  {detail.supplier_name}
                </div>
              </div>

              <div className="p-3 bg-surface-950 border border-surface-800/80 rounded-lg">
                <span className="text-xs text-surface-400">数量</span>
                <div className="font-medium font-mono text-surface-100 mt-1">
                  {Number(detail.quantity).toLocaleString()}
                </div>
              </div>

              <div className="p-3 bg-surface-950 border border-surface-800/80 rounded-lg">
                <span className="text-xs text-surface-400">単価</span>
                <div className="font-medium font-mono text-surface-100 mt-1">
                  ¥{Number(detail.unit_price).toLocaleString()}
                </div>
              </div>
            </div>

            {/* 備考・補足説明 */}
            {detail.description && (
              <div className="pt-2">
                <span className="text-xs font-semibold text-surface-400 uppercase tracking-wider block mb-2">
                  発注理由・備考
                </span>
                <div className="p-4 bg-surface-950 border border-surface-800 rounded-lg text-sm text-surface-200 whitespace-pre-wrap leading-relaxed">
                  {detail.description}
                </div>
              </div>
            )}
          </div>

          {/* 承認タイムライン (存在する場合) */}
          {detail.approval_request && (
            <div className="bg-surface-900 border border-surface-800 rounded-xl p-6 shadow-sm space-y-4">
              <h2 className="text-base font-semibold text-surface-100 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-indigo-400" />
                承認ワークフロー進捗
              </h2>

              <div className="space-y-4">
                {detail.approval_request.steps?.map((step: any, idx: number) => {
                  const isDone = step.action === 'approved';
                  const isCurrent =
                    detail.approval_request?.current_step === step.step_number &&
                    detail.approval_request?.status === 'pending';

                  return (
                    <div
                      key={idx}
                      className="flex items-start gap-3 pb-4 border-b border-surface-800/60 last:border-0 last:pb-0"
                    >
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
                          isDone
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-700'
                            : isCurrent
                            ? 'bg-amber-950 text-amber-400 border border-amber-600 animate-pulse'
                            : 'bg-surface-800 text-surface-400 border border-surface-700'
                        }`}
                      >
                        {isDone ? <Check className="w-4 h-4" /> : step.step_number}
                      </div>

                      <div className="flex-1 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-surface-200">
                            ステップ {step.step_number}: {step.approver_role || '承認担当'}
                          </span>
                          {step.action_at && (
                            <span className="text-xs text-surface-500">
                              {new Date(step.action_at).toLocaleString('ja-JP')}
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-surface-400 mt-1">
                          アクション: {step.action || (isCurrent ? '審査待ち' : '未着手')}
                        </div>

                        {step.comment && (
                          <div className="mt-2 p-2.5 bg-surface-950 border border-surface-800/60 rounded text-xs text-surface-300">
                            コメント: {step.comment}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 右側1カラム: メタ情報 */}
        <div className="space-y-6">
          <div className="bg-surface-900 border border-surface-800 rounded-xl p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-surface-200 border-b border-surface-800 pb-2">
              申請情報
            </h3>

            <div className="space-y-3 text-sm">
              <div>
                <span className="text-xs text-surface-500 block">希望納期</span>
                <span className="font-medium text-surface-200">
                  {detail.requested_delivery_date || '未設定'}
                </span>
              </div>

              <div>
                <span className="text-xs text-surface-500 block">通貨</span>
                <span className="font-medium text-surface-200">
                  {detail.currency}
                </span>
              </div>

              <div>
                <span className="text-xs text-surface-500 block">起票日時</span>
                <span className="font-medium text-surface-200">
                  {new Date(detail.created_at).toLocaleString('ja-JP')}
                </span>
              </div>

              <div>
                <span className="text-xs text-surface-500 block">更新日時</span>
                <span className="font-medium text-surface-200">
                  {new Date(detail.updated_at).toLocaleString('ja-JP')}
                </span>
              </div>

              {detail.approved_at && (
                <div>
                  <span className="text-xs text-surface-500 block">最終承認日時</span>
                  <span className="font-medium text-emerald-400">
                    {new Date(detail.approved_at).toLocaleString('ja-JP')}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
