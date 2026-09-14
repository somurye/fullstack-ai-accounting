import React, { useState, useEffect } from 'react';
import { X, Save, Calendar, Users, DollarSign, HelpCircle } from 'lucide-react';
import type {
  TaxBracket,
  TaxBracketCreateInput,
  TaxBracketUpdateInput,
} from './types';

interface TaxBracketModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: TaxBracketCreateInput | TaxBracketUpdateInput) => Promise<void>;
  bracket?: TaxBracket | null;
  loading?: boolean;
}

export const TaxBracketModal: React.FC<TaxBracketModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  bracket,
  loading = false,
}) => {
  const [dependentsCount, setDependentsCount] = useState<number>(0);
  const [incomeMin, setIncomeMin] = useState<string>('88000');
  const [incomeMax, setIncomeMax] = useState<string>('89000');
  const [hasNoMax, setHasNoMax] = useState<boolean>(false);
  const [taxAmount, setTaxAmount] = useState<string>('130');
  const [effectiveFrom, setEffectiveFrom] = useState<string>('');
  const [effectiveTo, setEffectiveTo] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (bracket) {
      setDependentsCount(bracket.dependents_count);
      setIncomeMin(String(bracket.income_min));
      if (bracket.income_max !== null && bracket.income_max !== undefined) {
        setIncomeMax(String(bracket.income_max));
        setHasNoMax(false);
      } else {
        setIncomeMax('');
        setHasNoMax(true);
      }
      setTaxAmount(String(bracket.tax_amount));
      setEffectiveFrom(bracket.effective_from);
      setEffectiveTo(bracket.effective_to ?? '');
      setDescription(bracket.description ?? '');
    } else {
      setDependentsCount(0);
      setIncomeMin('88000');
      setIncomeMax('89000');
      setHasNoMax(false);
      setTaxAmount('130');
      setEffectiveFrom(new Date().toISOString().split('T')[0]!);
      setEffectiveTo('');
      setDescription('');
    }
    setError(null);
  }, [bracket, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const minVal = parseFloat(incomeMin);
    const maxVal = hasNoMax || !incomeMax ? null : parseFloat(incomeMax);
    const taxVal = parseFloat(taxAmount);

    if (isNaN(minVal) || minVal < 0) {
      setError('給与所得の下限（以上）を正しい正の数値で入力してください');
      return;
    }
    if (maxVal !== null) {
      if (isNaN(maxVal) || maxVal <= minVal) {
        setError('給与所得の上限（未満）は下限より大きい数値を入力してください');
        return;
      }
    }
    if (isNaN(taxVal) || taxVal < 0) {
      setError('源泉徴収税額を0以上の数値で入力してください');
      return;
    }
    if (!effectiveFrom) {
      setError('適用開始日を入力してください');
      return;
    }
    if (effectiveTo && effectiveTo < effectiveFrom) {
      setError('適用終了日は適用開始日以降の日付を指定してください');
      return;
    }

    try {
      const payload = {
        dependents_count: dependentsCount,
        income_min: minVal,
        income_max: maxVal,
        tax_amount: taxVal,
        effective_from: effectiveFrom,
        effective_to: effectiveTo || null,
        description: description || null,
      };
      await onSubmit(payload);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '保存に失敗しました';
      setError(msg);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface-900 border border-surface-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-800">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-surface-100">
                {bracket ? '源泉徴収税額表ブラケット編集' : '源泉徴収税額表ブラケット登録'}
              </h2>
              <p className="text-xs text-surface-400">
                給与所得区分ごとの月額源泉徴収税額を定義します
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1 flex items-center gap-1">
              <Users className="w-3.5 h-3.5" /> 扶養親族等の数 (人) *
            </label>
            <input
              type="number"
              min="0"
              max="20"
              value={dependentsCount}
              onChange={(e) => setDependentsCount(parseInt(e.target.value, 10) || 0)}
              required
              className="w-full rounded-lg bg-surface-800 border border-surface-700 px-3 py-2 text-sm text-surface-100 focus:outline-none focus:border-emerald-500"
            />
            <span className="text-[11px] text-surface-500">
              ※税額表の「扶養親族等の数（0人、1人、2人...）」欄に該当します
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1">
                その月の社会保険料等控除後の給与等の金額: 以上 (円) *
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={incomeMin}
                onChange={(e) => setIncomeMin(e.target.value)}
                placeholder="例: 88000"
                required
                className="w-full rounded-lg bg-surface-800 border border-surface-700 px-3 py-2 text-sm text-surface-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-surface-400">
                  未満 (円)
                </label>
                <label className="flex items-center gap-1 text-[11px] text-surface-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasNoMax}
                    onChange={(e) => {
                      setHasNoMax(e.target.checked);
                      if (e.target.checked) setIncomeMax('');
                    }}
                    className="rounded bg-surface-700 border-surface-600 text-emerald-500 focus:ring-0"
                  />
                  上限なし
                </label>
              </div>
              <input
                type="number"
                min="0"
                step="1"
                disabled={hasNoMax}
                value={incomeMax}
                onChange={(e) => setIncomeMax(e.target.value)}
                placeholder={hasNoMax ? '上限なし' : '例: 89000'}
                required={!hasNoMax}
                className="w-full rounded-lg bg-surface-800 border border-surface-700 px-3 py-2 text-sm text-surface-100 focus:outline-none focus:border-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1 flex items-center gap-1">
              <DollarSign className="w-3.5 h-3.5" /> 税額 (甲欄・円) *
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={taxAmount}
              onChange={(e) => setTaxAmount(e.target.value)}
              placeholder="例: 130"
              required
              className="w-full rounded-lg bg-surface-800 border border-surface-700 px-3 py-2 text-sm text-surface-100 focus:outline-none focus:border-emerald-500"
            />
            <span className="text-[11px] text-surface-500">
              ※指定の所得帯・扶養人数に対して徴収される源泉徴収税額です（非課税の場合は 0）
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" /> 適用開始日 *
              </label>
              <input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                required
                className="w-full rounded-lg bg-surface-800 border border-surface-700 px-3 py-2 text-sm text-surface-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" /> 適用終了日
              </label>
              <input
                type="date"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
                className="w-full rounded-lg bg-surface-800 border border-surface-700 px-3 py-2 text-sm text-surface-100 focus:outline-none focus:border-emerald-500"
              />
              <span className="text-[10px] text-surface-500">※未入力の場合は現在無期限</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1">
              備考 / 改定理由
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例: 令和8年分 源泉徴収税額表（月額表）"
              className="w-full rounded-lg bg-surface-800 border border-surface-700 px-3 py-2 text-sm text-surface-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="p-2.5 rounded-lg bg-surface-800/80 border border-surface-700 text-[11px] text-surface-400 flex items-start gap-2">
            <HelpCircle className="w-4 h-4 text-surface-300 mt-0.5 shrink-0" />
            <div>
              同一テナント・同一扶養人数において、期間（daterange）と所得金額（numrange）の重複するブラケットはDBの排他制約（EXCLUDE制約）により自動的に拒否されます。
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-surface-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-300 transition-colors"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {loading ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
