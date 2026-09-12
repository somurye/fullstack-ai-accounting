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
  Ban,
  Receipt,
  FileText,
  Plus,
  Link2,
  Unlink,
} from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import {
  STATUS_LABELS,
  type ExtendedPurchaseRequestDetail,
  type PurchaseRequestStatus,
  type PurchaseReceipt,
  type LinkedVendorBill,
} from './types';

export function PurchaseRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<ExtendedPurchaseRequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [terminating, setTerminating] = useState(false);

  // 検収モーダル状態
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [receiptQuantity, setReceiptQuantity] = useState<number>(0);
  const [receiptDate, setReceiptDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [receiptNotes, setReceiptNotes] = useState<string>('');
  const [savingReceipt, setSavingReceipt] = useState(false);

  // 請求書紐付けモーダル状態
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [availableBills, setAvailableBills] = useState<any[]>([]);
  const [selectedBillId, setSelectedBillId] = useState<string>('');
  const [loadingBills, setLoadingBills] = useState(false);
  const [linkingBill, setLinkingBill] = useState(false);

  const fetchDetail = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<any>(`/purchase-requests/${id}`);
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

  // 検収登録
  const handleOpenReceiptModal = () => {
    if (!detail) return;
    const remaining = detail.remaining_quantity !== undefined ? detail.remaining_quantity : detail.quantity;
    setReceiptQuantity(remaining > 0 ? remaining : 1);
    setReceiptDate(new Date().toISOString().slice(0, 10));
    setReceiptNotes('');
    setShowReceiptModal(true);
  };

  const handleSubmitReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    if (receiptQuantity <= 0) {
      toast.error('受領数量は0より大きい数値を入力してください');
      return;
    }

    setSavingReceipt(true);
    try {
      await apiClient.post(`/purchase-requests/${detail.id}/receipts`, {
        received_quantity: receiptQuantity,
        received_date: receiptDate,
        notes: receiptNotes.trim() || undefined,
      });
      toast.success('検収記録を登録しました');
      setShowReceiptModal(false);
      fetchDetail();
    } catch (err: any) {
      const msg = err.response?.data?.message || '検収記録の登録に失敗しました';
      toast.error(msg);
    } finally {
      setSavingReceipt(false);
    }
  };

  // 請求書紐付け
  const handleOpenLinkModal = async () => {
    setShowLinkModal(true);
    setLoadingBills(true);
    try {
      const res = await apiClient.get<any>('/vendor-bills', { params: { page_size: 50 } });
      const bills = res.data?.data || [];
      setAvailableBills(bills);
      if (bills.length > 0) {
        setSelectedBillId(bills[0].id);
      }
    } catch (err: any) {
      toast.error('仕入請求書一覧の取得に失敗しました');
    } finally {
      setLoadingBills(false);
    }
  };

  const handleSubmitLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !selectedBillId) return;

    setLinkingBill(true);
    try {
      await apiClient.post(`/purchase-requests/${detail.id}/link-bill`, {
        vendor_bill_id: selectedBillId,
      });
      toast.success('仕入請求書を紐付けました');
      setShowLinkModal(false);
      fetchDetail();
    } catch (err: any) {
      const msg = err.response?.data?.message || '仕入請求書の紐付けに失敗しました';
      toast.error(msg);
    } finally {
      setLinkingBill(false);
    }
  };

  const handleUnlinkBill = async (vendorBillId: string) => {
    if (!detail) return;
    if (!confirm('この仕入請求書との紐付けを解除しますか？')) return;

    try {
      await apiClient.delete(`/purchase-requests/${detail.id}/link-bill/${vendorBillId}`);
      toast.success('紐付けを解除しました');
      fetchDetail();
    } catch (err: any) {
      const msg = err.response?.data?.message || '紐付け解除に失敗しました';
      toast.error(msg);
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

  const totalReceived = detail.total_received_quantity ?? 0;
  const remainingQty = detail.remaining_quantity ?? Math.max(0, detail.quantity - totalReceived);
  const completionRate = Math.min(100, Math.round((totalReceived / detail.quantity) * 100));

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
            <>
              <button
                onClick={handleOpenReceiptModal}
                disabled={remainingQty <= 0}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors shadow-sm disabled:opacity-50 disabled:bg-surface-800 disabled:text-surface-500"
              >
                <Receipt className="w-4 h-4" />
                {remainingQty <= 0 ? '検収完納済' : '検収を記録する'}
              </button>
              <button
                onClick={handleOpenLinkModal}
                className="inline-flex items-center gap-2 px-3.5 py-2 bg-surface-800 hover:bg-surface-700 text-surface-200 text-sm font-medium rounded-lg transition-colors border border-surface-700"
              >
                <Link2 className="w-4 h-4 text-indigo-400" />
                仕入請求書を紐付け
              </button>
              <button
                onClick={handleTerminate}
                disabled={terminating}
                className="inline-flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                <Ban className="w-4 h-4 text-zinc-400" />
                解約・取消
              </button>
            </>
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
            納品物を受領した際は「検収を記録する」から受領登録を行ってください。
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
        {/* 左側2カラム: 発注内容詳細 & 検収・請求連携 */}
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
                <div className="flex items-center justify-between">
                  <span className="text-xs text-surface-400">サプライヤー / 発注先</span>
                  {detail.supplier_id ? (
                    <span className="text-[10px] font-medium text-indigo-400 bg-indigo-950/60 border border-indigo-800/60 px-1.5 py-0.5 rounded">
                      マスタ登録済
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium text-surface-400 bg-surface-800/60 px-1.5 py-0.5 rounded">
                      手入力
                    </span>
                  )}
                </div>
                <div className="font-medium text-surface-100 mt-1 flex items-center gap-1.5">
                  <Building2 className="w-4 h-4 text-surface-400 shrink-0" />
                  {detail.supplier_name}
                </div>
              </div>

              <div className="p-3 bg-surface-950 border border-surface-800/80 rounded-lg">
                <span className="text-xs text-surface-400">発注数量</span>
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

          {/* 検収進捗 & 履歴カード (P2-T3) */}
          <div className="bg-surface-900 border border-surface-800 rounded-xl p-6 shadow-sm space-y-5">
            <div className="flex items-center justify-between border-b border-surface-800 pb-3">
              <h2 className="text-base font-semibold text-surface-100 flex items-center gap-2">
                <Receipt className="w-4 h-4 text-emerald-400" />
                検収・納品受領状況
              </h2>
              {detail.status === 'active' && remainingQty > 0 && (
                <button
                  onClick={handleOpenReceiptModal}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-400 bg-emerald-950/50 hover:bg-emerald-900/60 border border-emerald-800/60 rounded-md transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  検収を記録
                </button>
              )}
            </div>

            {/* 進捗プログレスバー */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-surface-400">
                <span>検収進捗率: <strong className="text-surface-200 font-mono">{completionRate}%</strong></span>
                <span>
                  受領済: <strong className="text-emerald-400 font-mono">{totalReceived}</strong> / 発注数: <span className="font-mono">{detail.quantity}</span>
                  {remainingQty > 0 && <span className="text-amber-400 ml-2">(残: {remainingQty})</span>}
                </span>
              </div>
              <div className="w-full bg-surface-950 rounded-full h-2.5 overflow-hidden border border-surface-800">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${completionRate >= 100 ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                  style={{ width: `${completionRate}%` }}
                />
              </div>
            </div>

            {/* 検収履歴テーブル */}
            {detail.receipts && detail.receipts.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-surface-300">
                  <thead className="bg-surface-950 text-surface-400 uppercase border-b border-surface-800">
                    <tr>
                      <th className="p-2.5">受領日</th>
                      <th className="p-2.5 text-right">受領数量</th>
                      <th className="p-2.5">受領担当</th>
                      <th className="p-2.5">メモ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-800">
                    {detail.receipts.map((rec: PurchaseReceipt) => (
                      <tr key={rec.id} className="hover:bg-surface-850/50">
                        <td className="p-2.5 font-mono">{rec.received_date}</td>
                        <td className="p-2.5 text-right font-mono font-bold text-emerald-400">
                          +{rec.received_quantity}
                        </td>
                        <td className="p-2.5 text-surface-300">{rec.received_by_name || '担当者'}</td>
                        <td className="p-2.5 text-surface-400">{rec.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-surface-500 bg-surface-950/50 border border-surface-800/40 rounded-lg">
                検収記録はまだ登録されていません。納品物受領後に検収を記録してください。
              </div>
            )}
          </div>

          {/* 紐付け仕入請求書カード (P2-T3) */}
          <div className="bg-surface-900 border border-surface-800 rounded-xl p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-surface-800 pb-3">
              <h2 className="text-base font-semibold text-surface-100 flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-400" />
                紐付け仕入請求書 (買掛金)
              </h2>
              {detail.status === 'active' && (
                <button
                  onClick={handleOpenLinkModal}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-indigo-400 bg-indigo-950/50 hover:bg-indigo-900/60 border border-indigo-800/60 rounded-md transition-colors"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  請求書を紐付け
                </button>
              )}
            </div>

            {detail.linked_vendor_bills && detail.linked_vendor_bills.length > 0 ? (
              <div className="space-y-3">
                {detail.linked_vendor_bills.map((bill: LinkedVendorBill) => (
                  <div
                    key={bill.id}
                    className="p-3.5 bg-surface-950 border border-surface-800 rounded-lg flex items-center justify-between text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-indigo-400">{bill.bill_no}</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-800 text-surface-300">
                          {bill.status}
                        </span>
                      </div>
                      <div className="text-surface-400">
                        請求日: {bill.bill_date} / 支払期日: {bill.due_date}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <span className="text-[10px] text-surface-500 block">請求額</span>
                        <span className="font-mono font-bold text-surface-100 text-sm">
                          ¥{Number(bill.total_amount).toLocaleString()}
                        </span>
                      </div>
                      <button
                        onClick={() => handleUnlinkBill(bill.id)}
                        className="p-1.5 text-surface-500 hover:text-rose-400 hover:bg-rose-950/30 rounded transition-colors"
                        title="紐付け解除"
                      >
                        <Unlink className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-surface-500 bg-surface-950/50 border border-surface-800/40 rounded-lg">
                紐付けられた仕入請求書はありません。
              </div>
            )}
          </div>
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

      {/* 検収登録モーダル */}
      {showReceiptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface-900 border border-surface-800 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-surface-800 pb-3">
              <h3 className="text-base font-bold text-surface-100 flex items-center gap-2">
                <Receipt className="w-5 h-5 text-emerald-400" />
                検収・納品受領の記録
              </h3>
              <button
                onClick={() => setShowReceiptModal(false)}
                className="text-surface-400 hover:text-surface-200"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitReceipt} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-medium text-surface-300 mb-1">
                  受領日 <span className="text-rose-400">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={receiptDate}
                  onChange={(e) => setReceiptDate(e.target.value)}
                  className="w-full bg-surface-950 border border-surface-800 rounded-lg px-3 py-2 text-surface-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-surface-300 mb-1">
                  受領数量 <span className="text-rose-400">*</span>
                  <span className="text-xs text-surface-500 ml-2">(残数量: {remainingQty})</span>
                </label>
                <input
                  type="number"
                  min="0.01"
                  max={remainingQty}
                  step="any"
                  required
                  value={receiptQuantity}
                  onChange={(e) => setReceiptQuantity(Number(e.target.value))}
                  className="w-full bg-surface-950 border border-surface-800 rounded-lg px-3 py-2 text-surface-100 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-surface-300 mb-1">
                  検収メモ / 備考
                </label>
                <textarea
                  rows={3}
                  value={receiptNotes}
                  onChange={(e) => setReceiptNotes(e.target.value)}
                  placeholder="分納第1回受領、外装破損なし確認 等"
                  className="w-full bg-surface-950 border border-surface-800 rounded-lg px-3 py-2 text-surface-100 placeholder:text-surface-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowReceiptModal(false)}
                  className="px-4 py-2 bg-surface-800 hover:bg-surface-700 text-surface-300 rounded-lg transition-colors"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={savingReceipt}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {savingReceipt ? '保存中...' : '登録する'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 請求書紐付けモーダル */}
      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface-900 border border-surface-800 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-surface-800 pb-3">
              <h3 className="text-base font-bold text-surface-100 flex items-center gap-2">
                <Link2 className="w-5 h-5 text-indigo-400" />
                仕入請求書の紐付け
              </h3>
              <button
                onClick={() => setShowLinkModal(false)}
                className="text-surface-400 hover:text-surface-200"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitLink} className="space-y-4 text-sm">
              {loadingBills ? (
                <div className="p-8 text-center text-surface-400">仕入請求書を読み込み中...</div>
              ) : availableBills.length === 0 ? (
                <div className="p-6 text-center text-surface-500 bg-surface-950 rounded-lg">
                  紐付け可能な仕入請求書が見つかりませんでした。
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-surface-300 mb-2">
                    紐付ける仕入請求書を選択
                  </label>
                  <select
                    value={selectedBillId}
                    onChange={(e) => setSelectedBillId(e.target.value)}
                    className="w-full bg-surface-950 border border-surface-800 rounded-lg px-3 py-2 text-surface-100 focus:outline-none focus:border-indigo-500 font-mono"
                  >
                    {availableBills.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.bill_no} (¥{Number(b.total_amount).toLocaleString()}) - 期日: {b.due_date}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowLinkModal(false)}
                  className="px-4 py-2 bg-surface-800 hover:bg-surface-700 text-surface-300 rounded-lg transition-colors"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={linkingBill || availableBills.length === 0}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {linkingBill ? '紐付け中...' : '紐付ける'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

