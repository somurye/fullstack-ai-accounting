import { ChevronLeft, ChevronRight, CreditCard, Plus, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PaymentDialog } from './PaymentDialog';
import { StatusBadge } from './StatusBadge';
import { useRecordVendorBillPayment, useSubmitVendorBill, useVendorBills, useVendors } from './hooks';
import { VENDOR_BILL_STATUS_LABEL, type VendorBill, type VendorBillStatus } from './types';

const PAGE_SIZE = 20;
const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

export function VendorBillListPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<VendorBillStatus | ''>('');
  const [vendorId, setVendorId] = useState('');
  const [page, setPage] = useState(1);
  const [pendingPaymentFor, setPendingPaymentFor] = useState<VendorBill | null>(null);

  const { data, isLoading, isError } = useVendorBills({
    page,
    page_size: PAGE_SIZE,
    status: status || undefined,
    vendor_id: vendorId || undefined,
  });
  const { data: vendors = [] } = useVendors();

  const submitMutation = useSubmitVendorBill();
  const paymentMutation = useRecordVendorBillPayment();

  const vendorBills = data?.vendorBills ?? [];
  const pagination = data?.meta?.pagination;
  const totalPages = pagination?.total_pages ?? 1;

  const vendorName = (id?: string): string => vendors.find((v) => v.id === id)?.name ?? '—';

  const statusOptions = useMemo(
    () => Object.entries(VENDOR_BILL_STATUS_LABEL) as [VendorBillStatus, string][],
    [],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-surface-50">仕入請求書・買掛金</h1>
          <p className="mt-1 text-sm text-surface-400">
            仕入請求書の登録・支払申請・支払消込を行います。
          </p>
        </div>
        <Link to="/vendor-bills/new" className="btn-primary">
          <Plus className="h-4 w-4" />
          新規仕入請求書
        </Link>
      </div>

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">ステータス</label>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as VendorBillStatus | '');
              setPage(1);
            }}
            className="rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="">すべて</option>
            {statusOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">仕入先</label>
          <select
            value={vendorId}
            onChange={(e) => {
              setVendorId(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="">すべて</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-4 py-3 font-medium">請求書番号</th>
              <th className="px-4 py-3 font-medium">仕入先</th>
              <th className="px-4 py-3 font-medium">請求日</th>
              <th className="px-4 py-3 font-medium">支払期日</th>
              <th className="px-4 py-3 font-medium">ステータス</th>
              <th className="px-4 py-3 text-right font-medium">総合計</th>
              <th className="px-4 py-3 font-medium">アクション</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-surface-500">
                  読み込み中…
                </td>
              </tr>
            )}
            {isError && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-negative">
                  仕入請求書一覧の取得に失敗しました
                </td>
              </tr>
            )}
            {!isLoading && !isError && vendorBills.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-surface-500">
                  該当する仕入請求書がありません
                </td>
              </tr>
            )}
            {vendorBills.map((bill) => (
              <tr
                key={bill.id}
                className="border-b border-surface-800/60 transition-colors hover:bg-surface-850/60"
              >
                <td className="px-4 py-3 font-mono text-xs text-surface-300">
                  <Link to={`/vendor-bills/${bill.id}`} className="hover:text-brand-300">
                    {bill.bill_no}
                  </Link>
                </td>
                <td className="px-4 py-3 text-surface-200">{vendorName(bill.vendor_id)}</td>
                <td className="px-4 py-3 text-surface-300">{bill.bill_date}</td>
                <td className="px-4 py-3 text-surface-300">{bill.due_date}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={bill.status as VendorBillStatus} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-surface-200">
                  {currencyFormatter.format(bill.total_amount ?? 0)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-100"
                      onClick={() => navigate(`/vendor-bills/${bill.id}`)}
                    >
                      詳細
                    </button>
                    {bill.status === 'draft' && (
                      <button
                        type="button"
                        className="rounded-md p-1.5 text-positive transition-colors hover:bg-positive-subtle"
                        title="提出"
                        disabled={submitMutation.isPending}
                        onClick={() => submitMutation.mutate(bill.id as string)}
                      >
                        <Send className="h-4 w-4" />
                      </button>
                    )}
                    {(bill.status === 'approved' || bill.status === 'scheduled_for_payment') && (
                      <button
                        type="button"
                        className="rounded-md p-1.5 text-info transition-colors hover:bg-info-subtle"
                        title="支払消込を登録"
                        onClick={() => setPendingPaymentFor(bill)}
                      >
                        <CreditCard className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-surface-400">
        <span>{pagination ? `全 ${pagination.total_count} 件中 ${vendorBills.length} 件表示` : ''}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary !px-2.5 !py-1.5"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span>
            {page} / {Math.max(totalPages, 1)}
          </span>
          <button
            type="button"
            className="btn-secondary !px-2.5 !py-1.5"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {pendingPaymentFor && (
        <PaymentDialog
          billNo={pendingPaymentFor.bill_no ?? ''}
          remainingAmount={pendingPaymentFor.total_amount ?? 0}
          isSubmitting={paymentMutation.isPending}
          onCancel={() => setPendingPaymentFor(null)}
          onConfirm={({ paymentDate, amount }) =>
            paymentMutation.mutate(
              { id: pendingPaymentFor.id as string, payment_date: paymentDate, amount },
              { onSuccess: () => setPendingPaymentFor(null) },
            )
          }
        />
      )}
    </div>
  );
}
