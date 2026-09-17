import {
  ArrowLeft,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from '../../stores/toastStore';
import {
  useCreateQuotation,
  useCustomers,
  useQuotation,
  useUpdateQuotation,
} from './hooks';
import type {
  QuotationFormInput,
  QuotationLineItemFormInput,
} from './types';

const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

const initialLine: QuotationLineItemFormInput = {
  item_name: '',
  description: '',
  quantity: 1,
  unit: '式',
  unit_price: 0,
  tax_rate: 0.1,
};

export function QuotationFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const { data: customers = [] } = useCustomers();
  const { data: existingQuotation, isLoading: isQuoteLoading } = useQuotation(id);

  const createMutation = useCreateQuotation();
  const updateMutation = useUpdateQuotation(id ?? '');

  const [customerId, setCustomerId] = useState('');
  const [title, setTitle] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<QuotationLineItemFormInput[]>([{ ...initialLine }]);

  // 編集時の初期値セット
  useEffect(() => {
    if (existingQuotation) {
      if (existingQuotation.status !== 'draft') {
        toast.error('下書き状態以外の見積書は直接編集できません');
        navigate(`/quotations/${existingQuotation.id}`);
        return;
      }
      setCustomerId(existingQuotation.customer_id);
      setTitle(existingQuotation.title);
      setIssueDate(existingQuotation.issue_date);
      setValidUntil(existingQuotation.valid_until ?? '');
      setNotes(existingQuotation.notes ?? '');
      if (existingQuotation.lines && existingQuotation.lines.length > 0) {
        setLines(
          existingQuotation.lines.map((l) => ({
            item_name: l.item_name,
            description: l.description ?? '',
            quantity: l.quantity,
            unit: l.unit,
            unit_price: l.unit_price,
            tax_rate: l.tax_rate,
            tax_category_id: l.tax_category_id,
          })),
        );
      }
    }
  }, [existingQuotation, navigate]);

  // 行操作
  const handleAddLine = () => {
    setLines([...lines, { ...initialLine }]);
  };

  const handleRemoveLine = (index: number) => {
    if (lines.length <= 1) {
      toast.error('見積明細は最低1行必要です');
      return;
    }
    setLines(lines.filter((_, i) => i !== index));
  };

  const handleLineChange = (
    index: number,
    field: keyof QuotationLineItemFormInput,
    value: unknown,
  ) => {
    const updated = [...lines];
    updated[index] = {
      ...updated[index],
      [field]: value,
    };
    setLines(updated);
  };

  // 金額自動計算
  const subtotal = lines.reduce(
    (sum, l) => sum + Math.round((Number(l.quantity) || 0) * (Number(l.unit_price) || 0)),
    0,
  );
  const taxAmount = lines.reduce(
    (sum, l) =>
      sum +
      Math.round(
        Math.round((Number(l.quantity) || 0) * (Number(l.unit_price) || 0)) *
          (Number(l.tax_rate) || 0.1),
      ),
    0,
  );
  const totalAmount = subtotal + taxAmount;

  // フォーム送信
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!customerId) {
      toast.error('顧客を選択してください');
      return;
    }
    if (!title.trim()) {
      toast.error('件名を入力してください');
      return;
    }
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].item_name.trim()) {
        toast.error(`行 ${i + 1}: 品目名を入力してください`);
        return;
      }
      if (Number(lines[i].quantity) <= 0) {
        toast.error(`行 ${i + 1}: 数量は正の数を入力してください`);
        return;
      }
      if (Number(lines[i].unit_price) < 0) {
        toast.error(`行 ${i + 1}: 単価は0以上を入力してください`);
        return;
      }
    }

    const payload: QuotationFormInput = {
      customer_id: customerId,
      title: title.trim(),
      issue_date: issueDate || undefined,
      valid_until: validUntil || null,
      notes: notes.trim() || null,
      lines: lines.map((l) => ({
        item_name: l.item_name.trim(),
        description: l.description?.trim() || null,
        quantity: Number(l.quantity),
        unit: l.unit || '式',
        unit_price: Number(l.unit_price),
        tax_rate: Number(l.tax_rate) || 0.1,
      })),
    };

    if (isEdit && id) {
      await updateMutation.mutateAsync(payload, {
        onSuccess: (res) => navigate(`/quotations/${res.id}`),
      });
    } else {
      await createMutation.mutateAsync(payload, {
        onSuccess: (res) => navigate(`/quotations/${res.id}`),
      });
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  if (isEdit && isQuoteLoading) {
    return <div className="p-8 text-center text-surface-400">読み込み中...</div>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ページ上部 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to={isEdit ? `/quotations/${id}` : '/quotations'}
            className="rounded-lg border border-surface-700 bg-surface-800 p-2 text-surface-400 hover:text-surface-200"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-surface-100">
              {isEdit ? '見積書編集 (下書き)' : '新規見積書作成'}
            </h1>
            <p className="text-xs text-surface-400">
              顧客を選択し、明細行を入力して下書き見積を保存します。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to={isEdit ? `/quotations/${id}` : '/quotations'}
            className="rounded-lg border border-surface-700 px-4 py-2 text-sm font-medium text-surface-300 hover:bg-surface-800"
          >
            キャンセル
          </Link>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {isSubmitting ? '保存中...' : '下書き保存'}
          </button>
        </div>
      </div>

      {/* 基本情報カード */}
      <div className="rounded-xl border border-surface-800 bg-surface-900 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-surface-200 border-b border-surface-800 pb-2">
          基本情報
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-surface-300">
              顧客 <span className="text-rose-400">*</span>
            </label>
            <select
              required
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-surface-100 focus:border-indigo-500 focus:outline-none"
            >
              <option value="">顧客を選択してください</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-xs font-medium text-surface-300">
              件名 <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="例: クラウド基盤構築および初期移行支援"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-surface-100 placeholder-surface-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-surface-300">発行日</label>
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-surface-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-surface-300">有効期限</label>
            <input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-surface-100 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5 sm:col-span-3">
            <label className="text-xs font-medium text-surface-300">備考</label>
            <input
              type="text"
              placeholder="納品条件、お支払い条件など"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-sm text-surface-100 placeholder-surface-500 focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* 見積明細グリッド */}
      <div className="rounded-xl border border-surface-800 bg-surface-900 p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-surface-800 pb-2">
          <h2 className="text-sm font-semibold text-surface-200">見積明細</h2>
          <button
            type="button"
            onClick={handleAddLine}
            className="inline-flex items-center gap-1 rounded-md border border-surface-700 bg-surface-800 px-2.5 py-1 text-xs font-medium text-indigo-400 hover:bg-surface-700"
          >
            <Plus className="h-3.5 w-3.5" />
            行を追加
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-surface-400">
              <tr>
                <th className="w-10 pb-2">#</th>
                <th className="pb-2 min-w-[200px]">品名 <span className="text-rose-400">*</span></th>
                <th className="pb-2 min-w-[150px]">詳細・摘要</th>
                <th className="pb-2 w-24">数量 <span className="text-rose-400">*</span></th>
                <th className="pb-2 w-20">単位</th>
                <th className="pb-2 w-32">単価 (円) <span className="text-rose-400">*</span></th>
                <th className="pb-2 w-24">税率</th>
                <th className="pb-2 w-32 text-right">金額 (税抜)</th>
                <th className="pb-2 w-12 text-center"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-800/60">
              {lines.map((line, index) => {
                const lineAmount = Math.round(
                  (Number(line.quantity) || 0) * (Number(line.unit_price) || 0),
                );
                return (
                  <tr key={index} className="group">
                    <td className="py-2 text-xs text-surface-500">{index + 1}</td>
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        required
                        placeholder="品目名"
                        value={line.item_name}
                        onChange={(e) => handleLineChange(index, 'item_name', e.target.value)}
                        className="w-full rounded-md border border-surface-700 bg-surface-800/90 px-2.5 py-1.5 text-xs text-surface-100 focus:border-indigo-500 focus:outline-none"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        placeholder="詳細説明"
                        value={line.description ?? ''}
                        onChange={(e) => handleLineChange(index, 'description', e.target.value)}
                        className="w-full rounded-md border border-surface-700 bg-surface-800/90 px-2.5 py-1.5 text-xs text-surface-100 focus:border-indigo-500 focus:outline-none"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="number"
                        required
                        min="0.01"
                        step="any"
                        value={line.quantity}
                        onChange={(e) => handleLineChange(index, 'quantity', parseFloat(e.target.value) || 0)}
                        className="w-full rounded-md border border-surface-700 bg-surface-800/90 px-2.5 py-1.5 text-xs text-surface-100 focus:border-indigo-500 focus:outline-none"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        value={line.unit}
                        onChange={(e) => handleLineChange(index, 'unit', e.target.value)}
                        className="w-full rounded-md border border-surface-700 bg-surface-800/90 px-2.5 py-1.5 text-xs text-surface-100 focus:border-indigo-500 focus:outline-none"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="number"
                        required
                        min="0"
                        step="1"
                        value={line.unit_price}
                        onChange={(e) => handleLineChange(index, 'unit_price', parseFloat(e.target.value) || 0)}
                        className="w-full rounded-md border border-surface-700 bg-surface-800/90 px-2.5 py-1.5 text-xs text-surface-100 focus:border-indigo-500 focus:outline-none"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <select
                        value={line.tax_rate}
                        onChange={(e) => handleLineChange(index, 'tax_rate', parseFloat(e.target.value))}
                        className="w-full rounded-md border border-surface-700 bg-surface-800/90 px-2 py-1.5 text-xs text-surface-100 focus:border-indigo-500 focus:outline-none"
                      >
                        <option value={0.1}>10%</option>
                        <option value={0.08}>8% (軽減)</option>
                        <option value={0.0}>0% (非課税)</option>
                      </select>
                    </td>
                    <td className="py-2 text-right font-medium text-surface-200">
                      {currencyFormatter.format(lineAmount)}
                    </td>
                    <td className="py-2 text-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveLine(index)}
                        className="text-surface-500 hover:text-rose-400 p-1"
                        title="行を削除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 合計金額サマリー */}
        <div className="flex justify-end pt-4 border-t border-surface-800">
          <div className="w-72 space-y-2 rounded-lg bg-surface-950/60 p-4 border border-surface-800/80">
            <div className="flex justify-between text-xs text-surface-400">
              <span>小計 (税抜)</span>
              <span className="font-semibold text-surface-200">{currencyFormatter.format(subtotal)}</span>
            </div>
            <div className="flex justify-between text-xs text-surface-400">
              <span>消費税額</span>
              <span className="font-semibold text-surface-200">{currencyFormatter.format(taxAmount)}</span>
            </div>
            <div className="border-t border-surface-800 pt-2 flex justify-between text-sm font-bold text-indigo-300">
              <span>合計金額 (税込)</span>
              <span>{currencyFormatter.format(totalAmount)}</span>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
