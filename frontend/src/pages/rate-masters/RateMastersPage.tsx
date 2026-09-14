import React, { useState, useEffect, useCallback } from 'react';
import {
  Calculator,
  Plus,
  RefreshCw,
  Edit2,
  Percent,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Users,
  DollarSign,
  Sliders,
} from 'lucide-react';
import { rateMastersApi } from './api';
import type {
  InsuranceRate,
  InsuranceRateCreateInput,
  InsuranceRateUpdateInput,
  TaxBracket,
  TaxBracketCreateInput,
  TaxBracketUpdateInput,
} from './types';
import { INSURANCE_RATE_TYPE_LABELS, PREFECTURES } from './types';
import { InsuranceRateModal } from './InsuranceRateModal';
import { TaxBracketModal } from './TaxBracketModal';

export const RateMastersPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'insurance' | 'tax' | 'simulator'>('insurance');

  // --- 社会保険料率 state ---
  const [insuranceRates, setInsuranceRates] = useState<InsuranceRate[]>([]);
  const [insuranceLoading, setInsuranceLoading] = useState(false);
  const [rateTypeFilter, setRateTypeFilter] = useState<string>('');
  const [prefFilter, setPrefFilter] = useState<string>('');
  const [insuranceDateFilter, setInsuranceDateFilter] = useState<string>('');
  const [isInsuranceModalOpen, setIsInsuranceModalOpen] = useState(false);
  const [selectedInsuranceRate, setSelectedInsuranceRate] = useState<InsuranceRate | null>(null);
  const [insuranceModalLoading, setInsuranceModalLoading] = useState(false);

  // --- 源泉徴収税額表 state ---
  const [taxBrackets, setTaxBrackets] = useState<TaxBracket[]>([]);
  const [taxLoading, setTaxLoading] = useState(false);
  const [dependentsFilter, setDependentsFilter] = useState<string>('');
  const [taxDateFilter, setTaxDateFilter] = useState<string>('');
  const [isTaxModalOpen, setIsTaxModalOpen] = useState(false);
  const [selectedTaxBracket, setSelectedTaxBracket] = useState<TaxBracket | null>(null);
  const [taxModalLoading, setTaxModalLoading] = useState(false);

  // --- シミュレーター state ---
  const [simDate, setSimDate] = useState<string>(new Date().toISOString().split('T')[0]!);
  const [simPrefecture, setSimPrefecture] = useState<string>('tokyo');
  const [simIncome, setSimIncome] = useState<number>(300000);
  const [simDependents, setSimDependents] = useState<number>(0);
  const [simResults, setSimResults] = useState<{
    health?: InsuranceRate | null;
    care?: InsuranceRate | null;
    pension?: InsuranceRate | null;
    employment?: InsuranceRate | null;
    tax?: TaxBracket | null;
  } | null>(null);
  const [simLoading, setSimLoading] = useState(false);

  const [globalError, setGlobalError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // 社会保険料率データ取得
  const fetchInsuranceRates = useCallback(async () => {
    try {
      setInsuranceLoading(true);
      setGlobalError(null);
      const query: any = {};
      if (rateTypeFilter) query.rate_type = rateTypeFilter;
      if (prefFilter) query.prefecture = prefFilter;
      if (insuranceDateFilter) query.effective_date = insuranceDateFilter;
      const res = await rateMastersApi.listInsuranceRates(query);
      setInsuranceRates(res.items);
    } catch (err: any) {
      setGlobalError(err?.response?.data?.error?.message ?? err.message ?? '社会保険料率の取得に失敗しました');
    } finally {
      setInsuranceLoading(false);
    }
  }, [rateTypeFilter, prefFilter, insuranceDateFilter]);

  // 源泉徴収税額表データ取得
  const fetchTaxBrackets = useCallback(async () => {
    try {
      setTaxLoading(true);
      setGlobalError(null);
      const query: any = {};
      if (dependentsFilter !== '') query.dependents_count = parseInt(dependentsFilter, 10);
      if (taxDateFilter) query.effective_date = taxDateFilter;
      const res = await rateMastersApi.listTaxBrackets(query);
      setTaxBrackets(res.items);
    } catch (err: any) {
      setGlobalError(err?.response?.data?.error?.message ?? err.message ?? '源泉徴収税額表の取得に失敗しました');
    } finally {
      setTaxLoading(false);
    }
  }, [dependentsFilter, taxDateFilter]);

  useEffect(() => {
    if (activeTab === 'insurance') {
      fetchInsuranceRates();
    } else if (activeTab === 'tax') {
      fetchTaxBrackets();
    }
  }, [activeTab, fetchInsuranceRates, fetchTaxBrackets]);

  // シミュレーション実行
  const runSimulation = async () => {
    try {
      setSimLoading(true);
      setGlobalError(null);
      const [health, care, pension, employment, tax] = await Promise.all([
        rateMastersApi.getEffectiveInsuranceRate({
          date: simDate,
          rate_type: 'health_insurance',
          prefecture: simPrefecture,
        }),
        rateMastersApi.getEffectiveInsuranceRate({
          date: simDate,
          rate_type: 'care_insurance',
          prefecture: simPrefecture,
        }),
        rateMastersApi.getEffectiveInsuranceRate({
          date: simDate,
          rate_type: 'pension',
        }),
        rateMastersApi.getEffectiveInsuranceRate({
          date: simDate,
          rate_type: 'employment_insurance',
        }),
        rateMastersApi.getEffectiveTaxAmount({
          date: simDate,
          income: simIncome,
          dependents_count: simDependents,
        }),
      ]);
      setSimResults({ health, care, pension, employment, tax });
    } catch (err: any) {
      setGlobalError(err?.response?.data?.error?.message ?? err.message ?? '料率・税額の判定に失敗しました');
    } finally {
      setSimLoading(false);
    }
  };

  // 保険料率の保存
  const handleInsuranceModalSubmit = async (data: InsuranceRateCreateInput | InsuranceRateUpdateInput) => {
    try {
      setInsuranceModalLoading(true);
      if (selectedInsuranceRate) {
        await rateMastersApi.updateInsuranceRate(selectedInsuranceRate.id, data as InsuranceRateUpdateInput);
        setSuccessMsg('社会保険料率を更新しました');
      } else {
        await rateMastersApi.createInsuranceRate(data as InsuranceRateCreateInput);
        setSuccessMsg('社会保険料率を新規登録しました');
      }
      setIsInsuranceModalOpen(false);
      await fetchInsuranceRates();
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message ?? err.message ?? '保存に失敗しました';
      throw new Error(msg);
    } finally {
      setInsuranceModalLoading(false);
    }
  };

  // 源泉徴収税額表の保存
  const handleTaxModalSubmit = async (data: TaxBracketCreateInput | TaxBracketUpdateInput) => {
    try {
      setTaxModalLoading(true);
      if (selectedTaxBracket) {
        await rateMastersApi.updateTaxBracket(selectedTaxBracket.id, data as TaxBracketUpdateInput);
        setSuccessMsg('源泉徴収税額ブラケットを更新しました');
      } else {
        await rateMastersApi.createTaxBracket(data as TaxBracketCreateInput);
        setSuccessMsg('源泉徴収税額ブラケットを新規登録しました');
      }
      setIsTaxModalOpen(false);
      await fetchTaxBrackets();
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message ?? err.message ?? '保存に失敗しました';
      throw new Error(msg);
    } finally {
      setTaxModalLoading(false);
    }
  };

  const getPrefectureName = (code: string | null) => {
    if (!code) return '全国一律';
    const found = PREFECTURES.find((p) => p.code === code);
    return found ? found.name : code;
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* ページヘッダー */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-brand-400 text-sm font-semibold mb-1">
            <Calculator className="w-5 h-5" />
            <span>人事労務 / 給与基盤</span>
          </div>
          <h1 className="text-2xl font-bold text-surface-100">保険料率・税率マスタ管理</h1>
          <p className="text-surface-400 text-sm mt-1">
            健康保険・厚生年金・雇用保険の料率、および所得税源泉徴収税額表を有効期間付きで一元管理します。
          </p>
        </div>
      </div>

      {/* 法令遵守・サンプルデータ運用バナー (原則①) */}
      <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 flex items-start gap-3 shadow-sm">
        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <span className="font-bold text-amber-300">【重要】初期データ運用と法改正への対応について</span>
          <p className="text-amber-200/90 leading-relaxed">
            システムに登録される料率・税額表の初期データはすべてサンプル・参考値です。実際の給与計算や各種届出・納付を行う前に、必ず貴社が属する健康保険組合（協会けんぽ各支部等）、日本年金機構、および国税庁公表の最新法令値に更新してください。
            本マスタは有効期間付きで履歴管理されるため、法改正時には過去のレコードを上書きせず、新しい適用開始日を設定して追加登録してください。
          </p>
        </div>
      </div>

      {/* グローバル通知メッセージ */}
      {globalError && (
        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-center justify-between">
          <span>{globalError}</span>
          <button onClick={() => setGlobalError(null)} className="text-rose-400 hover:text-rose-200 text-xs">
            閉じる
          </button>
        </div>
      )}
      {successMsg && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* タブナビゲーション */}
      <div className="flex border-b border-surface-800 space-x-1">
        <button
          onClick={() => setActiveTab('insurance')}
          className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-2 ${
            activeTab === 'insurance'
              ? 'bg-surface-800 text-brand-400 border-b-2 border-brand-500'
              : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/40'
          }`}
        >
          <Percent className="w-4 h-4" />
          社会保険料率マスタ
        </button>
        <button
          onClick={() => setActiveTab('tax')}
          className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-2 ${
            activeTab === 'tax'
              ? 'bg-surface-800 text-emerald-400 border-b-2 border-emerald-500'
              : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/40'
          }`}
        >
          <DollarSign className="w-4 h-4" />
          源泉徴収税額表 (月額表)
        </button>
        <button
          onClick={() => setActiveTab('simulator')}
          className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors flex items-center gap-2 ${
            activeTab === 'simulator'
              ? 'bg-surface-800 text-indigo-400 border-b-2 border-indigo-500'
              : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/40'
          }`}
        >
          <Sliders className="w-4 h-4" />
          料率・税額判定シミュレーター
        </button>
      </div>

      {/* タブ1: 社会保険料率マスタ */}
      {activeTab === 'insurance' && (
        <div className="space-y-4">
          {/* ツールバー */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-surface-900/60 p-4 rounded-xl border border-surface-800">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <select
                  value={rateTypeFilter}
                  onChange={(e) => setRateTypeFilter(e.target.value)}
                  className="rounded-lg bg-surface-800 border border-surface-700 px-3 py-1.5 text-xs text-surface-100 focus:outline-none focus:border-brand-500"
                >
                  <option value="">すべての保険種別</option>
                  <option value="health_insurance">健康保険 (一般)</option>
                  <option value="care_insurance">介護保険</option>
                  <option value="pension">厚生年金保険</option>
                  <option value="employment_insurance">雇用保険</option>
                </select>
              </div>

              <div>
                <select
                  value={prefFilter}
                  onChange={(e) => setPrefFilter(e.target.value)}
                  className="rounded-lg bg-surface-800 border border-surface-700 px-3 py-1.5 text-xs text-surface-100 focus:outline-none focus:border-brand-500"
                >
                  <option value="">すべての地域</option>
                  <option value="全国一律">全国一律のみ</option>
                  {PREFECTURES.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1">
                <span className="text-xs text-surface-400">有効基準日:</span>
                <input
                  type="date"
                  value={insuranceDateFilter}
                  onChange={(e) => setInsuranceDateFilter(e.target.value)}
                  className="rounded-lg bg-surface-800 border border-surface-700 px-2.5 py-1 text-xs text-surface-100 focus:outline-none focus:border-brand-500"
                />
              </div>

              {(rateTypeFilter || prefFilter || insuranceDateFilter) && (
                <button
                  onClick={() => {
                    setRateTypeFilter('');
                    setPrefFilter('');
                    setInsuranceDateFilter('');
                  }}
                  className="text-xs text-brand-400 hover:text-brand-300 underline"
                >
                  リセット
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchInsuranceRates()}
                disabled={insuranceLoading}
                className="p-2 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-300 transition-colors"
                title="再読み込み"
              >
                <RefreshCw className={`w-4 h-4 ${insuranceLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => {
                  setSelectedInsuranceRate(null);
                  setIsInsuranceModalOpen(true);
                }}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-brand-600 hover:bg-brand-500 text-white flex items-center gap-1.5 transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" />
                新規料率登録
              </button>
            </div>
          </div>

          {/* 料率テーブル */}
          <div className="rounded-xl border border-surface-800 bg-surface-900/50 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-surface-300">
                <thead className="bg-surface-800/80 text-surface-400 uppercase text-[11px] border-b border-surface-800">
                  <tr>
                    <th className="px-4 py-3">保険種別</th>
                    <th className="px-4 py-3">適用地域</th>
                    <th className="px-4 py-3 text-right">従業員負担率</th>
                    <th className="px-4 py-3 text-right">事業主負担率</th>
                    <th className="px-4 py-3 text-right">合計料率</th>
                    <th className="px-4 py-3">有効期間</th>
                    <th className="px-4 py-3">備考</th>
                    <th className="px-4 py-3 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-800">
                  {insuranceLoading ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-surface-500">
                        データを読み込み中...
                      </td>
                    </tr>
                  ) : insuranceRates.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-surface-500">
                        該当する保険料率マスタがありません。「新規料率登録」から追加してください。
                      </td>
                    </tr>
                  ) : (
                    insuranceRates.map((rate) => {
                      const totalPct = (Number(rate.rate_employee) + Number(rate.rate_employer)) * 100;
                      return (
                        <tr key={rate.id} className="hover:bg-surface-800/40 transition-colors">
                          <td className="px-4 py-3 font-medium text-surface-200">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-brand-500/10 text-brand-300 border border-brand-500/20">
                              {INSURANCE_RATE_TYPE_LABELS[rate.rate_type] || rate.rate_type}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {getPrefectureName(rate.prefecture)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-surface-200">
                            {(Number(rate.rate_employee) * 100).toFixed(3)}%
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-surface-200">
                            {(Number(rate.rate_employer) * 100).toFixed(3)}%
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-bold text-brand-300">
                            {totalPct.toFixed(3)}%
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px]">
                            <span className="text-surface-200">{rate.effective_from}</span>
                            <span className="text-surface-500 mx-1">〜</span>
                            <span className={rate.effective_to ? 'text-surface-200' : 'text-emerald-400 font-semibold'}>
                              {rate.effective_to || '現在有効'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-surface-400 truncate max-w-xs" title={rate.description ?? ''}>
                            {rate.description || '-'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => {
                                setSelectedInsuranceRate(rate);
                                setIsInsuranceModalOpen(true);
                              }}
                              className="p-1.5 rounded-lg hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
                              title="編集"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* タブ2: 源泉徴収税額表 */}
      {activeTab === 'tax' && (
        <div className="space-y-4">
          {/* ツールバー */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-surface-900/60 p-4 rounded-xl border border-surface-800">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <select
                  value={dependentsFilter}
                  onChange={(e) => setDependentsFilter(e.target.value)}
                  className="rounded-lg bg-surface-800 border border-surface-700 px-3 py-1.5 text-xs text-surface-100 focus:outline-none focus:border-emerald-500"
                >
                  <option value="">すべての扶養人数</option>
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((num) => (
                    <option key={num} value={num}>
                      扶養親族等: {num}人
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1">
                <span className="text-xs text-surface-400">有効基準日:</span>
                <input
                  type="date"
                  value={taxDateFilter}
                  onChange={(e) => setTaxDateFilter(e.target.value)}
                  className="rounded-lg bg-surface-800 border border-surface-700 px-2.5 py-1 text-xs text-surface-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              {(dependentsFilter !== '' || taxDateFilter) && (
                <button
                  onClick={() => {
                    setDependentsFilter('');
                    setTaxDateFilter('');
                  }}
                  className="text-xs text-emerald-400 hover:text-emerald-300 underline"
                >
                  リセット
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchTaxBrackets()}
                disabled={taxLoading}
                className="p-2 rounded-lg bg-surface-800 hover:bg-surface-700 text-surface-300 transition-colors"
                title="再読み込み"
              >
                <RefreshCw className={`w-4 h-4 ${taxLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => {
                  setSelectedTaxBracket(null);
                  setIsTaxModalOpen(true);
                }}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" />
                新規税額登録
              </button>
            </div>
          </div>

          {/* 税額表テーブル */}
          <div className="rounded-xl border border-surface-800 bg-surface-900/50 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-surface-300">
                <thead className="bg-surface-800/80 text-surface-400 uppercase text-[11px] border-b border-surface-800">
                  <tr>
                    <th className="px-4 py-3">扶養親族等の数</th>
                    <th className="px-4 py-3">社会保険料等控除後の給与等の月額</th>
                    <th className="px-4 py-3 text-right">税額 (甲欄)</th>
                    <th className="px-4 py-3">有効期間</th>
                    <th className="px-4 py-3">備考</th>
                    <th className="px-4 py-3 text-center">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-800">
                  {taxLoading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-surface-500">
                        データを読み込み中...
                      </td>
                    </tr>
                  ) : taxBrackets.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-surface-500">
                        該当する源泉徴収税額ブラケットがありません。「新規税額登録」から追加してください。
                      </td>
                    </tr>
                  ) : (
                    taxBrackets.map((tb) => (
                      <tr key={tb.id} className="hover:bg-surface-800/40 transition-colors">
                        <td className="px-4 py-3 font-medium text-surface-200">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                            {tb.dependents_count} 人
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-surface-200">
                          {Number(tb.income_min).toLocaleString()} 円 以上
                          {tb.income_max !== null ? (
                            <span> 〜 {Number(tb.income_max).toLocaleString()} 円 未満</span>
                          ) : (
                            <span className="text-surface-400"> 〜 上限なし</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-emerald-300 text-sm">
                          {Number(tb.tax_amount).toLocaleString()} 円
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px]">
                          <span className="text-surface-200">{tb.effective_from}</span>
                          <span className="text-surface-500 mx-1">〜</span>
                          <span className={tb.effective_to ? 'text-surface-200' : 'text-emerald-400 font-semibold'}>
                            {tb.effective_to || '現在有効'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-surface-400 truncate max-w-xs" title={tb.description ?? ''}>
                          {tb.description || '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => {
                              setSelectedTaxBracket(tb);
                              setIsTaxModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
                            title="編集"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* タブ3: 料率・税額判定シミュレーター */}
      {activeTab === 'simulator' && (
        <div className="space-y-6">
          <div className="bg-surface-900/60 p-6 rounded-2xl border border-surface-800 space-y-4 shadow-sm">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
                <Sliders className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-surface-100">
                  指定日基準 有効料率・税額判定シミュレーター
                </h2>
                <p className="text-xs text-surface-400">
                  指定された基準日、都道府県、給与額、扶養人数をもとに、マスタから現在適用される料率・税額を即時判定します
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 pt-2">
              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" /> 基準日 (給与支給日等)
                </label>
                <input
                  type="date"
                  value={simDate}
                  onChange={(e) => setSimDate(e.target.value)}
                  className="w-full rounded-lg bg-surface-800 border border-surface-700 px-3 py-2 text-sm text-surface-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1">
                  事業所所在地 (健康保険・介護保険)
                </label>
                <select
                  value={simPrefecture}
                  onChange={(e) => setSimPrefecture(e.target.value)}
                  className="w-full rounded-lg bg-surface-800 border border-surface-700 px-3 py-2 text-sm text-surface-100 focus:outline-none focus:border-indigo-500"
                >
                  {PREFECTURES.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1 flex items-center gap-1">
                  <DollarSign className="w-3.5 h-3.5" /> 社保控除後給与額 (円)
                </label>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  value={simIncome}
                  onChange={(e) => setSimIncome(Number(e.target.value) || 0)}
                  className="w-full rounded-lg bg-surface-800 border border-surface-700 px-3 py-2 text-sm text-surface-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-surface-400 mb-1 flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" /> 扶養親族等の数 (人)
                </label>
                <input
                  type="number"
                  min="0"
                  max="15"
                  value={simDependents}
                  onChange={(e) => setSimDependents(parseInt(e.target.value, 10) || 0)}
                  className="w-full rounded-lg bg-surface-800 border border-surface-700 px-3 py-2 text-sm text-surface-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={runSimulation}
                disabled={simLoading}
                className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm flex items-center gap-2 transition-colors disabled:opacity-50 shadow-sm"
              >
                <Calculator className="w-4 h-4" />
                {simLoading ? '判定中...' : '適用料率・税額を判定する'}
              </button>
            </div>
          </div>

          {/* シミュレーション結果表示 */}
          {simResults && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-surface-300 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                基準日: {simDate} における適用判定結果
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 健康保険 */}
                <div className="p-4 rounded-xl bg-surface-900/70 border border-surface-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-surface-400">健康保険 (一般)</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-800 text-surface-300">
                      {simPrefecture}
                    </span>
                  </div>
                  {simResults.health ? (
                    <div>
                      <div className="text-xl font-bold text-brand-300 font-mono">
                        {(Number(simResults.health.rate_employee) * 100).toFixed(3)}%
                      </div>
                      <div className="text-xs text-surface-400 mt-1">
                        本人: {(Number(simResults.health.rate_employee) * 100).toFixed(3)}% / 会社: {(Number(simResults.health.rate_employer) * 100).toFixed(3)}%
                      </div>
                      <div className="text-[11px] text-surface-500 mt-1">
                        期間: {simResults.health.effective_from} 〜 {simResults.health.effective_to || '現在'}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-rose-400">該当期間の料率マスタなし</div>
                  )}
                </div>

                {/* 介護保険 */}
                <div className="p-4 rounded-xl bg-surface-900/70 border border-surface-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-surface-400">介護保険 (第2号)</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-800 text-surface-300">
                      全国/都道府県
                    </span>
                  </div>
                  {simResults.care ? (
                    <div>
                      <div className="text-xl font-bold text-amber-300 font-mono">
                        {(Number(simResults.care.rate_employee) * 100).toFixed(3)}%
                      </div>
                      <div className="text-xs text-surface-400 mt-1">
                        本人: {(Number(simResults.care.rate_employee) * 100).toFixed(3)}% / 会社: {(Number(simResults.care.rate_employer) * 100).toFixed(3)}%
                      </div>
                      <div className="text-[11px] text-surface-500 mt-1">
                        期間: {simResults.care.effective_from} 〜 {simResults.care.effective_to || '現在'}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-surface-500">適用なし / マスタ未登録</div>
                  )}
                </div>

                {/* 厚生年金 */}
                <div className="p-4 rounded-xl bg-surface-900/70 border border-surface-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-surface-400">厚生年金保険</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-800 text-surface-300">
                      全国一律
                    </span>
                  </div>
                  {simResults.pension ? (
                    <div>
                      <div className="text-xl font-bold text-purple-300 font-mono">
                        {(Number(simResults.pension.rate_employee) * 100).toFixed(3)}%
                      </div>
                      <div className="text-xs text-surface-400 mt-1">
                        本人: {(Number(simResults.pension.rate_employee) * 100).toFixed(3)}% / 会社: {(Number(simResults.pension.rate_employer) * 100).toFixed(3)}%
                      </div>
                      <div className="text-[11px] text-surface-500 mt-1">
                        期間: {simResults.pension.effective_from} 〜 {simResults.pension.effective_to || '現在'}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-rose-400">該当期間の料率マスタなし</div>
                  )}
                </div>

                {/* 雇用保険 */}
                <div className="p-4 rounded-xl bg-surface-900/70 border border-surface-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-surface-400">雇用保険 (一般事業)</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-800 text-surface-300">
                      全国一律
                    </span>
                  </div>
                  {simResults.employment ? (
                    <div>
                      <div className="text-xl font-bold text-cyan-300 font-mono">
                        {(Number(simResults.employment.rate_employee) * 100).toFixed(3)}%
                      </div>
                      <div className="text-xs text-surface-400 mt-1">
                        本人: {(Number(simResults.employment.rate_employee) * 100).toFixed(3)}% / 会社: {(Number(simResults.employment.rate_employer) * 100).toFixed(3)}%
                      </div>
                      <div className="text-[11px] text-surface-500 mt-1">
                        期間: {simResults.employment.effective_from} 〜 {simResults.employment.effective_to || '現在'}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-rose-400">該当期間の料率マスタなし</div>
                  )}
                </div>
              </div>

              {/* 源泉所得税 判定結果カード */}
              <div className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-surface-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-emerald-400" />
                    <h4 className="font-semibold text-base text-emerald-300">源泉所得税額 判定結果 (月額表 甲欄)</h4>
                  </div>
                  <p className="text-xs text-surface-300">
                    社会保険料等控除後の給与額: <span className="font-mono font-semibold">{simIncome.toLocaleString()}円</span> / 扶養親族等の数: <span className="font-mono font-semibold">{simDependents}人</span>
                  </p>
                  {simResults.tax && (
                    <p className="text-[11px] text-surface-400">
                      適用ブラケット: {Number(simResults.tax.income_min).toLocaleString()}円以上 〜 {simResults.tax.income_max ? `${Number(simResults.tax.income_max).toLocaleString()}円未満` : '上限なし'} (有効期間: {simResults.tax.effective_from} 〜 {simResults.tax.effective_to || '現在'})
                    </p>
                  )}
                </div>

                <div className="text-right">
                  {simResults.tax ? (
                    <div>
                      <div className="text-xs text-emerald-400 font-medium">源泉徴収税額</div>
                      <div className="text-3xl font-extrabold text-emerald-200 font-mono">
                        {Number(simResults.tax.tax_amount).toLocaleString()} <span className="text-sm font-normal">円</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-rose-400 font-medium">
                      該当する所得税額表ブラケットが未登録です
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* モーダル */}
      <InsuranceRateModal
        isOpen={isInsuranceModalOpen}
        onClose={() => setIsInsuranceModalOpen(false)}
        onSubmit={handleInsuranceModalSubmit}
        rate={selectedInsuranceRate}
        loading={insuranceModalLoading}
      />

      <TaxBracketModal
        isOpen={isTaxModalOpen}
        onClose={() => setIsTaxModalOpen(false)}
        onSubmit={handleTaxModalSubmit}
        bracket={selectedTaxBracket}
        loading={taxModalLoading}
      />
    </div>
  );
};
