import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from '../../stores/toastStore';
import { PaymentDialog } from './PaymentDialog';
import { StatusBadge } from './StatusBadge';
import {
  useAccounts,
  useCreateVendorBill,
  useRecordVendorBillPayment,
  useSubmitVendorBill,
  useTaxCategories,
  useVendorBill,
  useVendors,
} from './hooks';
import { PAYMENT_METHOD_LABEL, type PaymentMethod, type VendorBillLineCreate } from './types';

interface LineItemState {
  key: string;
  description: string;
  amount: string;
  tax_category_id: string;
  account_id: string;
}

function emptyLine(): LineItemState {
  return {
    key: crypto.randomUUID(),
    description: '',
    amount: '',
    tax_category_id: '',
    account_id: '',
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

/** バックエンド `computeLineAmountsAndTax` と同じロジック(税区分ごとに1回だけ切り捨て)でプレビュー計算する */
function computeTotals(
  lines: LineItemState[],
  taxRateByCategory: Map<string, number>,
): { subtotal: number; tax: number; total: number } {
  const lineAmounts = lines.map((l) => Number(l.amount) || 0);
  const subtotal = lineAmounts.reduce((sum, a) => sum + a, 0);

  const groupSubtotals = new Map<string, number>();
  lines.forEach((line, i) => {
    if (!line.tax_category_id) return;
    groupSubtotals.set(
      line.tax_category_id,
      (groupSubtotals.get(line.tax_category_id) ?? 0) + lineAmounts[i],
    );
  });

  let tax = 0;
  for (const [categoryId, groupSubtotal] of groupSubtotals) {
    const rate = taxRateByCategory.get(categoryId) ?? 0;
    tax += Math.floor((groupSubtotal * rate) / 100);
  }

  return { subtotal, tax, total: subtotal + tax };
}

export function VendorBillFormPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) {
    return <CreateVendorBillForm />;
  }
  return <VendorBillDetailView id={id} />;
}

function CreateVendorBillForm() {
  const navigate = useNavigate();
  const { data: vendors = [] } = useVendors();
  const { data: accounts = [] } = useAccounts();
  const { data: taxCategories = [] } = useTaxCategories();
  const createMutation = useCreateVendorBill();

  const [vendorId, setVendorId] = useState('');
  const [billDate, setBillDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState(todayIso());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('bank_transfer');
  const [lines, setLines] = useState<LineItemState[]>([emptyLine()]);

  const taxRateByCategory = useMemo(
    () => new Map(taxCategories.map((t) => [t.id as string, t.tax_rate ?? 0])),
    [taxCategories],
  );
  const totals = useMemo(() => computeTotals(lines, taxRateByCategory), [lines, taxRateByCategory]);

  const updateLine = (key: string, patch: Partial<LineItemState>): void => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };
  const addLine = (): void => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (key: string): void => {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  };

  const hasValidLines =
    lines.length >= 1 &&
    lines.every((l) => l.description && l.tax_category_id && l.account_id && Number(l.amount) > 0);

  const buildLinePayload = (): VendorBillLineCreate[] =>
    lines.map((l) => ({
      description: l.description,
      amount: Number(l.amount),
      tax_category_id: l.tax_category_id,
      account_id: l.account_id,
    }));

  const handleSubmit = async (): Promise<void> => {
    if (!vendorId) {
      toast.error('仕入先を選択してください');
      return;
    }
    if (dueDate < billDate) {
      toast.error('支払期日は請求日以降の日付を指定してください');
      return;
    }
    if (!hasValidLines) {
      toast.error('全ての明細行に内容・金額・税区分・費用科目を入力してください');
      return;
    }
    const vendorBill = await createMutation.mutateAsync({
      vendor_id: vendorId,
      bill_date: billDate,
      due_date: dueDate,
      payment_method: paymentMethod,
      lines: buildLinePayload(),
    });
    navigate(`/vendor-bills/${vendorBill.id}`, { replace: true });
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/vendor-bills"
          className="mb-2 inline-flex items-center gap-1 text-sm text-surface-400 hover:text-surface-200"
        >
          <ArrowLeft className="h-4 w-4" />
          仕入請求書一覧へ戻る
        </Link>
        <h1 className="text-xl font-semibold text-surface-50">仕入請求書を新規登録</h1>
      </div>

      <div className="card space-y-4 p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">仕入先</label>
            <select
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            >
              <option value="">選択してください</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">請求日</label>
            <input
              type="date"
              value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">支払期日</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">支払方法</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            >
              {(Object.entries(PAYMENT_METHOD_LABEL) as [PaymentMethod, string][]).map(
                ([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ),
              )}
            </select>
          </div>
        </div>
      </div>

      <div className="card overflow-x-auto p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-surface-100">明細</h2>
          <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={addLine}>
            <Plus className="h-3.5 w-3.5" />
            明細行を追加
          </button>
        </div>

        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-2 py-2 font-medium">内容</th>
              <th className="px-2 py-2 text-right font-medium">金額</th>
              <th className="px-2 py-2 font-medium">税区分</th>
              <th className="px-2 py-2 font-medium">費用/資産科目</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key} className="border-b border-surface-800/60">
                <td className="px-2 py-2">
                  <input
                    type="text"
                    value={line.description}
                    onChange={(e) => updateLine(line.key, { description: e.target.value })}
                    className="w-56 rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={line.amount}
                    onChange={(e) => updateLine(line.key, { amount: e.target.value })}
                    className="w-28 rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-right text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </td>
                <td className="px-2 py-2">
                  <select
                    value={line.tax_category_id}
                    onChange={(e) => updateLine(line.key, { tax_category_id: e.target.value })}
                    className="w-36 rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                  >
                    <option value="">選択してください</option>
                    {taxCategories.map((tax) => (
                      <option key={tax.id} value={tax.id}>
                        {tax.name}({tax.tax_rate}%)
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2">
                  <select
                    value={line.account_id}
                    onChange={(e) => updateLine(line.key, { account_id: e.target.value })}
                    className="w-40 rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                  >
                    <option value="">選択してください</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.code} {account.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2">
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    disabled={lines.length <= 1}
                    className="rounded-md p-1.5 text-negative transition-colors hover:bg-negative-subtle disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex flex-col items-end gap-1 border-t border-surface-800 pt-4 text-sm">
          <div className="flex w-56 justify-between">
            <span className="text-surface-400">小計</span>
            <span className="tabular-nums text-surface-100">{currencyFormatter.format(totals.subtotal)}</span>
          </div>
          <div className="flex w-56 justify-between">
            <span className="text-surface-400">消費税</span>
            <span className="tabular-nums text-surface-100">{currencyFormatter.format(totals.tax)}</span>
          </div>
          <div className="flex w-56 justify-between text-base font-semibold">
            <span className="text-surface-200">総合計</span>
            <span className="tabular-nums text-surface-50">{currencyFormatter.format(totals.total)}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          className="btn-primary"
          disabled={!hasValidLines || createMutation.isPending}
          onClick={() => void handleSubmit()}
        >
          {createMutation.isPending ? '保存中…' : '下書き保存'}
        </button>
      </div>
    </div>
  );
}

function VendorBillDetailView({ id }: { id: string }) {
  const navigate = useNavigate();
  const { data: bill, isLoading } = useVendorBill(id);
  const { data: vendors = [] } = useVendors();
  const submitMutation = useSubmitVendorBill();
  const paymentMutation = useRecordVendorBillPayment();
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);

  if (isLoading || !bill) {
    return <p className="text-sm text-surface-400">読み込み中…</p>;
  }

  const vendorName = vendors.find((v) => v.id === bill.vendor_id)?.name ?? '—';
  const totalPaid = bill.payments.reduce((sum, p) => sum + (p.amount ?? 0), 0);
  const remaining = Math.max((bill.total_amount ?? 0) - totalPaid, 0);

  const canSubmit = bill.status === 'draft';
  const canRecordPayment = bill.status === 'approved' || bill.status === 'scheduled_for_payment';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button
            type="button"
            onClick={() => navigate('/vendor-bills')}
            className="mb-2 inline-flex items-center gap-1 text-sm text-surface-400 hover:text-surface-200"
          >
            <ArrowLeft className="h-4 w-4" />
            仕入請求書一覧へ戻る
          </button>
          <h1 className="text-xl font-semibold text-surface-50">仕入請求書 {bill.bill_no}</h1>
        </div>
        {bill.status && <StatusBadge status={bill.status} />}
      </div>

      <div className="card space-y-2 p-5 text-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <p className="text-xs font-medium text-surface-500">仕入先</p>
            <p className="mt-1 text-surface-100">{vendorName}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-surface-500">請求日</p>
            <p className="mt-1 text-surface-100">{bill.bill_date}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-surface-500">支払期日</p>
            <p className="mt-1 text-surface-100">{bill.due_date}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-surface-500">支払方法</p>
            <p className="mt-1 text-surface-100">
              {bill.payment_method ? PAYMENT_METHOD_LABEL[bill.payment_method] : '—'}
            </p>
          </div>
        </div>
        {bill.journal_entry && (
          <div className="pt-2">
            <p className="text-xs font-medium text-surface-500">紐付け仕訳(買掛金計上)</p>
            <p className="mt-1 text-surface-100">
              {bill.journal_entry.entry_no}(<span className="text-surface-400">{bill.journal_entry.status}</span>)
            </p>
          </div>
        )}
      </div>

      <div className="card overflow-x-auto p-5">
        <h2 className="mb-3 text-sm font-semibold text-surface-100">明細</h2>
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-2 py-2 font-medium">内容</th>
              <th className="px-2 py-2 text-right font-medium">金額</th>
            </tr>
          </thead>
          <tbody>
            {(bill.lines ?? []).map((line) => (
              <tr key={line.id} className="border-b border-surface-800/60">
                <td className="px-2 py-2 text-surface-200">{line.description}</td>
                <td className="px-2 py-2 text-right tabular-nums text-surface-200">
                  {currencyFormatter.format(line.amount ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 flex flex-col items-end gap-1 border-t border-surface-800 pt-4 text-sm">
          <div className="flex w-56 justify-between">
            <span className="text-surface-400">小計</span>
            <span className="tabular-nums text-surface-100">
              {currencyFormatter.format(bill.subtotal_amount ?? 0)}
            </span>
          </div>
          <div className="flex w-56 justify-between">
            <span className="text-surface-400">消費税</span>
            <span className="tabular-nums text-surface-100">
              {currencyFormatter.format(bill.tax_amount ?? 0)}
            </span>
          </div>
          <div className="flex w-56 justify-between text-base font-semibold">
            <span className="text-surface-200">総合計</span>
            <span className="tabular-nums text-surface-50">
              {currencyFormatter.format(bill.total_amount ?? 0)}
            </span>
          </div>
          <div className="mt-2 flex w-56 justify-between text-xs text-surface-500">
            <span>支払済み</span>
            <span className="tabular-nums">{currencyFormatter.format(totalPaid)}</span>
          </div>
          <div className="flex w-56 justify-between text-xs font-medium text-info">
            <span>残額</span>
            <span className="tabular-nums">{currencyFormatter.format(remaining)}</span>
          </div>
        </div>
      </div>

      {bill.payments.length > 0 && (
        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-surface-100">支払消込履歴</h2>
          <ul className="space-y-2 text-sm">
            {bill.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between border-b border-surface-800/60 pb-2">
                <span className="text-surface-300">{p.payment_date}</span>
                <span className="tabular-nums text-surface-100">{currencyFormatter.format(p.amount ?? 0)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {bill.approval_history.length > 0 && (
        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-surface-100">承認履歴</h2>
          <ul className="space-y-2 text-sm">
            {bill.approval_history.map((h) => (
              <li key={h.id} className="flex items-center justify-between border-b border-surface-800/60 pb-2">
                <span className="text-surface-300">
                  {h.action === 'approve' ? '承認' : '却下'} by{' '}
                  <span className="font-mono text-xs">{h.approver_id}</span>
                </span>
                <span className="text-xs text-surface-500">{h.acted_at}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(canSubmit || canRecordPayment) && (
        <div className="flex justify-end gap-3">
          {canSubmit && (
            <button
              type="button"
              className="btn-primary"
              disabled={submitMutation.isPending}
              onClick={() => submitMutation.mutate(id)}
            >
              {submitMutation.isPending ? '提出中…' : '支払申請を提出'}
            </button>
          )}
          {canRecordPayment && (
            <button type="button" className="btn-primary" onClick={() => setShowPaymentDialog(true)}>
              支払消込を登録
            </button>
          )}
        </div>
      )}

      {showPaymentDialog && (
        <PaymentDialog
          billNo={bill.bill_no ?? ''}
          remainingAmount={remaining}
          isSubmitting={paymentMutation.isPending}
          onCancel={() => setShowPaymentDialog(false)}
          onConfirm={({ paymentDate, amount }) =>
            paymentMutation.mutate(
              { id, payment_date: paymentDate, amount },
              { onSuccess: () => setShowPaymentDialog(false) },
            )
          }
        />
      )}
    </div>
  );
}
