import { ChevronLeft, ChevronRight, CreditCard, FileCheck, Plus, ReceiptText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CreditNoteDialog } from './CreditNoteDialog';
import { PaymentDialog } from './PaymentDialog';
import { StatusBadge } from './StatusBadge';
import {
  useCreateCreditNote,
  useCustomers,
  useInvoices,
  useIssueInvoice,
  useRecordInvoicePayment,
} from './hooks';
import { INVOICE_STATUS_LABEL, type Invoice, type InvoiceStatus } from './types';

const PAGE_SIZE = 20;
const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

function remainingAmount(invoice: Invoice): number {
  // 一覧では入金消込履歴を保持しないため、正確な残額は詳細画面を参照する。
  // ここではpaid以外を「総合計が未消込」として扱う簡易表示に留める。
  if (invoice.status === 'paid' || invoice.status === 'credit_note_issued') return 0;
  return invoice.total_amount ?? 0;
}

type PendingAction = { type: 'payment' | 'credit-note'; invoice: Invoice } | null;

export function InvoiceListPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<InvoiceStatus | ''>('');
  const [customerId, setCustomerId] = useState('');
  const [page, setPage] = useState(1);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const { data, isLoading, isError } = useInvoices({
    page,
    page_size: PAGE_SIZE,
    status: status || undefined,
    customer_id: customerId || undefined,
  });
  const { data: customers = [] } = useCustomers();

  const issueMutation = useIssueInvoice();
  const paymentMutation = useRecordInvoicePayment();
  const creditNoteMutation = useCreateCreditNote();

  const invoices = data?.invoices ?? [];
  const pagination = data?.meta?.pagination;
  const totalPages = pagination?.total_pages ?? 1;

  const customerName = (id?: string): string => customers.find((c) => c.id === id)?.name ?? '—';

  const statusOptions = useMemo(
    () => Object.entries(INVOICE_STATUS_LABEL) as [InvoiceStatus, string][],
    [],
  );

  const isActionSubmitting = paymentMutation.isPending || creditNoteMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-surface-50">売上請求書</h1>
          <p className="mt-1 text-sm text-surface-400">請求書の作成・発行・入金消込・訂正を行います。</p>
        </div>
        <Link to="/invoices/new" className="btn-primary">
          <Plus className="h-4 w-4" />
          新規請求書
        </Link>
      </div>

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">ステータス</label>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as InvoiceStatus | '');
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
          <label className="mb-1 block text-xs font-medium text-surface-400">顧客</label>
          <select
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="">すべて</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
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
              <th className="px-4 py-3 font-medium">顧客</th>
              <th className="px-4 py-3 font-medium">発行日</th>
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
                  請求書一覧の取得に失敗しました
                </td>
              </tr>
            )}
            {!isLoading && !isError && invoices.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-surface-500">
                  該当する請求書がありません
                </td>
              </tr>
            )}
            {invoices.map((invoice) => (
              <tr
                key={invoice.id}
                className="border-b border-surface-800/60 transition-colors hover:bg-surface-850/60"
              >
                <td className="px-4 py-3 font-mono text-xs text-surface-300">
                  <Link to={`/invoices/${invoice.id}`} className="hover:text-brand-300">
                    {invoice.invoice_no}
                  </Link>
                </td>
                <td className="px-4 py-3 text-surface-200">{customerName(invoice.customer_id)}</td>
                <td className="px-4 py-3 text-surface-300">{invoice.issue_date}</td>
                <td className="px-4 py-3 text-surface-300">{invoice.due_date}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={invoice.status as InvoiceStatus} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-surface-200">
                  {currencyFormatter.format(invoice.total_amount ?? 0)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-100"
                      onClick={() => navigate(`/invoices/${invoice.id}`)}
                    >
                      詳細
                    </button>
                    {invoice.status === 'draft' && (
                      <button
                        type="button"
                        className="rounded-md p-1.5 text-positive transition-colors hover:bg-positive-subtle"
                        title="発行"
                        disabled={issueMutation.isPending}
                        onClick={() => issueMutation.mutate(invoice.id as string)}
                      >
                        <FileCheck className="h-4 w-4" />
                      </button>
                    )}
                    {(invoice.status === 'issued' || invoice.status === 'partially_paid') && (
                      <>
                        <button
                          type="button"
                          className="rounded-md p-1.5 text-info transition-colors hover:bg-info-subtle"
                          title="入金消込を登録"
                          onClick={() => setPendingAction({ type: 'payment', invoice })}
                        >
                          <CreditCard className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="rounded-md p-1.5 text-negative transition-colors hover:bg-negative-subtle"
                          title="クレジットノートを起票"
                          onClick={() => setPendingAction({ type: 'credit-note', invoice })}
                        >
                          <ReceiptText className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-surface-400">
        <span>{pagination ? `全 ${pagination.total_count} 件中 ${invoices.length} 件表示` : ''}</span>
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

      {pendingAction?.type === 'payment' && (
        <PaymentDialog
          invoiceNo={pendingAction.invoice.invoice_no ?? ''}
          remainingAmount={remainingAmount(pendingAction.invoice)}
          isSubmitting={isActionSubmitting}
          onCancel={() => setPendingAction(null)}
          onConfirm={({ paymentDate, amount }) =>
            paymentMutation.mutate(
              { id: pendingAction.invoice.id as string, payment_date: paymentDate, amount },
              { onSuccess: () => setPendingAction(null) },
            )
          }
        />
      )}

      {pendingAction?.type === 'credit-note' && (
        <CreditNoteDialog
          invoiceNo={pendingAction.invoice.invoice_no ?? ''}
          maxAmount={pendingAction.invoice.total_amount ?? 0}
          isSubmitting={isActionSubmitting}
          onCancel={() => setPendingAction(null)}
          onConfirm={({ amount, reason }) =>
            creditNoteMutation.mutate(
              { id: pendingAction.invoice.id as string, amount, reason },
              { onSuccess: () => setPendingAction(null) },
            )
          }
        />
      )}
    </div>
  );
}
