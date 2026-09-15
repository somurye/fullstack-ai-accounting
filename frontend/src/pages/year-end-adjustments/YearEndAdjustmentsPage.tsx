import React, { useState, useEffect, useCallback } from 'react';
import { yearEndAdjustmentsApi } from './api';
import type { YearEndAdjustment, YearEndAdjustmentStatus, YearEndAdjustmentCalculateInput } from './types';
import { apiClient } from '../../lib/apiClient';

interface EmployeeOption {
  id: string;
  name: string;
  employee_code: string;
}

export const YearEndAdjustmentsPage: React.FC = () => {
  const [adjustments, setAdjustments] = useState<YearEndAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // フィルター
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear());
  const [statusFilter, setStatusFilter] = useState<YearEndAdjustmentStatus | ''>('');

  // モーダル状態
  const [selectedAdjustment, setSelectedAdjustment] = useState<YearEndAdjustment | null>(null);
  const [isCalcModalOpen, setIsCalcModalOpen] = useState(false);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [targetForSubmit, setTargetForSubmit] = useState<YearEndAdjustment | null>(null);
  const [submitComment, setSubmitComment] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // 計算フォーム
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [calcForm, setCalcForm] = useState<YearEndAdjustmentCalculateInput>({
    employee_id: '',
    tax_year: new Date().getFullYear(),
    spouse_deduction: 0,
    dependents_count: 0,
    life_insurance_deduction: 0,
    earthquake_insurance_deduction: 0,
    housing_loan_deduction: 0,
  });

  const fetchAdjustments = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await yearEndAdjustmentsApi.list({
        tax_year: yearFilter,
        status: statusFilter || undefined,
      });
      setAdjustments(res.adjustments);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.message || '年末調整データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [yearFilter, statusFilter]);

  const fetchEmployees = async () => {
    try {
      const res = await apiClient.get<{ data: EmployeeOption[] }>('/employees');
      setEmployees(res.data.data || []);
      if (res.data.data && res.data.data.length > 0 && !calcForm.employee_id) {
        setCalcForm((prev) => ({ ...prev, employee_id: res.data.data[0].id }));
      }
    } catch {
      // 従業員取得エラー時は空
    }
  };

  useEffect(() => {
    fetchAdjustments();
  }, [fetchAdjustments]);

  useEffect(() => {
    fetchEmployees();
  }, []);

  const handleCalculate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!calcForm.employee_id) {
      alert('従業員を選択してください');
      return;
    }
    try {
      setActionLoading(true);
      const result = await yearEndAdjustmentsApi.calculate(calcForm);
      setSuccessMessage(`年末調整の計算が完了しました (ドラフトID: ${result.id.slice(0, 8)})`);
      setIsCalcModalOpen(false);
      setSelectedAdjustment(result);
      await fetchAdjustments();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '計算処理に失敗しました');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSubmitApproval = async () => {
    if (!targetForSubmit) return;
    try {
      setActionLoading(true);
      const updated = await yearEndAdjustmentsApi.submitApproval(targetForSubmit.id, {
        comment: submitComment || undefined,
      });
      setSuccessMessage(`承認申請を提出しました (ステータス: ${updated.status})`);
      setIsSubmitModalOpen(false);
      setSubmitComment('');
      setTargetForSubmit(null);
      await fetchAdjustments();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '承認申請に失敗しました');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      {/* ヘッダーエリア */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1e293b', margin: 0 }}>年末調整 (Year-End Adjustments)</h1>
          <p style={{ color: '#64748b', fontSize: '14px', margin: '4px 0 0 0' }}>
            年間確定給与・各種所得控除に基づく過不足税額精算・承認連携・WORM不変性管理
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setIsCalcModalOpen(true)}
            style={{
              backgroundColor: '#16a34a',
              color: '#fff',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '6px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            + 年末調整を新規計算
          </button>
          <button
            onClick={() => fetchAdjustments()}
            disabled={loading}
            style={{
              backgroundColor: '#0284c7',
              color: '#fff',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '6px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {loading ? '更新中...' : '再読み込み'}
          </button>
        </div>
      </div>

      {/* 成功・エラーメッセージ */}
      {successMessage && (
        <div style={{ backgroundColor: '#ecfdf5', border: '1px solid #10b981', color: '#065f46', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>
          {successMessage}
        </div>
      )}
      {error && (
        <div style={{ backgroundColor: '#fef2f2', border: '1px solid #ef4444', color: '#991b1b', padding: '12px', borderRadius: '6px', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      {/* フィルターバー */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', backgroundColor: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
        <input
          type="number"
          placeholder="対象年 (例: 2026)"
          value={yearFilter}
          onChange={(e) => setYearFilter(Number(e.target.value))}
          style={{ padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '14px', width: '120px' }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as YearEndAdjustmentStatus | '')}
          style={{ padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '14px' }}
        >
          <option value="">すべてのステータス</option>
          <option value="draft">ドラフト (draft)</option>
          <option value="pending_approval">承認待ち (pending_approval)</option>
          <option value="active">確定済 (active - WORM)</option>
          <option value="rejected">却下 (rejected)</option>
        </select>
      </div>

      {/* 一覧テーブル */}
      <div style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
          <thead style={{ backgroundColor: '#f1f5f9', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>
            <tr>
              <th style={{ padding: '12px 16px' }}>年度</th>
              <th style={{ padding: '12px 16px' }}>従業員</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>年間支給総額</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>年間社保控除</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>徴収済税額</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>確定年税額</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>過不足税額</th>
              <th style={{ padding: '12px 16px', textAlign: 'center' }}>状態</th>
              <th style={{ padding: '12px 16px', textAlign: 'center' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                  年末調整データを読み込み中...
                </td>
              </tr>
            ) : adjustments.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                  該当する年末調整レコードはありません
                </td>
              </tr>
            ) : (
              adjustments.map((a) => {
                const isRefund = a.adjustment_amount > 0;
                const isCollect = a.adjustment_amount < 0;
                const isActive = a.status === 'active';

                return (
                  <tr key={a.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 600, color: '#334155' }}>
                      {a.tax_year}年分
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 600, color: '#1e293b' }}>{a.employee_name}</div>
                      <div style={{ fontSize: '12px', color: '#94a3b8' }}>{a.employee_code}</div>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 500 }}>
                      ¥{a.annual_gross_pay.toLocaleString()}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: '#475569' }}>
                      ¥{a.annual_social_insurance.toLocaleString()}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: '#475569' }}>
                      ¥{a.annual_withheld_tax.toLocaleString()}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 500, color: '#0f172a' }}>
                      ¥{a.final_annual_tax.toLocaleString()}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 'bold' }}>
                      <span style={{ color: isRefund ? '#059669' : isCollect ? '#e11d48' : '#64748b' }}>
                        {isRefund ? `+¥${a.adjustment_amount.toLocaleString()} (還付)` : isCollect ? `-¥${Math.abs(a.adjustment_amount).toLocaleString()} (追徴)` : '¥0'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '3px 10px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: 600,
                          backgroundColor:
                            a.status === 'active'
                              ? '#dcfce7'
                              : a.status === 'pending_approval'
                              ? '#dbeafe'
                              : a.status === 'rejected'
                              ? '#fee2e2'
                              : '#fef9c3',
                          color:
                            a.status === 'active'
                              ? '#166534'
                              : a.status === 'pending_approval'
                              ? '#1e40af'
                              : a.status === 'rejected'
                              ? '#991b1b'
                              : '#854d0e',
                        }}
                      >
                        {a.status === 'active'
                          ? '確定済 (WORM)'
                          : a.status === 'pending_approval'
                          ? '承認待ち'
                          : a.status === 'rejected'
                          ? '却下'
                          : 'ドラフト'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                        <button
                          onClick={() => setSelectedAdjustment(a)}
                          style={{
                            backgroundColor: '#f1f5f9',
                            border: '1px solid #cbd5e1',
                            padding: '4px 10px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            cursor: 'pointer',
                          }}
                        >
                          内訳詳細
                        </button>
                        {!isActive && (
                          <button
                            onClick={() => {
                              setTargetForSubmit(a);
                              setIsSubmitModalOpen(true);
                            }}
                            disabled={actionLoading || a.status === 'pending_approval'}
                            style={{
                              backgroundColor: '#4f46e5',
                              color: '#fff',
                              border: 'none',
                              padding: '4px 10px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              cursor: 'pointer',
                            }}
                          >
                            承認申請
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 新規計算モーダル */}
      {isCalcModalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div style={{ backgroundColor: '#fff', borderRadius: '12px', width: '90%', maxWidth: '550px', padding: '24px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '16px', color: '#1e293b' }}>
              年末調整の計算実行 (ドラフト作成)
            </h2>
            <form onSubmit={handleCalculate}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#475569', marginBottom: '4px' }}>
                  対象従業員
                </label>
                <select
                  value={calcForm.employee_id}
                  onChange={(e) => setCalcForm({ ...calcForm, employee_id: e.target.value })}
                  required
                  style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '14px' }}
                >
                  <option value="">従業員を選択してください</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.employee_code})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#475569', marginBottom: '4px' }}>
                  対象年度
                </label>
                <input
                  type="number"
                  value={calcForm.tax_year}
                  onChange={(e) => setCalcForm({ ...calcForm, tax_year: Number(e.target.value) })}
                  required
                  style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '14px' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#475569', marginBottom: '4px' }}>
                    配偶者控除申告額 (円)
                  </label>
                  <input
                    type="number"
                    value={calcForm.spouse_deduction}
                    onChange={(e) => setCalcForm({ ...calcForm, spouse_deduction: Number(e.target.value) })}
                    style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '14px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#475569', marginBottom: '4px' }}>
                    扶養親族等の数 (人)
                  </label>
                  <input
                    type="number"
                    value={calcForm.dependents_count}
                    onChange={(e) => setCalcForm({ ...calcForm, dependents_count: Number(e.target.value) })}
                    style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '14px' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#475569', marginBottom: '4px' }}>
                    生命保険料控除 (最高12万円)
                  </label>
                  <input
                    type="number"
                    max={120000}
                    value={calcForm.life_insurance_deduction}
                    onChange={(e) => setCalcForm({ ...calcForm, life_insurance_deduction: Number(e.target.value) })}
                    style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '14px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#475569', marginBottom: '4px' }}>
                    地震保険料控除 (最高5万円)
                  </label>
                  <input
                    type="number"
                    max={50000}
                    value={calcForm.earthquake_insurance_deduction}
                    onChange={(e) => setCalcForm({ ...calcForm, earthquake_insurance_deduction: Number(e.target.value) })}
                    style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '14px' }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#475569', marginBottom: '4px' }}>
                  住宅借入金等特別控除 (住宅ローン控除税額)
                </label>
                <input
                  type="number"
                  value={calcForm.housing_loan_deduction}
                  onChange={(e) => setCalcForm({ ...calcForm, housing_loan_deduction: Number(e.target.value) })}
                  style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '14px' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setIsCalcModalOpen(false)}
                  style={{ padding: '8px 16px', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#f8fafc', cursor: 'pointer' }}
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  style={{ padding: '8px 16px', border: 'none', borderRadius: '6px', background: '#16a34a', color: '#fff', fontWeight: 500, cursor: 'pointer' }}
                >
                  {actionLoading ? '計算中...' : '計算を実行'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 承認申請モーダル */}
      {isSubmitModalOpen && targetForSubmit && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div style={{ backgroundColor: '#fff', borderRadius: '12px', width: '90%', maxWidth: '480px', padding: '24px', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px', color: '#1e293b' }}>
              年末調整の承認申請
            </h2>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px' }}>
              対象: {targetForSubmit.employee_name} ({targetForSubmit.tax_year}年分)
              <br />
              申請すると承認エンジン(approval_requests)に連携され、承認完了後に確定(active)となります。
            </p>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#475569', marginBottom: '4px' }}>
                申請コメント (任意)
              </label>
              <textarea
                rows={3}
                value={submitComment}
                onChange={(e) => setSubmitComment(e.target.value)}
                placeholder="確認事項や特記事項があれば入力してください"
                style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '14px' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setIsSubmitModalOpen(false)}
                style={{ padding: '8px 16px', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#f8fafc', cursor: 'pointer' }}
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleSubmitApproval}
                disabled={actionLoading}
                style={{ padding: '8px 16px', border: 'none', borderRadius: '6px', background: '#4f46e5', color: '#fff', fontWeight: 500, cursor: 'pointer' }}
              >
                {actionLoading ? '申請中...' : '承認申請を提出'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 詳細内訳モーダル */}
      {selectedAdjustment && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: '12px',
              width: '90%',
              maxWidth: '750px',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #e2e8f0', paddingBottom: '16px', marginBottom: '20px' }}>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0, color: '#0f172a' }}>
                  年末調整内訳: {selectedAdjustment.tax_year}年分
                </h2>
                <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                  従業員: {selectedAdjustment.employee_name} ({selectedAdjustment.employee_code})
                </div>
              </div>
              <button
                onClick={() => setSelectedAdjustment(null)}
                style={{ background: 'none', border: 'none', fontSize: '20px', color: '#94a3b8', cursor: 'pointer' }}
              >
                ×
              </button>
            </div>

            {/* 過不足税額バナー */}
            <div
              style={{
                backgroundColor: selectedAdjustment.adjustment_amount >= 0 ? '#ecfdf5' : '#fef2f2',
                border: `1px solid ${selectedAdjustment.adjustment_amount >= 0 ? '#10b981' : '#ef4444'}`,
                padding: '16px',
                borderRadius: '8px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '20px',
              }}
            >
              <div>
                <div style={{ fontSize: '13px', color: '#475569' }}>過不足税額精算結果</div>
                <div
                  style={{
                    fontSize: '22px',
                    fontWeight: 'bold',
                    color: selectedAdjustment.adjustment_amount >= 0 ? '#065f46' : '#991b1b',
                  }}
                >
                  {selectedAdjustment.adjustment_amount >= 0
                    ? `+¥${selectedAdjustment.adjustment_amount.toLocaleString()} (還付)`
                    : `-¥${Math.abs(selectedAdjustment.adjustment_amount).toLocaleString()} (追徴)`}
                </div>
              </div>
              <div>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '4px 12px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: 600,
                    backgroundColor: selectedAdjustment.status === 'active' ? '#166534' : '#854d0e',
                    color: '#fff',
                  }}
                >
                  {selectedAdjustment.status === 'active' ? '確定済 (WORM)' : '下書き/承認中'}
                </span>
              </div>
            </div>

            {/* 計算プロセスステップ */}
            <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', marginBottom: '20px' }}>
              <div style={{ backgroundColor: '#f8fafc', padding: '10px 16px', fontWeight: 'bold', borderBottom: '1px solid #e2e8f0' }}>
                年間収入・所得控除計算明細
              </div>
              <div style={{ padding: '16px', fontSize: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed #e2e8f0' }}>
                  <span>① 支払金額 (年間給与総額)</span>
                  <span style={{ fontWeight: 600 }}>¥{selectedAdjustment.annual_gross_pay.toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed #e2e8f0' }}>
                  <span>② 給与所得控除後の給与等の金額</span>
                  <span style={{ fontWeight: 600 }}>¥{selectedAdjustment.annual_taxable_pay.toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed #e2e8f0' }}>
                  <span>③ 所得控除の額の合計額</span>
                  <span style={{ fontWeight: 600, color: '#e11d48' }}>-¥{selectedAdjustment.total_deductions.toLocaleString()}</span>
                </div>
                <div style={{ padding: '8px 12px', backgroundColor: '#f8fafc', fontSize: '12px', color: '#64748b' }}>
                  基礎控除: ¥{(selectedAdjustment.deductions?.basic_deduction ?? 0).toLocaleString()} |
                  社保控除: ¥{(selectedAdjustment.deductions?.social_insurance_deduction ?? 0).toLocaleString()} |
                  配偶者控除: ¥{(selectedAdjustment.deductions?.spouse_deduction ?? 0).toLocaleString()} |
                  扶養控除: ¥{(selectedAdjustment.deductions?.dependents_deduction ?? 0).toLocaleString()} |
                  生命保険: ¥{(selectedAdjustment.deductions?.life_insurance_deduction ?? 0).toLocaleString()} |
                  地震保険: ¥{(selectedAdjustment.deductions?.earthquake_insurance_deduction ?? 0).toLocaleString()}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed #e2e8f0', marginTop: '8px' }}>
                  <span>④ 課税給与所得金額 (千円未満切捨て)</span>
                  <span style={{ fontWeight: 600 }}>¥{selectedAdjustment.taxable_income_after_deductions.toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed #e2e8f0' }}>
                  <span>⑤ 年調年税額 (所得税・復興税・住宅ローン控除後)</span>
                  <span style={{ fontWeight: 600 }}>¥{selectedAdjustment.final_annual_tax.toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                  <span>⑥ 源泉徴収済税額 (給与計算合計)</span>
                  <span style={{ fontWeight: 600 }}>¥{selectedAdjustment.annual_withheld_tax.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* 法令準拠に関する注記 */}
            <div style={{ fontSize: '12px', color: '#64748b', backgroundColor: '#f8fafc', padding: '10px 14px', borderRadius: '6px', marginBottom: '20px' }}>
              ※ 本機能の計算結果は業務システム上の標準簡略モデルに基づいています。実際の税務申告・確定申告書等の作成にあたっては税理士等の専門家レビューを推奨します。
            </div>

            {/* フッターアクション */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => setSelectedAdjustment(null)}
                style={{ padding: '8px 16px', border: '1px solid #cbd5e1', borderRadius: '6px', background: '#f8fafc', cursor: 'pointer' }}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
