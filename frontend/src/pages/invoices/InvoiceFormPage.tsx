import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Modal } from '../../components/ui/Modal';
import { toast } from '../../stores/toastStore';
import { CreditNoteDialog } from './CreditNoteDialog';
import { PaymentDialog } from './PaymentDialog';
import { StatusBadge } from './StatusBadge';
import {
  useAccounts,
  useCreateCreditNote,
  useCreateInvoice,
  useCustomers,
  useInvoice,
  useIssueInvoice,
  useRecordInvoicePayment,
  useTaxCategories,
  useUpdateInvoice,
  useVoidInvoice,
} from './hooks';
import type { InvoiceLineCreate } from './types';

const VOID_WINDOW_MS = 24 * 60 * 60 * 1000;

interface LineItemState {
  key: string;
  description: string;
  quantity: string;
  unit_price: string;
  tax_category_id: string;
  account_id: string;
}

function emptyLine(): LineItemState {
  return {
    key: crypto.randomUUID(),
    description: '',
    quantity: '1',
    unit_price: '',
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
  const lineAmounts = lines.map((l) => (Number(l.quantity) || 0) * (Number(l.unit_price) || 0));
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

export function InvoiceFormPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) {
    return <CreateInvoiceForm />;
  }
  return <InvoiceDetailView id={id} />;
}

function CreateInvoiceForm() {
  const navigate = useNavigate();
  const { data: customers = [] } = useCustomers();
  const { data: accounts = [] } = useAccounts();
  const { data: taxCategories = [] } = useTaxCategories();
  const createMutation = useCreateInvoice();

  const [customerId, setCustomerId] = useState('');
  const [issueDate, setIssueDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState(todayIso());
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
    lines.every((l) => l.description && l.tax_category_id && l.account_id && Number(l.unit_price) > 0);

  const buildLinePayload = (): InvoiceLineCreate[] =>
    lines.map((l) => ({
      description: l.description,
      quantity: Number(l.quantity) || 1,
      unit_price: Number(l.unit_price),
      tax_category_id: l.tax_category_id,
      account_id: l.account_id,
    }));

  const handleSubmit = async (): Promise<void> => {
    if (!customerId) {
      toast.error('顧客を選択してください');
      return;
    }
    if (dueDate < issueDate) {
      toast.error('支払期日は発行日以降の日付を指定してください');
      return;
    }
    if (!hasValidLines) {
      toast.error('全ての明細行に品名・単価・税区分・売上科目を入力してください');
      return;
    }
    const invoice = await createMutation.mutateAsync({
      customer_id: customerId,
      issue_date: issueDate,
      due_date: dueDate,
      currency_code: 'JPY',
      lines: buildLinePayload(),
    });
    navigate(`/invoices/${invoice.id}`, { replace: true });
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/invoices"
          className="mb-2 inline-flex items-center gap-1 text-sm text-surface-400 hover:text-surface-200"
        >
          <ArrowLeft className="h-4 w-4" />
          請求書一覧へ戻る
        </Link>
        <h1 className="text-xl font-semibold text-surface-50">請求書を新規作成</h1>
      </div>

      <div className="card space-y-4 p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">顧客</label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            >
              <option value="">選択してください</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">発行日</label>
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
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
              <th className="px-2 py-2 font-medium">品名</th>
              <th className="px-2 py-2 text-right font-medium">数量</th>
              <th className="px-2 py-2 text-right font-medium">単価</th>
              <th className="px-2 py-2 font-medium">税区分</th>
              <th className="px-2 py-2 font-medium">売上科目</th>
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
                    className="w-48 rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={line.quantity}
                    onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                    className="w-20 rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-right text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={line.unit_price}
                    onChange={(e) => updateLine(line.key, { unit_price: e.target.value })}
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

function InvoiceDetailView({ id }: { id: string }) {
  const navigate = useNavigate();
  const { data: invoice, isLoading } = useInvoice(id);
  const { data: customers = [] } = useCustomers();
  const { data: accounts = [] } = useAccounts();
  const { data: taxCategories = [] } = useTaxCategories();
  const updateMutation = useUpdateInvoice(id);
  const issueMutation = useIssueInvoice();
  const paymentMutation = useRecordInvoicePayment();
  const creditNoteMutation = useCreateCreditNote();
  const voidMutation = useVoidInvoice();

  const [dialogMode, setDialogMode] = useState<'payment' | 'credit-note' | 'void' | null>(null);
  const [lines, setLines] = useState<LineItemState[] | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [dueDate, setDueDate] = useState('');

  const taxRateByCategory = useMemo(
    () => new Map(taxCategories.map((t) => [t.id as string, t.tax_rate ?? 0])),
    [taxCategories],
  );

  const isDraft = invoice?.status === 'draft';

  useEffect(() => {
    if (!invoice || !isDraft || lines !== null) return;
    setCustomerId(invoice.customer_id ?? '');
    setIssueDate(invoice.issue_date ?? todayIso());
    setDueDate(invoice.due_date ?? todayIso());
    setLines(
      (invoice.lines ?? []).map((line) => ({
        key: line.id ?? crypto.randomUUID(),
        description: line.description ?? '',
        quantity: String(line.quantity ?? 1),
        unit_price: line.unit_price !== undefined ? String(line.unit_price) : '',
        tax_category_id: line.tax_category_id ?? '',
        account_id: line.account_id ?? '',
      })),
    );
  }, [invoice, isDraft, lines]);

  if (isLoading || !invoice) {
    return <p className="text-sm text-surface-400">読み込み中…</p>;
  }

  const customerName = customers.find((c) => c.id === invoice.customer_id)?.name ?? '—';
  const totalPaid = invoice.payments.reduce((sum, p) => sum + (p.amount ?? 0), 0);
  const totalCredited = invoice.credit_notes.reduce((sum, c) => sum + (c.amount ?? 0), 0);
  const remaining = Math.max((invoice.total_amount ?? 0) - totalPaid - totalCredited, 0);

  const canRecordPayment = invoice.status === 'issued' || invoice.status === 'partially_paid';
  const canCreateCreditNote =
    invoice.status === 'issued' || invoice.status === 'partially_paid' || invoice.status === 'paid';
  const canVoid =
    invoice.status === 'issued' &&
    invoice.payments.length === 0 &&
    invoice.credit_notes.length === 0 &&
    Boolean(invoice.issued_at) &&
    Date.now() - new Date(invoice.issued_at as string).getTime() <= VOID_WINDOW_MS;

  const updateLine = (key: string, patch: Partial<LineItemState>): void => {
    setLines((prev) => (prev ? prev.map((l) => (l.key === key ? { ...l, ...patch } : l)) : prev));
  };
  const addLine = (): void => setLines((prev) => (prev ? [...prev, emptyLine()] : prev));
  const removeLine = (key: string): void => {
    setLines((prev) => (prev && prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  };

  const handleSaveDraft = async (): Promise<void> => {
    if (!lines) return;
    if (!customerId) {
      toast.error('顧客を選択してください');
      return;
    }
    if (!lines.every((l) => l.description && l.tax_category_id && l.account_id && Number(l.unit_price) > 0)) {
      toast.error('全ての明細行に品名・単価・税区分・売上科目を入力してください');
      return;
    }
    await updateMutation.mutateAsync({
      customer_id: customerId,
      issue_date: issueDate,
      due_date: dueDate,
      currency_code: 'JPY',
      lines: lines.map((l) => ({
        description: l.description,
        quantity: Number(l.quantity) || 1,
        unit_price: Number(l.unit_price),
        tax_category_id: l.tax_category_id,
        account_id: l.account_id,
      })),
    });
  };

  const handleIssue = async (): Promise<void> => {
    await handleSaveDraft();
    await issueMutation.mutateAsync(id);
  };

  const totals =
    isDraft && lines ? computeTotals(lines, taxRateByCategory) : { subtotal: invoice.subtotal_amount ?? 0, tax: invoice.tax_amount ?? 0, total: invoice.total_amount ?? 0 };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button
            type="button"
            onClick={() => navigate('/invoices')}
            className="mb-2 inline-flex items-center gap-1 text-sm text-surface-400 hover:text-surface-200"
          >
            <ArrowLeft className="h-4 w-4" />
            請求書一覧へ戻る
          </button>
          <h1 className="text-xl font-semibold text-surface-50">請求書 {invoice.invoice_no}</h1>
        </div>
        {invoice.status && <StatusBadge status={invoice.status} />}
      </div>

      {isDraft && lines ? (
        <>
          <div className="card space-y-4 p-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-surface-400">顧客</label>
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                >
                  <option value="">選択してください</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-surface-400">発行日</label>
                <input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
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
                  <th className="px-2 py-2 font-medium">品名</th>
                  <th className="px-2 py-2 text-right font-medium">数量</th>
                  <th className="px-2 py-2 text-right font-medium">単価</th>
                  <th className="px-2 py-2 font-medium">税区分</th>
                  <th className="px-2 py-2 font-medium">売上科目</th>
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
                        className="w-48 rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={line.quantity}
                        onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                        className="w-20 rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-right text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={line.unit_price}
                        onChange={(e) => updateLine(line.key, { unit_price: e.target.value })}
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

          <div className="flex justify-end gap-3">
            <button
              type="button"
              className="btn-secondary"
              disabled={updateMutation.isPending}
              onClick={() => void handleSaveDraft()}
            >
              下書き保存
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={updateMutation.isPending || issueMutation.isPending}
              onClick={() => void handleIssue()}
            >
              発行する
            </button>
          </div>
        </>
      ) : (
        <>
          {/* issued以降は改変不可のプレビュー(請求書形式レイアウト) */}
          <div className="card p-8">
            <div className="mb-8 flex items-start justify-between border-b border-surface-800 pb-6">
              <div>
                <h2 className="text-2xl font-semibold text-surface-50">請求書</h2>
                <p className="mt-1 font-mono text-sm text-surface-400">{invoice.invoice_no}</p>
              </div>
              <div className="text-right text-sm text-surface-300">
                <p>発行日: {invoice.issue_date}</p>
                <p>支払期日: {invoice.due_date}</p>
              </div>
            </div>

            <div className="mb-6">
              <p className="text-xs font-medium text-surface-500">請求先</p>
              <p className="mt-1 text-lg text-surface-100">{customerName} 御中</p>
            </div>

            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
                  <th className="py-2 font-medium">品名</th>
                  <th className="py-2 text-right font-medium">数量</th>
                  <th className="py-2 text-right font-medium">単価</th>
                  <th className="py-2 text-right font-medium">金額</th>
                </tr>
              </thead>
              <tbody>
                {(invoice.lines ?? []).map((line) => (
                  <tr key={line.id} className="border-b border-surface-800/60">
                    <td className="py-2 text-surface-200">{line.description}</td>
                    <td className="py-2 text-right tabular-nums text-surface-300">{line.quantity}</td>
                    <td className="py-2 text-right tabular-nums text-surface-300">
                      {currencyFormatter.format(line.unit_price ?? 0)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-surface-100">
                      {currencyFormatter.format(line.amount ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-4 flex flex-col items-end gap-1 text-sm">
              <div className="flex w-56 justify-between">
                <span className="text-surface-400">小計</span>
                <span className="tabular-nums text-surface-100">
                  {currencyFormatter.format(invoice.subtotal_amount ?? 0)}
                </span>
              </div>
              <div className="flex w-56 justify-between">
                <span className="text-surface-400">消費税</span>
                <span className="tabular-nums text-surface-100">
                  {currencyFormatter.format(invoice.tax_amount ?? 0)}
                </span>
              </div>
              <div className="flex w-56 justify-between border-t border-surface-800 pt-1 text-base font-semibold">
                <span className="text-surface-200">総合計</span>
                <span className="tabular-nums text-surface-50">
                  {currencyFormatter.format(invoice.total_amount ?? 0)}
                </span>
              </div>
              <div className="mt-2 flex w-56 justify-between text-xs text-surface-500">
                <span>入金済み</span>
                <span className="tabular-nums">{currencyFormatter.format(totalPaid)}</span>
              </div>
              {totalCredited > 0 && (
                <div className="flex w-56 justify-between text-xs text-surface-500">
                  <span>クレジットノート合計</span>
                  <span className="tabular-nums">{currencyFormatter.format(totalCredited)}</span>
                </div>
              )}
              <div className="flex w-56 justify-between text-xs font-medium text-info">
                <span>残額</span>
                <span className="tabular-nums">{currencyFormatter.format(remaining)}</span>
              </div>
            </div>

            {invoice.journal_entry && (
              <p className="mt-6 text-xs text-surface-500">
                紐付け仕訳: {invoice.journal_entry.entry_no}({invoice.journal_entry.status})
              </p>
            )}
          </div>

          {invoice.payments.length > 0 && (
            <div className="card p-5">
              <h2 className="mb-3 text-sm font-semibold text-surface-100">入金消込履歴</h2>
              <ul className="space-y-2 text-sm">
                {invoice.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between border-b border-surface-800/60 pb-2">
                    <span className="text-surface-300">{p.payment_date}</span>
                    <span className="tabular-nums text-surface-100">{currencyFormatter.format(p.amount ?? 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {invoice.credit_notes.length > 0 && (
            <div className="card p-5">
              <h2 className="mb-3 text-sm font-semibold text-surface-100">クレジットノート履歴</h2>
              <ul className="space-y-2 text-sm">
                {invoice.credit_notes.map((c) => (
                  <li key={c.id} className="flex items-center justify-between border-b border-surface-800/60 pb-2">
                    <span className="text-surface-300">
                      {c.credit_note_no}({c.reason})
                    </span>
                    <span className="tabular-nums text-surface-100">{currencyFormatter.format(c.amount ?? 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(canRecordPayment || canCreateCreditNote || canVoid) && (
            <div className="flex justify-end gap-3">
              {canVoid && (
                <button type="button" className="btn-secondary" onClick={() => setDialogMode('void')}>
                  請求書を取消す(Void)
                </button>
              )}
              {canCreateCreditNote && (
                <button type="button" className="btn-secondary" onClick={() => setDialogMode('credit-note')}>
                  クレジットノート起票
                </button>
              )}
              {canRecordPayment && (
                <button type="button" className="btn-primary" onClick={() => setDialogMode('payment')}>
                  入金消込を登録
                </button>
              )}
            </div>
          )}
        </>
      )}

      {dialogMode === 'payment' && (
        <PaymentDialog
          invoiceNo={invoice.invoice_no ?? ''}
          remainingAmount={remaining}
          isSubmitting={paymentMutation.isPending}
          onCancel={() => setDialogMode(null)}
          onConfirm={({ paymentDate, amount }) =>
            paymentMutation.mutate(
              { id, payment_date: paymentDate, amount },
              { onSuccess: () => setDialogMode(null) },
            )
          }
        />
      )}

      {dialogMode === 'void' && (
        <Modal title="請求書を取消す" onClose={() => setDialogMode(null)}>
          <p className="mb-4 text-sm text-surface-400">
            請求書 <span className="font-mono text-surface-200">{invoice.invoice_no}</span> を取消します。
            売上計上仕訳は無効化(void)され、この操作は取り消せません。よろしいですか?
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={voidMutation.isPending}
              onClick={() => setDialogMode(null)}
            >
              キャンセル
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={voidMutation.isPending}
              onClick={() => voidMutation.mutate(id, { onSuccess: () => setDialogMode(null) })}
            >
              {voidMutation.isPending ? '処理中…' : '取消する'}
            </button>
          </div>
        </Modal>
      )}

      {dialogMode === 'credit-note' && (
        <CreditNoteDialog
          invoiceNo={invoice.invoice_no ?? ''}
          maxAmount={remaining}
          isSubmitting={creditNoteMutation.isPending}
          onCancel={() => setDialogMode(null)}
          onConfirm={({ amount, reason }) =>
            creditNoteMutation.mutate({ id, amount, reason }, { onSuccess: () => setDialogMode(null) })
          }
        />
      )}
    </div>
  );
}
