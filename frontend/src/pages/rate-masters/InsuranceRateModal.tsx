import React, { useState, useEffect } from 'react';
import { X, Save, Percent, Calendar, MapPin, Layers } from 'lucide-react';
import type {
  InsuranceRate,
  InsuranceRateCreateInput,
  InsuranceRateUpdateInput,
  InsuranceRateType,
} from './types';
import { INSURANCE_RATE_TYPE_LABELS, PREFECTURES } from './types';

interface InsuranceRateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: InsuranceRateCreateInput | InsuranceRateUpdateInput) => Promise<void>;
  rate?: InsuranceRate | null;
  loading?: boolean;
}

export const InsuranceRateModal: React.FC<InsuranceRateModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  rate,
  loading = false,
}) => {
  const [rateType, setRateType] = useState<InsuranceRateType>('health_insurance');
  const [prefecture, setPrefecture] = useState<string>('');
  const [rateEmployeePercent, setRateEmployeePercent] = useState<string>('4.985');
  const [rateEmployerPercent, setRateEmployerPercent] = useState<string>('4.985');
  const [effectiveFrom, setEffectiveFrom] = useState<string>('');
  const [effectiveTo, setEffectiveTo] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (rate) {
      setRateType(rate.rate_type);
      setPrefecture(rate.prefecture ?? '');
      setRateEmployeePercent((rate.rate_employee * 100).toFixed(4).replace(/\.?0+$/, ''));
      setRateEmployerPercent((rate.rate_employer * 100).toFixed(4).replace(/\.?0+$/, ''));
      setEffectiveFrom(rate.effective_from);
      setEffectiveTo(rate.effective_to ?? '');
      setDescription(rate.description ?? '');
    } else {
      setRateType('health_insurance');
      setPrefecture('');
      setRateEmployeePercent('4.985');
      setRateEmployerPercent('4.985');
      setEffectiveFrom(new Date().toISOString().split('T')[0]!);
      setEffectiveTo('');
      setDescription('');
    }
    setError(null);
  }, [rate, isOpen]);

  if (!isOpen) return null;

  const empRate = parseFloat(rateEmployeePercent) / 100 || 0;
  const emplyrRate = parseFloat(rateEmployerPercent) / 100 || 0;
  const totalRatePercent = (parseFloat(rateEmployeePercent) || 0) + (parseFloat(rateEmployerPercent) || 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveFrom) {
      setError('適用開始日を入力してください');
      return;
    }
    if (effectiveTo && effectiveTo < effectiveFrom) {
      setError('適用終了日は適用開始日以降の日付を指定してください');
      return;
    }
    if (isNaN(empRate) || empRate < 0 || empRate > 1) {
      setError('従業員負担率は 0% 〜 100% の範囲で入力してください');
      return;
    }
    if (isNaN(emplyrRate) || emplyrRate < 0 || emplyrRate > 1) {
      setError('事業主負担率は 0% 〜 100% の範囲で入力してください');
      return;
    }

    try {
      if (rate) {
        await onSubmit({
          prefecture: prefecture || null,
          rate_employee: empRate,
          rate_employer: emplyrRate,
          effective_from: effectiveFrom,
          effective_to: effectiveTo || null,
          description: description || null,
        });
      } else {
        await onSubmit({
          rate_type: rateType,
          prefecture: prefecture || null,
          rate_employee: empRate,
          rate_employer: emplyrRate,
          effective_from: effectiveFrom,
          effective_to: effectiveTo || null,
          description: description || null,
        });
      }
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || err?.message || '登録に失敗しました');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg rounded-2xl bg-surface-900 border border-surface-700 shadow-2xl p-6 text-surface-100">
        <div className="flex items-center justify-between border-b border-surface-800 pb-4 mb-5">
          <div className="flex items-center gap-2">
            <Percent className="w-5 h-5 text-brand-400" />
            <h2 className="text-lg font-semibold text-surface-50">
              {rate ? '社会保険料率の編集' : '社会保険料率の新規登録'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-surface-400 hover:text-surface-200 transition-colors p-1 rounded-lg hover:bg-surface-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!rate && (
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5" /> 料率種別 *
              </label>
              <select
                value={rateType}
                onChange={(e) => setRateType(e.target.value as InsuranceRateType)}
                className="w-full rounded-lg bg-surface-800 border border-surface-700 px-3 py-2 text-sm text-surface-100 focus:outline-none focus:border-brand-500"
              >
                {(Object.keys(INSURANCE_RATE_TYPE_LABELS) as InsuranceRateType[]).map((key) => (
                  <option key={key} value={key}>
                    {INSURANCE_RATE_TYPE_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-surface-400 mb-1 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" /> 都道府県 (該当する場合のみ)
            </label>
            <select
              value={prefecture}
              onChange={(e) => setPrefecture(e.target.value)}
              className="w-full rounded-lg bg-surface-800 border border-surface-700 px-3 py-2 text-sm text-surface-100 focus:outline-none focus:border-brand-500"
            >
              <option value="">全国一律 (都道府県指定なし)</option>
              {PREFECTURES.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-surface-500 mt-0.5">
              ※協会けんぽ健康保険料率等は都道府県ごとに設定できます。全国一律の厚生年金等は空欄にします。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1">
                従業員(本人)負担率 (%) *
              </label>
              <input
                type="number"
                step="0.001"
                min="0"
                max="100"
                value={rateEmployeePercent}
                onChange={(e) => setRateEmployeePercent(e.target.value)}
                placeholder="例: 4.985"
                required
                className="w-full rounded-lg bg-surface-800 border border-surface-700 px-3 py-2 text-sm text-surface-100 focus:outline-none focus:border-brand-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1">
                事業主(会社)負担率 (%) *
              </label>
              <input
                type="number"
                step="0.001"
                min="0"
                max="100"
                value={rateEmployerPercent}
                onChange={(e) => setRateEmployerPercent(e.target.value)}
                placeholder="例: 4.985"
                required
                className="w-full rounded-lg bg-surface-800 border border-surface-700 px-3 py-2 text-sm text-surface-100 focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-brand-500/10 border border-brand-500/20 text-xs text-brand-300 flex items-center justify-between">
            <span>合計負担率:</span>
            <span className="font-bold text-sm text-brand-200">
              {totalRatePercent.toFixed(3)}% (比率: {(totalRatePercent / 100).toFixed(5)})
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
                className="w-full rounded-lg bg-surface-800 border border-surface-700 px-3 py-2 text-sm text-surface-100 focus:outline-none focus:border-brand-500"
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
                className="w-full rounded-lg bg-surface-800 border border-surface-700 px-3 py-2 text-sm text-surface-100 focus:outline-none focus:border-brand-500"
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
              placeholder="例: 令和8年3月分(4月納付分)改定料率"
              className="w-full rounded-lg bg-surface-800 border border-surface-700 px-3 py-2 text-sm text-surface-100 focus:outline-none focus:border-brand-500"
            />
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
              className="px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
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
