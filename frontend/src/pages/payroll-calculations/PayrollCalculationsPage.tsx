import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Calculator,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  FileCheck,
  Info,
  Play,
  Plus,
  Send,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { payrollApi } from './api';
import type {
  AppliedRateEntry,
  PayrollCalculation,
  PayrollPeriod,
} from './types';

export function PayrollCalculationsPage() {
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [calculations, setCalculations] = useState<PayrollCalculation[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // モーダル状態
  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [periodForm, setPeriodForm] = useState({
    name: '',
    period_start: '',
    period_end: '',
    payment_date: '',
  });

  // 計算根拠モーダル状態
  const [detailCalc, setDetailCalc] = useState<PayrollCalculation | null>(null);

  // 給与プロファイル登録モーダル状態
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileForm, setProfileForm] = useState({
    employee_id: '',
    salary_type: 'monthly' as 'monthly' | 'hourly',
    base_salary: 300000,
    hourly_wage: 0,
    standard_monthly_remuneration: 300000,
    dependents_count: 0,
    has_health_insurance: true,
    has_care_insurance: false,
    has_pension: true,
    has_employment_insurance: true,
    resident_tax_amount: 15000,
    prefecture: 'tokyo',
    effective_from: '2026-04-01',
  });

  // 初期ロード: 期間一覧
  const fetchPeriods = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await payrollApi.listPeriods();
      setPeriods(data);
      if (data.length > 0 && !selectedPeriodId) {
        setSelectedPeriodId(data[0].id);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || err.message || '期間一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPeriods();
  }, []);

  // 選択された期間の計算結果一覧取得
  const fetchCalculations = async (periodId: string) => {
    if (!periodId) return;
    try {
      setLoading(true);
      setError(null);
      const data = await payrollApi.listCalculations(periodId);
      setCalculations(data);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || err.message || '給与計算結果の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedPeriodId) {
      fetchCalculations(selectedPeriodId);
    } else {
      setCalculations([]);
    }
  }, [selectedPeriodId]);

  // 給与期間新規作成
  const handleCreatePeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setActionLoading(true);
      setError(null);
      const created = await payrollApi.createPeriod(periodForm);
      setSuccessMsg(`給与計算期間「${created.name}」を作成しました`);
      setShowPeriodModal(false);
      setPeriodForm({ name: '', period_start: '', period_end: '', payment_date: '' });
      await fetchPeriods();
      setSelectedPeriodId(created.id);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || err.message || '期間作成に失敗しました');
    } finally {
      setActionLoading(false);
    }
  };

  // 給与プロファイル作成
  const handleCreateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setActionLoading(true);
      setError(null);
      await payrollApi.createProfile(profileForm);
      setSuccessMsg('従業員の給与プロファイルを登録しました');
      setShowProfileModal(false);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || err.message || '給与プロファイルの登録に失敗しました');
    } finally {
      setActionLoading(false);
    }
  };

  // 給与計算実行 (提案生成)
  const handleCalculate = async () => {
    if (!selectedPeriodId) return;
    try {
      setActionLoading(true);
      setError(null);
      setSuccessMsg(null);
      const res = await payrollApi.calculateForPeriod(selectedPeriodId);
      setCalculations(res);
      setSuccessMsg(`給与計算エンジンによる提案 (${res.length}件) を生成しました。内容を確認し承認申請してください。`);
      await fetchPeriods();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || err.message || '給与計算の実行に失敗しました');
    } finally {
      setActionLoading(false);
    }
  };

  // 単一承認申請
  const handleSubmitApproval = async (calcId: string) => {
    try {
      setActionLoading(true);
      setError(null);
      const updated = await payrollApi.submitApproval(calcId);
      setSuccessMsg(
        updated.status === 'active'
          ? '給与計算が自動承認され確定（active）しました'
          : '承認申請を提出しました（pending_approval）',
      );
      if (selectedPeriodId) {
        await fetchCalculations(selectedPeriodId);
      }
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || err.message || '承認申請に失敗しました');
    } finally {
      setActionLoading(false);
    }
  };

  // 期間一括承認申請
  const handleSubmitPeriodApproval = async () => {
    if (!selectedPeriodId) return;
    try {
      setActionLoading(true);
      setError(null);
      const res = await payrollApi.submitPeriodApproval(selectedPeriodId);
      setSuccessMsg(`${res.submitted_count}件の給与計算を承認申請しました`);
      await fetchCalculations(selectedPeriodId);
      await fetchPeriods();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || err.message || '一括承認申請に失敗しました');
    } finally {
      setActionLoading(false);
    }
  };

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-400">
            <Clock className="h-3.5 w-3.5" /> 提案 (下書き)
          </span>
        );
      case 'pending_approval':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-blue-500/10 px-2.5 py-1 text-xs font-semibold text-blue-400">
            <Send className="h-3.5 w-3.5" /> 承認待ち
          </span>
        );
      case 'active':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> 確定済み (不変)
          </span>
        );
      case 'rejected':
        return (
          <span className="inline-flex items-center gap-1 rounded bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-400">
            <AlertCircle className="h-3.5 w-3.5" /> 却下
          </span>
        );
      default:
        return <span className="rounded bg-surface-700 px-2.5 py-1 text-xs">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* 画面ヘッダー */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-surface-50 flex items-center gap-2.5">
            <Calculator className="h-7 w-7 text-brand-500" />
            給与計算エンジン (Payroll Engine)
          </h1>
          <p className="mt-1 text-sm text-surface-400">
            勤怠実績 × 従業員給与情報 × 保険料率・税額マスタから計算提案を生成し、人間の確認を経て承認・確定します（設計原則②）
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowProfileModal(true)}
            className="flex items-center gap-1.5 rounded-lg border border-surface-700 bg-surface-800 px-3.5 py-2 text-sm font-medium text-surface-200 transition hover:bg-surface-700"
          >
            <Users className="h-4 w-4" /> 給与プロファイル設定
          </button>
          <button
            type="button"
            onClick={() => setShowPeriodModal(true)}
            className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-brand-500"
          >
            <Plus className="h-4 w-4" /> 給与計算期間の追加
          </button>
        </div>
      </div>

      {/* 確定境界 (設計原則②) ガイダンスバナー */}
      <div className="rounded-xl border border-brand-500/30 bg-brand-950/20 p-4 text-sm text-surface-300">
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 shrink-0 text-brand-400 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold text-surface-100">
              設計原則②（AI/ルール提案 → 人間確認 → 既存承認エンジン → 確定WORM）
            </span>
            <p className="text-surface-400 text-xs leading-relaxed">
              給与計算の実行結果は直ちに確定せず、ルールエンジンによる「提案 (draft)」として起票されます。
              内容確認後、承認リクエストが発行され、承認完了によって初めて「確定 (active)」となります。確定後の給与データはDBトリガーにより金額・計算根拠の改変が遮断されます。
            </p>
          </div>
        </div>
      </div>

      {/* メッセージ表示 */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-800 bg-rose-950/30 p-4 text-sm text-rose-300">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-800 bg-emerald-950/30 p-4 text-sm text-emerald-300">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* 期間選択バー & アクション */}
      <div className="flex flex-col gap-4 rounded-xl border border-surface-800 bg-surface-900 p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-surface-400" />
            <span className="text-sm font-medium text-surface-300">計算対象期間:</span>
          </div>

          <select
            value={selectedPeriodId}
            onChange={(e) => setSelectedPeriodId(e.target.value)}
            className="rounded-lg border border-surface-700 bg-surface-800 px-3.5 py-2 text-sm text-surface-100 focus:border-brand-500 focus:outline-none"
          >
            {periods.length === 0 && <option value="">期間が存在しません</option>}
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.period_start} 〜 {p.period_end} / 支給日: {p.payment_date}) [{p.status}]
              </option>
            ))}
          </select>

          {selectedPeriod && (
            <span className="text-xs text-surface-400">
              ステータス: <span className="font-semibold text-surface-200">{selectedPeriod.status}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCalculate}
            disabled={!selectedPeriodId || actionLoading}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
          >
            <Play className="h-4 w-4" /> 給与計算を実行 (提案生成)
          </button>
          <button
            type="button"
            onClick={handleSubmitPeriodApproval}
            disabled={
              !selectedPeriodId ||
              actionLoading ||
              calculations.length === 0 ||
              !calculations.some((c) => c.status === 'draft' || c.status === 'rejected')
            }
            className="flex items-center gap-2 rounded-lg border border-brand-500 bg-brand-600/20 px-4 py-2 text-sm font-medium text-brand-300 transition hover:bg-brand-600/30 disabled:opacity-50"
          >
            <Send className="h-4 w-4" /> 全ドラフトの一括承認申請
          </button>
        </div>
      </div>

      {/* 計算結果サマリーテーブル */}
      <div className="overflow-hidden rounded-xl border border-surface-800 bg-surface-900 shadow-sm">
        <div className="border-b border-surface-800 px-6 py-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-surface-100 flex items-center gap-2">
            <FileCheck className="h-5 w-5 text-brand-400" />
            給与計算一覧 ({calculations.length}名)
          </h2>
          <span className="text-xs text-surface-400">
            ※各レコードの「計算根拠」から適用されたマスタIDと料率スナップショットを確認できます
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-surface-300">
            <thead className="border-b border-surface-800 bg-surface-950/50 text-xs font-semibold uppercase text-surface-400">
              <tr>
                <th className="px-6 py-3.5">社員番号 / 氏名</th>
                <th className="px-4 py-3.5">給与形態</th>
                <th className="px-4 py-3.5 text-right">労働時間 (所定/残業/深夜/休日)</th>
                <th className="px-4 py-3.5 text-right">総支給額</th>
                <th className="px-4 py-3.5 text-right">控除合計</th>
                <th className="px-6 py-3.5 text-right">差引支給額 (手取り)</th>
                <th className="px-4 py-3.5 text-center">状態</th>
                <th className="px-6 py-3.5 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-800">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-surface-500">
                    読み込み中...
                  </td>
                </tr>
              ) : calculations.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-surface-500">
                    この期間の給与計算データはありません。「給与計算を実行」をクリックして提案を生成してください。
                  </td>
                </tr>
              ) : (
                calculations.map((calc) => (
                  <tr key={calc.id} className="hover:bg-surface-800/40 transition">
                    <td className="px-6 py-4 font-medium text-surface-100">
                      <div>{calc.employee_name || '名称未設定'}</div>
                      <div className="text-xs text-surface-500">{calc.employee_no || '-'}</div>
                    </td>
                    <td className="px-4 py-4 text-surface-400">
                      {calc.salary_type === 'monthly' ? '月給制' : '時給制'}
                    </td>
                    <td className="px-4 py-4 text-right font-mono text-xs text-surface-300">
                      {calc.regular_hours}h / {calc.overtime_hours}h / {calc.late_night_hours}h / {calc.holiday_hours}h
                    </td>
                    <td className="px-4 py-4 text-right font-mono font-semibold text-surface-100">
                      ¥{Number(calc.total_gross_pay).toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-right font-mono text-rose-400">
                      ¥{Number(calc.total_deductions).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right font-mono font-bold text-emerald-400 text-base">
                      ¥{Number(calc.net_pay).toLocaleString()}
                    </td>
                    <td className="px-4 py-4 text-center">{getStatusBadge(calc.status)}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setDetailCalc(calc)}
                          className="inline-flex items-center gap-1 rounded border border-surface-700 bg-surface-800 px-2.5 py-1.5 text-xs text-surface-200 hover:bg-surface-700"
                        >
                          <Eye className="h-3.5 w-3.5" /> 根拠詳細
                        </button>
                        {(calc.status === 'draft' || calc.status === 'rejected') && (
                          <button
                            type="button"
                            onClick={() => handleSubmitApproval(calc.id)}
                            disabled={actionLoading}
                            className="inline-flex items-center gap-1 rounded bg-brand-600 px-2.5 py-1.5 text-xs text-white hover:bg-brand-500"
                          >
                            <Send className="h-3.5 w-3.5" /> 承認申請
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 計算根拠・内訳詳細モーダル */}
      {detailCalc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-surface-800 bg-surface-900 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-surface-800 px-6 py-4">
              <h3 className="text-lg font-semibold text-surface-100 flex items-center gap-2">
                <Info className="h-5 w-5 text-brand-400" />
                給与計算根拠・スナップショット詳細 ({detailCalc.employee_name})
              </h3>
              <button
                type="button"
                onClick={() => setDetailCalc(null)}
                className="rounded p-1 text-surface-400 hover:bg-surface-800 hover:text-surface-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
              {/* 支給内訳 */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-400 mb-2">
                  支給項目内訳
                </h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-surface-800/60 p-3">
                    <span className="text-xs text-surface-400">基本給 / 基礎給与</span>
                    <div className="font-mono font-semibold text-surface-100 mt-1">
                      ¥{Number(detailCalc.regular_pay).toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg bg-surface-800/60 p-3">
                    <span className="text-xs text-surface-400">時間外手当 (残業 × 1.25)</span>
                    <div className="font-mono font-semibold text-surface-100 mt-1">
                      ¥{Number(detailCalc.overtime_pay).toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg bg-surface-800/60 p-3">
                    <span className="text-xs text-surface-400">深夜手当 (深夜時間)</span>
                    <div className="font-mono font-semibold text-surface-100 mt-1">
                      ¥{Number(detailCalc.late_night_pay).toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg bg-surface-800/60 p-3">
                    <span className="text-xs text-surface-400">休日手当 (休日労働 × 1.35)</span>
                    <div className="font-mono font-semibold text-surface-100 mt-1">
                      ¥{Number(detailCalc.holiday_pay).toLocaleString()}
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-right text-sm">
                  総支給額: <span className="font-mono font-bold text-surface-50 text-base">¥{Number(detailCalc.total_gross_pay).toLocaleString()}</span>
                </div>
              </div>

              {/* 控除内訳 */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-400 mb-2">
                  控除項目内訳 (社会保険・所得税・住民税)
                </h4>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-lg bg-surface-800/60 p-3">
                    <span className="text-xs text-surface-400">健康保険料</span>
                    <div className="font-mono font-semibold text-rose-400 mt-1">
                      ¥{Number(detailCalc.health_insurance_amount).toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg bg-surface-800/60 p-3">
                    <span className="text-xs text-surface-400">介護保険料</span>
                    <div className="font-mono font-semibold text-rose-400 mt-1">
                      ¥{Number(detailCalc.care_insurance_amount).toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg bg-surface-800/60 p-3">
                    <span className="text-xs text-surface-400">厚生年金保険料</span>
                    <div className="font-mono font-semibold text-rose-400 mt-1">
                      ¥{Number(detailCalc.pension_amount).toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg bg-surface-800/60 p-3">
                    <span className="text-xs text-surface-400">雇用保険料</span>
                    <div className="font-mono font-semibold text-rose-400 mt-1">
                      ¥{Number(detailCalc.employment_insurance_amount).toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg bg-surface-800/60 p-3">
                    <span className="text-xs text-surface-400">所得税 (源泉徴収)</span>
                    <div className="font-mono font-semibold text-rose-400 mt-1">
                      ¥{Number(detailCalc.income_tax_amount).toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-lg bg-surface-800/60 p-3">
                    <span className="text-xs text-surface-400">住民税</span>
                    <div className="font-mono font-semibold text-rose-400 mt-1">
                      ¥{Number(detailCalc.resident_tax_amount).toLocaleString()}
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-right text-sm">
                  控除合計: <span className="font-mono font-bold text-rose-400 text-base">¥{Number(detailCalc.total_deductions).toLocaleString()}</span>
                </div>
              </div>

              {/* 参照したマスタレコードID・計算根拠スナップショット (追跡可能性) */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-surface-400 mb-2 flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-400" />
                  参照された料率マスタレコード (計算根拠の追跡可能性)
                </h4>
                <div className="space-y-2">
                  {detailCalc.applied_rate_ids && detailCalc.applied_rate_ids.length > 0 ? (
                    detailCalc.applied_rate_ids.map((rate: AppliedRateEntry, idx: number) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-surface-700 bg-surface-950/70 p-3 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-surface-200">
                            {rate.type === 'income_tax' ? '源泉徴収税額表' : rate.name || rate.type}
                          </span>
                          <span className="font-mono text-emerald-400">
                            {rate.type === 'income_tax'
                              ? `扶養親族 ${rate.dependents_count}名 / 課税対象額 ¥${rate.taxable_income?.toLocaleString()} → 税額 ¥${rate.tax_amount?.toLocaleString()}`
                              : `料率: ${(Number(rate.rate) * 100).toFixed(3)}% (算定基準: ¥${rate.base_amount?.toLocaleString()})`}
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-surface-500 truncate">
                          参照マスタID: <span className="text-surface-400">{rate.rate_id}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-surface-500">適用されたマスタIDの記録はありません</div>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-surface-800 px-6 py-4 flex justify-end">
              <button
                type="button"
                onClick={() => setDetailCalc(null)}
                className="rounded-lg bg-surface-800 px-4 py-2 text-sm font-medium text-surface-200 hover:bg-surface-700"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 期間作成モーダル */}
      {showPeriodModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-surface-800 bg-surface-900 shadow-2xl p-6">
            <div className="flex items-center justify-between border-b border-surface-800 pb-4 mb-4">
              <h3 className="text-lg font-semibold text-surface-100 flex items-center gap-2">
                <Calendar className="h-5 w-5 text-brand-400" />
                新規給与計算期間の作成
              </h3>
              <button
                type="button"
                onClick={() => setShowPeriodModal(false)}
                className="text-surface-400 hover:text-surface-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreatePeriod} className="space-y-4 text-sm">
              <div>
                <label className="block text-surface-300 font-medium mb-1">期間名称</label>
                <input
                  type="text"
                  required
                  placeholder="例: 2026年05月度給与"
                  value={periodForm.name}
                  onChange={(e) => setPeriodForm({ ...periodForm, name: e.target.value })}
                  className="w-full rounded-lg border border-surface-700 bg-surface-800 px-3.5 py-2 text-surface-100 focus:border-brand-500 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-surface-300 font-medium mb-1">開始日</label>
                  <input
                    type="date"
                    required
                    value={periodForm.period_start}
                    onChange={(e) => setPeriodForm({ ...periodForm, period_start: e.target.value })}
                    className="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-surface-100 focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-surface-300 font-medium mb-1">終了日</label>
                  <input
                    type="date"
                    required
                    value={periodForm.period_end}
                    onChange={(e) => setPeriodForm({ ...periodForm, period_end: e.target.value })}
                    className="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-surface-100 focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-surface-300 font-medium mb-1">支給日</label>
                <input
                  type="date"
                  required
                  value={periodForm.payment_date}
                  onChange={(e) => setPeriodForm({ ...periodForm, payment_date: e.target.value })}
                  className="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-surface-100 focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-surface-800">
                <button
                  type="button"
                  onClick={() => setShowPeriodModal(false)}
                  className="rounded-lg bg-surface-800 px-4 py-2 text-sm text-surface-300 hover:bg-surface-700"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
                >
                  作成する
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 給与プロファイル作成モーダル */}
      {showProfileModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-xl border border-surface-800 bg-surface-900 shadow-2xl p-6">
            <div className="flex items-center justify-between border-b border-surface-800 pb-4 mb-4">
              <h3 className="text-lg font-semibold text-surface-100 flex items-center gap-2">
                <Users className="h-5 w-5 text-brand-400" />
                従業員給与プロファイルの設定
              </h3>
              <button
                type="button"
                onClick={() => setShowProfileModal(false)}
                className="text-surface-400 hover:text-surface-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateProfile} className="space-y-4 text-sm max-h-[75vh] overflow-y-auto pr-1">
              <div>
                <label className="block text-surface-300 font-medium mb-1">従業員ID (UUID)</label>
                <input
                  type="text"
                  required
                  placeholder="従業員IDを入力してください"
                  value={profileForm.employee_id}
                  onChange={(e) => setProfileForm({ ...profileForm, employee_id: e.target.value })}
                  className="w-full rounded-lg border border-surface-700 bg-surface-800 px-3.5 py-2 text-surface-100 focus:border-brand-500 focus:outline-none font-mono text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-surface-300 font-medium mb-1">給与形態</label>
                  <select
                    value={profileForm.salary_type}
                    onChange={(e) =>
                      setProfileForm({ ...profileForm, salary_type: e.target.value as 'monthly' | 'hourly' })
                    }
                    className="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-surface-100 focus:border-brand-500 focus:outline-none"
                  >
                    <option value="monthly">月給制</option>
                    <option value="hourly">時給制</option>
                  </select>
                </div>
                <div>
                  <label className="block text-surface-300 font-medium mb-1">基本給 / 時給 (円)</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={profileForm.salary_type === 'monthly' ? profileForm.base_salary : profileForm.hourly_wage}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (profileForm.salary_type === 'monthly') {
                        setProfileForm({ ...profileForm, base_salary: val });
                      } else {
                        setProfileForm({ ...profileForm, hourly_wage: val });
                      }
                    }}
                    className="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-surface-100 focus:border-brand-500 focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-surface-300 font-medium mb-1">標準報酬月額 (社保算定基礎)</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={profileForm.standard_monthly_remuneration}
                    onChange={(e) =>
                      setProfileForm({ ...profileForm, standard_monthly_remuneration: Number(e.target.value) })
                    }
                    className="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-surface-100 focus:border-brand-500 focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-surface-300 font-medium mb-1">扶養親族等の数 (源泉所得税)</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={profileForm.dependents_count}
                    onChange={(e) => setProfileForm({ ...profileForm, dependents_count: Number(e.target.value) })}
                    className="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-surface-100 focus:border-brand-500 focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-surface-300 font-medium mb-1">住民税月額 (控除)</label>
                  <input
                    type="number"
                    min="0"
                    value={profileForm.resident_tax_amount}
                    onChange={(e) => setProfileForm({ ...profileForm, resident_tax_amount: Number(e.target.value) })}
                    className="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-surface-100 focus:border-brand-500 focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-surface-300 font-medium mb-1">適用都道府県</label>
                  <input
                    type="text"
                    placeholder="例: tokyo"
                    value={profileForm.prefecture}
                    onChange={(e) => setProfileForm({ ...profileForm, prefecture: e.target.value })}
                    className="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-surface-100 focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* 保険加入チェック */}
              <div className="rounded-lg bg-surface-800/50 p-3 space-y-2 border border-surface-700">
                <span className="text-xs font-semibold text-surface-300 block mb-1">社会保険・労働保険の加入区分</span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <label className="flex items-center gap-2 text-surface-200">
                    <input
                      type="checkbox"
                      checked={profileForm.has_health_insurance}
                      onChange={(e) => setProfileForm({ ...profileForm, has_health_insurance: e.target.checked })}
                      className="rounded border-surface-700 bg-surface-900 text-brand-600 focus:ring-0"
                    />
                    健康保険
                  </label>
                  <label className="flex items-center gap-2 text-surface-200">
                    <input
                      type="checkbox"
                      checked={profileForm.has_care_insurance}
                      onChange={(e) => setProfileForm({ ...profileForm, has_care_insurance: e.target.checked })}
                      className="rounded border-surface-700 bg-surface-900 text-brand-600 focus:ring-0"
                    />
                    介護保険 (40〜64歳)
                  </label>
                  <label className="flex items-center gap-2 text-surface-200">
                    <input
                      type="checkbox"
                      checked={profileForm.has_pension}
                      onChange={(e) => setProfileForm({ ...profileForm, has_pension: e.target.checked })}
                      className="rounded border-surface-700 bg-surface-900 text-brand-600 focus:ring-0"
                    />
                    厚生年金
                  </label>
                  <label className="flex items-center gap-2 text-surface-200">
                    <input
                      type="checkbox"
                      checked={profileForm.has_employment_insurance}
                      onChange={(e) => setProfileForm({ ...profileForm, has_employment_insurance: e.target.checked })}
                      className="rounded border-surface-700 bg-surface-900 text-brand-600 focus:ring-0"
                    />
                    雇用保険
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-surface-300 font-medium mb-1">適用開始日</label>
                <input
                  type="date"
                  required
                  value={profileForm.effective_from}
                  onChange={(e) => setProfileForm({ ...profileForm, effective_from: e.target.value })}
                  className="w-full rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-surface-100 focus:border-brand-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-surface-800">
                <button
                  type="button"
                  onClick={() => setShowProfileModal(false)}
                  className="rounded-lg bg-surface-800 px-4 py-2 text-sm text-surface-300 hover:bg-surface-700"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
                >
                  登録する
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
