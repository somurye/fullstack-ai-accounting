import React, { useState, useEffect, useCallback } from 'react';
import { payslipsApi } from './api';
import type { Payslip, PayslipStatus } from './types';

export const PayslipsPage: React.FC = () => {
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPayslip, setSelectedPayslip] = useState<Payslip | null>(null);
  const [periodFilter, setPeriodFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<PayslipStatus | ''>('');
  const [actionLoading, setActionLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchPayslips = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await payslipsApi.list({
        payroll_period: periodFilter || undefined,
        status: statusFilter || undefined,
      });
      setPayslips(res.payslips);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.message || '給与明細の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [periodFilter, statusFilter]);

  useEffect(() => {
    fetchPayslips();
  }, [fetchPayslips]);

  const handleDownloadPdf = async (payslip: Payslip) => {
    try {
      setActionLoading(true);
      const filename = `payslip_${payslip.payroll_period}_${payslip.employee_code || payslip.employee_name}.pdf`;
      await payslipsApi.downloadPdf(payslip.id, filename);
    } catch (err: any) {
      alert(err.response?.data?.error?.message || 'PDFのダウンロードに失敗しました');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirm = async (id: string) => {
    if (!window.confirm('この給与明細を確定発行しますか？確定後は内容の改ざん・変更が一切禁止(WORM)されます。')) {
      return;
    }
    try {
      setActionLoading(true);
      const updated = await payslipsApi.confirm(id);
      setSuccessMessage(`明細 (ID: ${id.slice(0, 8)}) を確定発行しました。`);
      setSelectedPayslip(updated);
      await fetchPayslips();
    } catch (err: any) {
      alert(err.response?.data?.error?.message || '確定発行に失敗しました');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      {/* ヘッダーエリア */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1e293b', margin: 0 }}>給与明細 (Payslips)</h1>
          <p style={{ color: '#64748b', fontSize: '14px', margin: '4px 0 0 0' }}>
            確定済み給与計算から発行された公式明細の閲覧・確定発行・PDF出力 (WORM改ざん防止防御対応)
          </p>
        </div>
        <button
          onClick={() => fetchPayslips()}
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
          type="text"
          placeholder="対象年月 (例: 2026-05)"
          value={periodFilter}
          onChange={(e) => setPeriodFilter(e.target.value)}
          style={{ padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '14px' }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as PayslipStatus | '')}
          style={{ padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '14px' }}
        >
          <option value="">すべてのステータス</option>
          <option value="confirmed">確定済 (confirmed)</option>
          <option value="draft">ドラフト (draft)</option>
        </select>
      </div>

      {/* 明細一覧テーブル */}
      <div style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
          <thead style={{ backgroundColor: '#f1f5f9', color: '#475569', borderBottom: '1px solid #e2e8f0' }}>
            <tr>
              <th style={{ padding: '12px 16px' }}>対象月</th>
              <th style={{ padding: '12px 16px' }}>従業員</th>
              <th style={{ padding: '12px 16px' }}>部署</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>総支給額</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>総控除額</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>差引支給額</th>
              <th style={{ padding: '12px 16px', textAlign: 'center' }}>状態</th>
              <th style={{ padding: '12px 16px', textAlign: 'center' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                  給与明細を読み込み中...
                </td>
              </tr>
            ) : payslips.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
                  該当する給与明細はありません
                </td>
              </tr>
            ) : (
              payslips.map((p) => {
                const isConfirmed = p.status === 'confirmed';
                const earnings = p.snapshot_data?.earnings;
                const deductions = p.snapshot_data?.deductions;
                const netPay = p.snapshot_data?.net_pay ?? (earnings?.total_gross_pay ?? 0) - (deductions?.total_deductions ?? 0);

                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 500, color: '#334155' }}>
                      {p.payroll_period}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontWeight: 600, color: '#1e293b' }}>{p.employee_name}</div>
                      <div style={{ fontSize: '12px', color: '#94a3b8' }}>{p.employee_code}</div>
                    </td>
                    <td style={{ padding: '12px 16px', color: '#64748b' }}>
                      {p.department_name || '-'}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 500, color: '#0f172a' }}>
                      ¥{(earnings?.total_gross_pay ?? 0).toLocaleString()}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', color: '#e11d48' }}>
                      ¥{(deductions?.total_deductions ?? 0).toLocaleString()}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 'bold', color: '#059669' }}>
                      ¥{netPay.toLocaleString()}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '3px 10px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: 600,
                          backgroundColor: isConfirmed ? '#dcfce7' : '#fef9c3',
                          color: isConfirmed ? '#166534' : '#854d0e',
                        }}
                      >
                        {isConfirmed ? '確定済 (WORM)' : '下書き'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                        <button
                          onClick={() => setSelectedPayslip(p)}
                          style={{
                            backgroundColor: '#f1f5f9',
                            border: '1px solid #cbd5e1',
                            padding: '4px 10px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            cursor: 'pointer',
                          }}
                        >
                          詳細
                        </button>
                        <button
                          onClick={() => handleDownloadPdf(p)}
                          disabled={actionLoading}
                          style={{
                            backgroundColor: '#0284c7',
                            color: '#fff',
                            border: 'none',
                            padding: '4px 10px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            cursor: 'pointer',
                          }}
                        >
                          PDF
                        </button>
                        {!isConfirmed && (
                          <button
                            onClick={() => handleConfirm(p.id)}
                            disabled={actionLoading}
                            style={{
                              backgroundColor: '#16a34a',
                              color: '#fff',
                              border: 'none',
                              padding: '4px 10px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              cursor: 'pointer',
                            }}
                          >
                            確定
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

      {/* 詳細モーダル */}
      {selectedPayslip && (
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
              maxWidth: '800px',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #e2e8f0', paddingBottom: '16px', marginBottom: '20px' }}>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: 'bold', margin: 0, color: '#0f172a' }}>
                  給与明細詳細: {selectedPayslip.payroll_period} 分
                </h2>
                <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                  従業員: {selectedPayslip.employee_name} ({selectedPayslip.employee_code}) | 支給日: {selectedPayslip.payment_date}
                </div>
              </div>
              <button
                onClick={() => setSelectedPayslip(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  color: '#94a3b8',
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </div>

            {/* 勤怠サマリ */}
            <div style={{ backgroundColor: '#f8fafc', padding: '12px', borderRadius: '8px', marginBottom: '20px', display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
              <div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>所定内時間</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#1e293b' }}>{selectedPayslip.snapshot_data?.attendance?.regular_hours ?? 0}h</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>残業時間</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#0284c7' }}>{selectedPayslip.snapshot_data?.attendance?.overtime_hours ?? 0}h</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>深夜時間</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#7c3aed' }}>{selectedPayslip.snapshot_data?.attendance?.late_night_hours ?? 0}h</div>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>休日時間</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#d97706' }}>{selectedPayslip.snapshot_data?.attendance?.holiday_hours ?? 0}h</div>
              </div>
            </div>

            {/* 支給・控除 2列テーブル */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
              {/* 支給の部 */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                <div style={{ backgroundColor: '#f0fdf4', padding: '10px 16px', fontWeight: 'bold', color: '#166534', borderBottom: '1px solid #bbf7d0' }}>
                  支給の部 (Gross Pay)
                </div>
                <div style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed #f1f5f9' }}>
                    <span style={{ color: '#475569' }}>基本給</span>
                    <span style={{ fontWeight: 500 }}>¥{(selectedPayslip.snapshot_data?.earnings?.base_salary ?? 0).toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed #f1f5f9' }}>
                    <span style={{ color: '#475569' }}>時間外手当</span>
                    <span style={{ fontWeight: 500 }}>¥{(selectedPayslip.snapshot_data?.earnings?.overtime_pay ?? 0).toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed #f1f5f9' }}>
                    <span style={{ color: '#475569' }}>深夜手当</span>
                    <span style={{ fontWeight: 500 }}>¥{(selectedPayslip.snapshot_data?.earnings?.late_night_pay ?? 0).toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed #f1f5f9' }}>
                    <span style={{ color: '#475569' }}>休日手当</span>
                    <span style={{ fontWeight: 500 }}>¥{(selectedPayslip.snapshot_data?.earnings?.holiday_pay ?? 0).toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0 0', fontWeight: 'bold', color: '#166534', fontSize: '15px' }}>
                    <span>総支給合計</span>
                    <span>¥{(selectedPayslip.snapshot_data?.earnings?.total_gross_pay ?? 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* 控除の部 */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                <div style={{ backgroundColor: '#fef2f2', padding: '10px 16px', fontWeight: 'bold', color: '#991b1b', borderBottom: '1px solid #fecaca' }}>
                  控除の部 (Deductions)
                </div>
                <div style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed #f1f5f9' }}>
                    <span style={{ color: '#475569' }}>健康保険料</span>
                    <span style={{ fontWeight: 500 }}>¥{(selectedPayslip.snapshot_data?.deductions?.health_insurance_amount ?? 0).toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed #f1f5f9' }}>
                    <span style={{ color: '#475569' }}>介護保険料</span>
                    <span style={{ fontWeight: 500 }}>¥{(selectedPayslip.snapshot_data?.deductions?.care_insurance_amount ?? 0).toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed #f1f5f9' }}>
                    <span style={{ color: '#475569' }}>厚生年金保険料</span>
                    <span style={{ fontWeight: 500 }}>¥{(selectedPayslip.snapshot_data?.deductions?.pension_amount ?? 0).toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed #f1f5f9' }}>
                    <span style={{ color: '#475569' }}>雇用保険料</span>
                    <span style={{ fontWeight: 500 }}>¥{(selectedPayslip.snapshot_data?.deductions?.employment_insurance_amount ?? 0).toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed #f1f5f9' }}>
                    <span style={{ color: '#475569' }}>所得税 (源泉徴収)</span>
                    <span style={{ fontWeight: 500 }}>¥{(selectedPayslip.snapshot_data?.deductions?.income_tax_amount ?? 0).toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed #f1f5f9' }}>
                    <span style={{ color: '#475569' }}>住民税</span>
                    <span style={{ fontWeight: 500 }}>¥{(selectedPayslip.snapshot_data?.deductions?.resident_tax_amount ?? 0).toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0 0', fontWeight: 'bold', color: '#991b1b', fontSize: '15px' }}>
                    <span>控除合計</span>
                    <span>¥{(selectedPayslip.snapshot_data?.deductions?.total_deductions ?? 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 差引手取額強調バナー */}
            <div style={{ backgroundColor: '#0f172a', color: '#fff', padding: '16px 20px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>差引支給額 (手取り振込額)</div>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#34d399' }}>
                  ¥{(selectedPayslip.snapshot_data?.net_pay ?? 0).toLocaleString()}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span
                  style={{
                    backgroundColor: selectedPayslip.status === 'confirmed' ? '#166534' : '#854d0e',
                    color: '#fff',
                    padding: '4px 12px',
                    borderRadius: '12px',
                    fontSize: '12px',
                    fontWeight: 600,
                  }}
                >
                  {selectedPayslip.status === 'confirmed' ? '確定済み (改ざん不可)' : 'ドラフト'}
                </span>
                {selectedPayslip.issued_at && (
                  <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                    発行日時: {new Date(selectedPayslip.issued_at).toLocaleString()}
                  </div>
                )}
              </div>
            </div>

            {/* フッターアクション */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                onClick={() => setSelectedPayslip(null)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                閉じる
              </button>
              <button
                onClick={() => handleDownloadPdf(selectedPayslip)}
                disabled={actionLoading}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#0284c7',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                PDFをダウンロード
              </button>
              {selectedPayslip.status !== 'confirmed' && (
                <button
                  onClick={() => handleConfirm(selectedPayslip.id)}
                  disabled={actionLoading}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#16a34a',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  明細を確定発行
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
