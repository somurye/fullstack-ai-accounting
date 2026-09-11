import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  ShoppingCart,
  ArrowLeft,
  Save,
  Send,
  Building2,
  Package,
  Coins,
  Calendar,
  FileText,
} from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import type { components } from '../../types/api.generated';

type PurchaseRequestResponse = components['schemas']['PurchaseRequestResponse'];
type PurchaseRequestDetailResponse = components['schemas']['PurchaseRequestDetailResponse'];

export function PurchaseRequestFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [quantity, setQuantity] = useState<number | ''>(1);
  const [unitPrice, setUnitPrice] = useState<number | ''>(0);
  const [totalAmount, setTotalAmount] = useState<number | ''>(0);
  const [currency, setCurrency] = useState('JPY');
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState('');
  const [description, setDescription] = useState('');
  const [attachmentId, setAttachmentId] = useState('');

  // 数量または単価の変更時に合計金額を自動計算
  const handleQuantityChange = (val: number | '') => {
    setQuantity(val);
    if (typeof val === 'number' && typeof unitPrice === 'number') {
      setTotalAmount(Math.round(val * unitPrice * 100) / 100);
    }
  };

  const handleUnitPriceChange = (val: number | '') => {
    setUnitPrice(val);
    if (typeof quantity === 'number' && typeof val === 'number') {
      setTotalAmount(Math.round(quantity * val * 100) / 100);
    }
  };

  useEffect(() => {
    if (!isEdit) return;

    const fetchDetail = async () => {
      try {
        const res = await apiClient.get<PurchaseRequestDetailResponse>(`/purchase-requests/${id}`);
        const data = res.data.data;
        if (data.status !== 'draft') {
          toast.error('下書き以外の発注申請は編集できません');
          navigate(`/purchase-requests/${id}`);
          return;
        }

        setTitle(data.title);
        setSupplierName(data.supplier_name);
        setItemDescription(data.item_description);
        setQuantity(data.quantity);
        setUnitPrice(data.unit_price);
        setTotalAmount(data.total_amount);
        setCurrency(data.currency || 'JPY');
        setRequestedDeliveryDate(data.requested_delivery_date || '');
        setDescription(data.description || '');
        setAttachmentId(data.attachment_id || '');
      } catch (err: any) {
        toast.error('発注申請データの取得に失敗しました');
        navigate('/purchase-requests');
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [id, isEdit, navigate]);

  const handleSubmit = async (andSubmitApproval = false) => {
    if (!title.trim()) {
      toast.error('件名を入力してください');
      return;
    }
    if (!supplierName.trim()) {
      toast.error('サプライヤー名を入力してください');
      return;
    }
    if (!itemDescription.trim()) {
      toast.error('品目説明を入力してください');
      return;
    }
    if (typeof quantity !== 'number' || quantity <= 0) {
      toast.error('数量は0より大きい数値を入力してください');
      return;
    }
    if (typeof unitPrice !== 'number' || unitPrice < 0) {
      toast.error('単価は0以上の数値を入力してください');
      return;
    }
    if (typeof totalAmount !== 'number' || totalAmount < 0) {
      toast.error('合計金額は0以上の数値を入力してください');
      return;
    }

    // 整合性チェック
    const expectedTotal = Math.round(quantity * unitPrice * 100) / 100;
    if (Math.abs(totalAmount - expectedTotal) > 0.01) {
      toast.error(`合計金額が数量×単価（¥${expectedTotal.toLocaleString()}）と一致していません`);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        supplier_name: supplierName.trim(),
        item_description: itemDescription.trim(),
        quantity,
        unit_price: unitPrice,
        total_amount: totalAmount,
        currency,
        requested_delivery_date: requestedDeliveryDate || undefined,
        description: description.trim() || undefined,
        attachment_id: attachmentId.trim() || undefined,
      };

      let targetId = id;
      if (isEdit) {
        await apiClient.put(`/purchase-requests/${id}`, payload);
        toast.success('下書きを更新しました');
      } else {
        const res = await apiClient.post<PurchaseRequestResponse>('/purchase-requests', payload);
        targetId = res.data.data.id;
        toast.success('発注申請を下書き保存しました');
      }

      if (andSubmitApproval && targetId) {
        try {
          await apiClient.post(`/purchase-requests/${targetId}/submit`);
          toast.success('承認申請を送信しました');
        } catch (subErr: any) {
          const msg = subErr.response?.data?.message || '承認申請の送信に失敗しました';
          toast.error(msg);
          navigate(`/purchase-requests/${targetId}`);
          return;
        }
      }

      navigate(targetId ? `/purchase-requests/${targetId}` : '/purchase-requests');
    } catch (err: any) {
      const msg = err.response?.data?.message || '保存に失敗しました';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-12 text-center text-surface-400">読み込み中...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* ページヘッダー */}
      <div>
        <Link
          to="/purchase-requests"
          className="inline-flex items-center gap-1.5 text-sm text-surface-400 hover:text-surface-200 transition-colors mb-3"
        >
          <ArrowLeft className="w-4 h-4" />
          発注申請一覧に戻る
        </Link>
        <h1 className="text-2xl font-bold text-surface-50 flex items-center gap-2">
          <ShoppingCart className="w-7 h-7 text-indigo-400" />
          {isEdit ? '発注申請の編集' : '新規発注申請の起票'}
        </h1>
        <p className="text-sm text-surface-400 mt-1">
          品目、数量、単価、サプライヤー情報および希望納期を入力して申請を作成します
        </p>
      </div>

      {/* フォームカード */}
      <div className="bg-surface-900 border border-surface-800 rounded-xl p-6 shadow-sm space-y-6">
        {/* 基本情報 */}
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-surface-100 flex items-center gap-2 border-b border-surface-800 pb-2">
            <FileText className="w-4 h-4 text-indigo-400" />
            基本情報
          </h2>

          <div>
            <label className="block text-sm font-medium text-surface-200 mb-1.5">
              件名 <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: 開発用PC・モニター追加購入、オフィスクリーニング備品発注"
              className="w-full px-3.5 py-2.5 bg-surface-950 border border-surface-800 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:border-indigo-500 text-sm"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-surface-200 mb-1.5 flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-surface-400" />
                サプライヤー / 発注先名 <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="例: 株式会社テックサプライ、オフィスデポ"
                className="w-full px-3.5 py-2.5 bg-surface-950 border border-surface-800 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:border-indigo-500 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-surface-200 mb-1.5 flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-surface-400" />
                希望納期
              </label>
              <input
                type="date"
                value={requestedDeliveryDate}
                onChange={(e) => setRequestedDeliveryDate(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-surface-950 border border-surface-800 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:border-indigo-500 text-sm"
              />
            </div>
          </div>
        </div>

        {/* 品目・金額情報 */}
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-surface-100 flex items-center gap-2 border-b border-surface-800 pb-2">
            <Package className="w-4 h-4 text-indigo-400" />
            品目・数量・金額
          </h2>

          <div>
            <label className="block text-sm font-medium text-surface-200 mb-1.5">
              品目説明・型番・内訳 <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              value={itemDescription}
              onChange={(e) => setItemDescription(e.target.value)}
              placeholder="例: MacBook Pro 14インチ (M3 Pro / 36GB / 512GB)"
              className="w-full px-3.5 py-2.5 bg-surface-950 border border-surface-800 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:border-indigo-500 text-sm"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-surface-200 mb-1.5">
                数量 <span className="text-rose-400">*</span>
              </label>
              <input
                type="number"
                step="any"
                min="0.0001"
                value={quantity}
                onChange={(e) => handleQuantityChange(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-3.5 py-2.5 bg-surface-950 border border-surface-800 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:border-indigo-500 text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-surface-200 mb-1.5">
                単価 (税抜/税込) <span className="text-rose-400">*</span>
              </label>
              <input
                type="number"
                step="any"
                min="0"
                value={unitPrice}
                onChange={(e) => handleUnitPriceChange(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-3.5 py-2.5 bg-surface-950 border border-surface-800 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:border-indigo-500 text-sm font-mono"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-surface-200 mb-1.5 flex items-center justify-between">
                <span>合計金額 <span className="text-rose-400">*</span></span>
                <span className="text-xs text-surface-400">数量 × 単価 連動</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={totalAmount}
                  onChange={(e) => setTotalAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full pl-8 pr-12 py-2.5 bg-surface-950 border border-surface-800 rounded-lg text-surface-100 font-mono font-semibold focus:outline-none focus:border-indigo-500 text-sm"
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 text-xs">¥</span>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-500 text-xs">{currency}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 備考・添付ファイル */}
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-surface-100 flex items-center gap-2 border-b border-surface-800 pb-2">
            <Coins className="w-4 h-4 text-indigo-400" />
            備考・補足
          </h2>

          <div>
            <label className="block text-sm font-medium text-surface-200 mb-1.5">
              発注の目的・選定理由・補足事項
            </label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="発注が必要な背景や、サプライヤー選定理由などを記載してください"
              className="w-full px-3.5 py-2.5 bg-surface-950 border border-surface-800 rounded-lg text-surface-100 placeholder-surface-500 focus:outline-none focus:border-indigo-500 text-sm"
            />
          </div>
        </div>

        {/* アクションボタン */}
        <div className="pt-4 border-t border-surface-800 flex flex-col-reverse sm:flex-row items-center justify-end gap-3">
          <Link
            to="/purchase-requests"
            className="w-full sm:w-auto px-4 py-2.5 bg-surface-800 hover:bg-surface-700 text-surface-200 font-medium rounded-lg text-sm text-center transition-colors"
          >
            キャンセル
          </Link>
          <button
            type="button"
            onClick={() => handleSubmit(false)}
            disabled={saving}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-surface-700 hover:bg-surface-600 text-white font-medium rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            下書き保存
          </button>
          <button
            type="button"
            onClick={() => handleSubmit(true)}
            disabled={saving}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg text-sm transition-colors shadow-sm disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            保存して承認申請を送信
          </button>
        </div>
      </div>
    </div>
  );
}
