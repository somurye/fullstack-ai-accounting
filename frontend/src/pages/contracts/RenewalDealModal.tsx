import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, X, Loader2, AlertCircle, Calendar, DollarSign, Building2 } from 'lucide-react';
import { toast } from '../../stores/toastStore';
import { createRenewalDeal } from './renewalApi';
import { useCustomers } from '../deals/hooks';

interface ContractInfo {
  id: string;
  contract_no: string;
  title: string;
  counterparty_name: string;
  contract_amount?: number | null;
  end_date?: string | null;
  auto_renewal?: boolean;
}

interface RenewalDealModalProps {
  contract: ContractInfo | null;
  isOpen?: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const RenewalDealModal: React.FC<RenewalDealModalProps> = ({
  contract,
  isOpen = true,
  onClose,
  onSuccess,
}) => {
  const navigate = useNavigate();
  const { data: customers = [], isLoading: isLoadingCustomers } = useCustomers();

  const [customerId, setCustomerId] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [expectedAmount, setExpectedAmount] = useState<string>('');
  const [expectedCloseDate, setExpectedCloseDate] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (contract) {
      setTitle(`契約更新: ${contract.title}`);
      setExpectedAmount(contract.contract_amount != null ? String(contract.contract_amount) : '0');
      setExpectedCloseDate(contract.end_date ?? '');
      setErrorMessage(null);

      // 相手先名に一致する既存顧客を自動探索
      const matched = customers.find(
        (c) => c.name.trim().toLowerCase() === contract.counterparty_name.trim().toLowerCase(),
      );
      if (matched) {
        setCustomerId(matched.id);
      } else {
        setCustomerId('');
      }
    }
  }, [contract, customers]);

  if (!isOpen || !contract) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerId) {
      setErrorMessage('顧客を選択してください。一致する顧客がない場合は既存顧客から選択してください。');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await createRenewalDeal({
        contract_id: contract.id,
        customer_id: customerId,
        title: title.trim(),
        expected_amount: Number(expectedAmount) || 0,
        expected_close_date: expectedCloseDate || null,
      });

      toast.success('契約更新の商談案件を作成しました');
      onSuccess?.();
      onClose();
      // 作成された商談の詳細画面へ遷移
      navigate(`/deals/${result.deal.id}`);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string } }; message?: string };
      const msg = axiosErr.response?.data?.message || axiosErr.message || '更新商談の作成に失敗しました';
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden border border-slate-200">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2 text-slate-800">
            <Briefcase className="w-5 h-5 text-indigo-600" />
            <h3 className="font-semibold text-base">契約更新提案の商談（案件）を作成</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 原契約の情報サマリー */}
        <div className="px-6 py-3 bg-indigo-50/60 border-b border-indigo-100 text-xs text-indigo-950 space-y-1">
          <div className="flex justify-between font-mono font-medium">
            <span>原契約番号: {contract.contract_no}</span>
            <span>満了日: {contract.end_date ?? 'なし'}</span>
          </div>
          <div className="font-semibold">{contract.title}</div>
          <div className="text-indigo-700">相手先: {contract.counterparty_name}</div>
        </div>

        {/* フォーム */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorMessage && (
            <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* 顧客選択 */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              顧客 <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <Building2 className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                required
                disabled={isLoadingCustomers}
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
              >
                <option value="">-- 顧客を選択してください --</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} : {c.name}
                  </option>
                ))}
              </select>
            </div>
            {!customerId && (
              <p className="text-[11px] text-amber-600 mt-1">
                ※ 契約の相手先名「{contract.counterparty_name}」に対応する顧客を選択してください。
              </p>
            )}
          </div>

          {/* 案件名 */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              商談・案件名 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          {/* 予想金額 & 受注予定日 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">予想金額 (円)</label>
              <div className="relative">
                <DollarSign className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="number"
                  min="0"
                  value={expectedAmount}
                  onChange={(e) => setExpectedAmount(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">受注予定日</label>
              <div className="relative">
                <Calendar className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="date"
                  value={expectedCloseDate}
                  onChange={(e) => setExpectedCloseDate(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            </div>
          </div>

          <div className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
            ※ 作成される案件は初期ステージ <code>lead</code> で登録され、原契約との紐付けが記録されます。
          </div>

          {/* アクションボタン */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !customerId}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  起票中...
                </>
              ) : (
                <>
                  <Briefcase className="w-4 h-4" />
                  更新案件を作成
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
