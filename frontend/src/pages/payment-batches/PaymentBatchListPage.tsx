import { Download, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useExpenseReports } from '../expense-reports/hooks';
import { useVendorBills, useVendors } from '../vendor-bills/hooks';
import { useDownloadPaymentBatchFile, useExportZengin, usePaymentBatches } from './hooks';
import { PAYMENT_BATCH_STATUS_LABEL, type ExportZenginSource, type PaymentBatchStatus } from './types';

const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function statusBadgeClass(status: PaymentBatchStatus): string {
  switch (status) {
    case 'draft':
      return 'badge-draft';
    case 'exported':
      return 'badge-posted';
    case 'completed':
      return 'badge-posted';
    case 'cancelled':
      return 'badge-void';
    default:
      return 'badge-draft';
  }
}

export function PaymentBatchListPage() {
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [selectedVendorBillIds, setSelectedVendorBillIds] = useState<Set<string>>(new Set());
  const [selectedExpenseReportIds, setSelectedExpenseReportIds] = useState<Set<string>>(new Set());

  const { data: vendorBillsData } = useVendorBills({ status: 'approved', page_size: 100 });
  const { data: vendors = [] } = useVendors();
  const { data: expenseReportsData } = useExpenseReports({ status: 'approved', page_size: 100 });
  const { data: batchesData, isLoading: isBatchesLoading } = usePaymentBatches({ page_size: 50 });

  const exportMutation = useExportZengin();
  const downloadMutation = useDownloadPaymentBatchFile();

  const vendorBills = vendorBillsData?.vendorBills ?? [];
  const expenseReports = expenseReportsData?.reports ?? [];
  const batches = batchesData?.paymentBatches ?? [];

  const vendorName = (id?: string): string => vendors.find((v) => v.id === id)?.name ?? '—';

  const toggleVendorBill = (id: string): void => {
    setSelectedVendorBillIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleExpenseReport = (id: string): void => {
    setSelectedExpenseReportIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedTotal = useMemo(() => {
    const vbTotal = vendorBills
      .filter((b) => selectedVendorBillIds.has(b.id as string))
      .reduce((sum, b) => sum + (b.total_amount ?? 0), 0);
    const erTotal = expenseReports
      .filter((r) => selectedExpenseReportIds.has(r.id as string))
      .reduce((sum, r) => sum + (r.total_amount ?? 0), 0);
    return vbTotal + erTotal;
  }, [vendorBills, expenseReports, selectedVendorBillIds, selectedExpenseReportIds]);

  const selectedCount = selectedVendorBillIds.size + selectedExpenseReportIds.size;

  const handleExport = async (): Promise<void> => {
    const sources: ExportZenginSource[] = [
      ...[...selectedVendorBillIds].map((id) => ({ source_type: 'vendor_bill' as const, source_id: id })),
      ...[...selectedExpenseReportIds].map((id) => ({
        source_type: 'expense_reimbursement' as const,
        source_id: id,
      })),
    ];
    const batch = await exportMutation.mutateAsync({ payment_date: paymentDate, sources });
    setSelectedVendorBillIds(new Set());
    setSelectedExpenseReportIds(new Set());
    if (batch.id && batch.batch_no) {
      await downloadMutation.mutateAsync({ id: batch.id, batchNo: batch.batch_no });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-surface-50">支払バッチ (全銀協FB出力)</h1>
        <p className="mt-1 text-sm text-surface-400">
          承認済みの仕入請求書・経費立替金を集計し、総合振込用のFBデータを生成します。
        </p>
      </div>

      <div className="card space-y-4 p-5">
        <div className="flex items-end gap-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">振込指定日</label>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div className="text-sm text-surface-400">
            選択中: <span className="text-surface-100">{selectedCount}</span> 件 / 合計{' '}
            <span className="tabular-nums text-surface-100">{currencyFormatter.format(selectedTotal)}</span>
          </div>
          <button
            type="button"
            className="btn-primary ml-auto"
            disabled={selectedCount === 0 || exportMutation.isPending}
            onClick={() => void handleExport()}
          >
            <Send className="h-4 w-4" />
            {exportMutation.isPending ? '生成中…' : 'FBデータ出力(総合振込)'}
          </button>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-surface-100">仕入請求書(承認済み)</h2>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-surface-800">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-surface-900">
                <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
                  <th className="w-10 px-3 py-2" />
                  <th className="px-3 py-2 font-medium">請求書番号</th>
                  <th className="px-3 py-2 font-medium">仕入先</th>
                  <th className="px-3 py-2 font-medium">支払期日</th>
                  <th className="px-3 py-2 text-right font-medium">金額</th>
                </tr>
              </thead>
              <tbody>
                {vendorBills.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-surface-500">
                      承認済みの仕入請求書がありません
                    </td>
                  </tr>
                )}
                {vendorBills.map((bill) => (
                  <tr key={bill.id} className="border-b border-surface-800/60">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedVendorBillIds.has(bill.id as string)}
                        onChange={() => toggleVendorBill(bill.id as string)}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-surface-300">{bill.bill_no}</td>
                    <td className="px-3 py-2 text-surface-200">{vendorName(bill.vendor_id)}</td>
                    <td className="px-3 py-2 text-surface-300">{bill.due_date}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-surface-200">
                      {currencyFormatter.format(bill.total_amount ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-surface-100">経費立替金(承認済み)</h2>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-surface-800">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-surface-900">
                <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
                  <th className="w-10 px-3 py-2" />
                  <th className="px-3 py-2 font-medium">申請番号</th>
                  <th className="px-3 py-2 font-medium">目的</th>
                  <th className="px-3 py-2 text-right font-medium">金額</th>
                </tr>
              </thead>
              <tbody>
                {expenseReports.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-surface-500">
                      承認済みの経費立替金がありません
                    </td>
                  </tr>
                )}
                {expenseReports.map((report) => (
                  <tr key={report.id} className="border-b border-surface-800/60">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedExpenseReportIds.has(report.id as string)}
                        onChange={() => toggleExpenseReport(report.id as string)}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-surface-300">{report.report_no}</td>
                    <td className="px-3 py-2 text-surface-200">{report.purpose || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-surface-200">
                      {currencyFormatter.format(report.total_amount ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-surface-500">
            ※ 経費立替金の振込先口座はマスタ未整備のため、FBデータ上は口座欄が空欄で出力されます(MVP制約)。
          </p>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <div className="border-b border-surface-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-surface-100">バッチ履歴</h2>
        </div>
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-4 py-3 font-medium">バッチ番号</th>
              <th className="px-4 py-3 font-medium">振込指定日</th>
              <th className="px-4 py-3 font-medium">ステータス</th>
              <th className="px-4 py-3 text-right font-medium">合計金額</th>
              <th className="px-4 py-3 font-medium">ファイルハッシュ(SHA-256)</th>
              <th className="px-4 py-3 font-medium">アクション</th>
            </tr>
          </thead>
          <tbody>
            {isBatchesLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-surface-500">
                  読み込み中…
                </td>
              </tr>
            )}
            {!isBatchesLoading && batches.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-surface-500">
                  支払バッチはまだありません
                </td>
              </tr>
            )}
            {batches.map((batch) => (
              <tr key={batch.id} className="border-b border-surface-800/60">
                <td className="px-4 py-3 font-mono text-xs text-surface-300">{batch.batch_no}</td>
                <td className="px-4 py-3 text-surface-300">{batch.payment_date}</td>
                <td className="px-4 py-3">
                  <span className={statusBadgeClass(batch.status as PaymentBatchStatus)}>
                    {batch.status ? PAYMENT_BATCH_STATUS_LABEL[batch.status] : '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-surface-200">
                  {currencyFormatter.format(batch.total_amount ?? 0)}
                </td>
                <td className="px-4 py-3 font-mono text-[11px] text-surface-500">
                  {batch.file_hash ? `${batch.file_hash.slice(0, 16)}…` : '—'}
                </td>
                <td className="px-4 py-3">
                  {batch.status !== 'draft' && (
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-info transition-colors hover:bg-info-subtle"
                      title="再ダウンロード"
                      disabled={downloadMutation.isPending}
                      onClick={() =>
                        downloadMutation.mutate({ id: batch.id as string, batchNo: batch.batch_no ?? 'batch' })
                      }
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
