import { ArrowLeft, Check, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../../stores/toastStore';
import { useAcceptAiSuggestion, useAiSuggestions, useRejectAiSuggestion } from '../ai-suggestions/hooks';
import type { AiSuggestion } from '../ai-suggestions/types';
import { ApproveRejectDialog } from './ApproveRejectDialog';
import { ReceiptOcrPanel, type ReceiptOcrAppliedLine } from './ReceiptOcrPanel';
import { StatusBadge } from './StatusBadge';
import {
  useAddExpenseReportLine,
  useApproveExpenseReport,
  useCreateExpenseReport,
  useExpenseCategories,
  useExpenseReport,
  useRejectExpenseReport,
} from './hooks';
import { PAYMENT_METHOD_LABEL, type ExpenseReportLineCreate, type PaymentMethod } from './types';

interface LineItemState {
  key: string;
  expense_date: string;
  category_id: string;
  amount: string;
  payment_method: PaymentMethod;
  description: string;
}

function emptyLine(): LineItemState {
  return {
    key: crypto.randomUUID(),
    expense_date: todayIso(),
    category_id: '',
    amount: '',
    payment_method: 'employee_advance',
    description: '',
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

export function ExpenseReportFormPage() {
  const { id } = useParams<{ id: string }>();
  const isCreate = !id;
  const navigate = useNavigate();
  const currentUserId = useAuthStore((state) => state.user?.id);

  if (isCreate) {
    return <CreateExpenseReportForm />;
  }
  return <ExpenseReportDetailView id={id} currentUserId={currentUserId} onNavigateBack={() => navigate('/expense-reports')} />;
}

function CreateExpenseReportForm() {
  const navigate = useNavigate();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const { data: categories = [] } = useExpenseCategories();
  const createMutation = useCreateExpenseReport();

  // OCR提案(ai_suggestions, target_type='expense_report')のtarget_idを、この申請が
  // まだ確定していない撮影段階から一貫させるため、クライアント側でUUIDを事前生成し、
  // 最終送信時にも同じidを`POST /expense-reports`へ渡す。
  const [draftReportId] = useState(() => crypto.randomUUID());
  const [purpose, setPurpose] = useState('');
  const [onBehalfOf, setOnBehalfOf] = useState<'self' | 'other'>('self');
  const [otherUserId, setOtherUserId] = useState('');
  const [lines, setLines] = useState<LineItemState[]>([emptyLine()]);

  const applyOcrResult = (ocrLine: ReceiptOcrAppliedLine): void => {
    setLines((prev) => [
      ...prev,
      {
        ...emptyLine(),
        expense_date: ocrLine.expense_date || todayIso(),
        amount: ocrLine.amount,
        description: ocrLine.description,
        category_id: ocrLine.category_id,
      },
    ]);
  };

  const totalAmount = useMemo(
    () => lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0),
    [lines],
  );

  const updateLine = (key: string, patch: Partial<LineItemState>): void => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };
  const addLine = (): void => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (key: string): void => {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  };

  const hasValidLines =
    lines.length >= 1 &&
    lines.every((l) => l.category_id && l.expense_date && Number(l.amount) > 0);

  const handleSubmit = async (): Promise<void> => {
    if (!hasValidLines) {
      toast.error('全ての明細行に日付・費目カテゴリ・金額(0より大きい値)を入力してください');
      return;
    }
    const behalfOfId = onBehalfOf === 'self' ? currentUserId : otherUserId.trim();
    if (!behalfOfId) {
      toast.error('費用帰属者(代理申請時はユーザーID)を指定してください');
      return;
    }

    const lineItems: ExpenseReportLineCreate[] = lines.map((l) => ({
      expense_date: l.expense_date,
      category_id: l.category_id,
      amount: Number(l.amount),
      payment_method: l.payment_method,
      description: l.description || undefined,
    }));

    const report = await createMutation.mutateAsync({
      id: draftReportId,
      on_behalf_of: behalfOfId,
      purpose: purpose || undefined,
      lines: lineItems,
    });
    navigate(`/expense-reports/${report.id}`, { replace: true });
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/expense-reports"
          className="mb-2 inline-flex items-center gap-1 text-sm text-surface-400 hover:text-surface-200"
        >
          <ArrowLeft className="h-4 w-4" />
          経費精算一覧へ戻る
        </Link>
        <h1 className="text-xl font-semibold text-surface-50">経費精算を申請</h1>
      </div>

      <ReceiptOcrPanel expenseReportId={draftReportId} categories={categories} onApply={applyOcrResult} />

      <div className="card space-y-4 p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">目的</label>
            <input
              type="text"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="例: 大阪出張(取引先訪問)"
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">費用帰属者</label>
            <div className="flex items-center gap-3">
              <select
                value={onBehalfOf}
                onChange={(e) => setOnBehalfOf(e.target.value as 'self' | 'other')}
                className="rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
              >
                <option value="self">自分</option>
                <option value="other">代理申請(他ユーザー)</option>
              </select>
              {onBehalfOf === 'other' && (
                <input
                  type="text"
                  value={otherUserId}
                  onChange={(e) => setOtherUserId(e.target.value)}
                  placeholder="対象ユーザーID(UUID)"
                  className="flex-1 rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="card overflow-x-auto p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-surface-100">経費明細</h2>
          <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={addLine}>
            <Plus className="h-3.5 w-3.5" />
            明細行を追加
          </button>
        </div>

        <table className="w-full min-w-[800px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-2 py-2 font-medium">日付</th>
              <th className="px-2 py-2 font-medium">費目カテゴリ</th>
              <th className="px-2 py-2 text-right font-medium">金額</th>
              <th className="px-2 py-2 font-medium">支払方法</th>
              <th className="px-2 py-2 font-medium">摘要</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key} className="border-b border-surface-800/60">
                <td className="px-2 py-2">
                  <input
                    type="date"
                    value={line.expense_date}
                    onChange={(e) => updateLine(line.key, { expense_date: e.target.value })}
                    className="rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </td>
                <td className="px-2 py-2">
                  <select
                    value={line.category_id}
                    onChange={(e) => updateLine(line.key, { category_id: e.target.value })}
                    className="w-44 rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                  >
                    <option value="">選択してください</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.code} {category.name}
                      </option>
                    ))}
                  </select>
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
                    value={line.payment_method}
                    onChange={(e) => updateLine(line.key, { payment_method: e.target.value as PaymentMethod })}
                    className="w-36 rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                  >
                    {(Object.entries(PAYMENT_METHOD_LABEL) as [PaymentMethod, string][]).map(
                      ([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                </td>
                <td className="px-2 py-2">
                  <input
                    type="text"
                    value={line.description}
                    onChange={(e) => updateLine(line.key, { description: e.target.value })}
                    className="w-40 rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                  />
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

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-surface-800 pt-4 text-sm">
          <span className="text-surface-400">合計金額</span>
          <span className="tabular-nums text-lg font-semibold text-surface-100">
            {currencyFormatter.format(totalAmount)}
          </span>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          className="btn-primary"
          disabled={!hasValidLines || createMutation.isPending}
          onClick={() => void handleSubmit()}
        >
          {createMutation.isPending ? '送信中…' : '申請する'}
        </button>
      </div>
    </div>
  );
}

function ExpenseReportDetailView({
  id,
  currentUserId,
  onNavigateBack,
}: {
  id: string;
  currentUserId: string | undefined;
  onNavigateBack: () => void;
}) {
  const { data: report, isLoading } = useExpenseReport(id);
  const { data: categories = [] } = useExpenseCategories();
  const approveMutation = useApproveExpenseReport();
  const rejectMutation = useRejectExpenseReport();
  const addLineMutation = useAddExpenseReportLine(id);
  const [dialogMode, setDialogMode] = useState<'approve' | 'reject' | null>(null);
  const [isAddingLine, setIsAddingLine] = useState(false);
  const [newLine, setNewLine] = useState<LineItemState>(emptyLine());

  const isEditableStatus = report?.status === 'submitted' || report?.status === 'in_review';
  // AI提案(勘定科目推測)。この申請がまだ承認/却下されていない間のみ、
  // 未判定の提案(target_type=expense_report_line)を取得し、明細行ごとに突き合わせる。
  const aiSuggestionsQuery = useAiSuggestions(
    { target_type: 'expense_report_line', page_size: 100 },
    { enabled: isEditableStatus },
  );
  const acceptSuggestion = useAcceptAiSuggestion();
  const rejectSuggestion = useRejectAiSuggestion();
  const suggestionByLineId = useMemo(() => {
    const map = new Map<string, AiSuggestion>();
    for (const s of aiSuggestionsQuery.data?.suggestions ?? []) {
      if (s.target_id) map.set(s.target_id, s);
    }
    return map;
  }, [aiSuggestionsQuery.data]);

  const categoryLabel = (categoryId?: string): string => {
    const category = categories.find((c) => c.id === categoryId);
    return category ? `${category.code} ${category.name}` : '—';
  };

  const applyOcrResult = (ocrLine: ReceiptOcrAppliedLine): void => {
    setNewLine({
      ...emptyLine(),
      expense_date: ocrLine.expense_date || todayIso(),
      amount: ocrLine.amount,
      description: ocrLine.description,
      category_id: ocrLine.category_id,
    });
    setIsAddingLine(true);
  };

  if (isLoading || !report) {
    return <p className="text-sm text-surface-400">読み込み中…</p>;
  }

  const canReview = report.submitted_by !== currentUserId && isEditableStatus;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button
            type="button"
            onClick={onNavigateBack}
            className="mb-2 inline-flex items-center gap-1 text-sm text-surface-400 hover:text-surface-200"
          >
            <ArrowLeft className="h-4 w-4" />
            経費精算一覧へ戻る
          </button>
          <h1 className="text-xl font-semibold text-surface-50">経費申請 {report.report_no}</h1>
        </div>
        {report.status && <StatusBadge status={report.status} />}
      </div>

      <div className="card space-y-2 p-5 text-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium text-surface-500">目的</p>
            <p className="mt-1 text-surface-100">{report.purpose || '—'}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-surface-500">申請者</p>
            <p className="mt-1 font-mono text-xs text-surface-300">{report.submitted_by}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-surface-500">費用帰属者</p>
            <p className="mt-1 font-mono text-xs text-surface-300">{report.on_behalf_of}</p>
          </div>
        </div>
        {report.journal_entry && (
          <div className="pt-2">
            <p className="text-xs font-medium text-surface-500">紐付け仕訳</p>
            <p className="mt-1 text-surface-100">
              {report.journal_entry.entry_no}(
              <span className="text-surface-400">{report.journal_entry.status}</span>)
            </p>
          </div>
        )}
      </div>

      {isEditableStatus && (
        <ReceiptOcrPanel expenseReportId={id} categories={categories} onApply={applyOcrResult} />
      )}

      <div className="card overflow-x-auto p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-surface-100">経費明細</h2>
          {isEditableStatus && !isAddingLine && (
            <button
              type="button"
              className="btn-secondary !py-1.5 text-xs"
              onClick={() => {
                setNewLine(emptyLine());
                setIsAddingLine(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              明細行を追加
            </button>
          )}
        </div>
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-2 py-2 font-medium">日付</th>
              <th className="px-2 py-2 font-medium">費目カテゴリ</th>
              <th className="px-2 py-2 text-right font-medium">金額</th>
              <th className="px-2 py-2 font-medium">支払方法</th>
              <th className="px-2 py-2 font-medium">摘要</th>
            </tr>
          </thead>
          <tbody>
            {(report.lines ?? []).map((line) => {
              const lineSuggestion = line.id ? suggestionByLineId.get(line.id) : undefined;
              return (
              <tr key={line.id} className="border-b border-surface-800/60">
                <td className="px-2 py-2 text-surface-200">{line.expense_date}</td>
                <td className="px-2 py-2 text-surface-200">
                  {categoryLabel(line.category_id)}
                  {lineSuggestion && (
                    <div className="mt-1 flex w-44 items-center gap-1 rounded-md border border-brand-500/40 bg-brand-500/10 px-1.5 py-1 text-[11px] text-brand-200">
                      <Sparkles className="h-3 w-3 shrink-0" />
                      <span
                        className="truncate"
                        title={`AI推薦: ${lineSuggestion.payload?.suggested_account_code}`}
                      >
                        AI推薦: {lineSuggestion.payload?.suggested_account_code}
                        {typeof lineSuggestion.confidence_score === 'number'
                          ? `(${Math.round(lineSuggestion.confidence_score * 100)}%)`
                          : ''}
                      </span>
                      <button
                        type="button"
                        title="この提案を採用する"
                        className="ml-auto rounded p-0.5 hover:bg-brand-500/30 disabled:opacity-50"
                        disabled={acceptSuggestion.isPending || rejectSuggestion.isPending}
                        onClick={() => acceptSuggestion.mutate(lineSuggestion.id as string)}
                      >
                        <Check className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        title="この提案を不採用にする"
                        className="rounded p-0.5 hover:bg-brand-500/30 disabled:opacity-50"
                        disabled={acceptSuggestion.isPending || rejectSuggestion.isPending}
                        onClick={() => rejectSuggestion.mutate({ id: lineSuggestion.id as string })}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-surface-200">
                  {currencyFormatter.format(line.amount ?? 0)}
                </td>
                <td className="px-2 py-2 text-surface-200">
                  {line.payment_method ? PAYMENT_METHOD_LABEL[line.payment_method] : '—'}
                </td>
                <td className="px-2 py-2 text-surface-300">{line.description || '—'}</td>
              </tr>
              );
            })}
            {isAddingLine && (
              <tr className="border-b border-surface-800/60 bg-surface-900/40">
                <td className="px-2 py-2">
                  <input
                    type="date"
                    value={newLine.expense_date}
                    onChange={(e) => setNewLine((prev) => ({ ...prev, expense_date: e.target.value }))}
                    className="rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </td>
                <td className="px-2 py-2">
                  <select
                    value={newLine.category_id}
                    onChange={(e) => setNewLine((prev) => ({ ...prev, category_id: e.target.value }))}
                    className="w-44 rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                  >
                    <option value="">選択してください</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.code} {category.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={newLine.amount}
                    onChange={(e) => setNewLine((prev) => ({ ...prev, amount: e.target.value }))}
                    className="w-28 rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-right text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </td>
                <td className="px-2 py-2">
                  <select
                    value={newLine.payment_method}
                    onChange={(e) =>
                      setNewLine((prev) => ({ ...prev, payment_method: e.target.value as PaymentMethod }))
                    }
                    className="w-36 rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                  >
                    {(Object.entries(PAYMENT_METHOD_LABEL) as [PaymentMethod, string][]).map(
                      ([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newLine.description}
                      onChange={(e) => setNewLine((prev) => ({ ...prev, description: e.target.value }))}
                      className="w-32 rounded-md border border-surface-700 bg-surface-850 px-2 py-1.5 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                    />
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-positive transition-colors hover:bg-positive-subtle disabled:cursor-not-allowed disabled:opacity-30"
                      title="この明細を追加"
                      disabled={
                        addLineMutation.isPending ||
                        !newLine.category_id ||
                        !newLine.expense_date ||
                        !(Number(newLine.amount) > 0)
                      }
                      onClick={() =>
                        addLineMutation.mutate(
                          {
                            expense_date: newLine.expense_date,
                            category_id: newLine.category_id,
                            amount: Number(newLine.amount),
                            payment_method: newLine.payment_method,
                            description: newLine.description || undefined,
                          },
                          { onSuccess: () => setIsAddingLine(false) },
                        )
                      }
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-negative transition-colors hover:bg-negative-subtle"
                      title="キャンセル"
                      onClick={() => setIsAddingLine(false)}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="mt-4 flex items-center justify-end gap-2 border-t border-surface-800 pt-4 text-sm">
          <span className="text-surface-400">合計金額</span>
          <span className="tabular-nums text-lg font-semibold text-surface-100">
            {currencyFormatter.format(report.total_amount ?? 0)}
          </span>
        </div>
      </div>

      {report.approval_history.length > 0 && (
        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-surface-100">承認履歴</h2>
          <ul className="space-y-2 text-sm">
            {report.approval_history.map((h) => (
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

      {canReview && (
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={() => setDialogMode('reject')}>
            却下
          </button>
          <button type="button" className="btn-primary" onClick={() => setDialogMode('approve')}>
            承認
          </button>
        </div>
      )}

      {dialogMode && (
        <ApproveRejectDialog
          mode={dialogMode}
          reportNo={report.report_no ?? ''}
          isSubmitting={approveMutation.isPending || rejectMutation.isPending}
          onCancel={() => setDialogMode(null)}
          onConfirm={(comment) => {
            if (dialogMode === 'approve') {
              approveMutation.mutate(
                { id, comment: comment || undefined },
                { onSuccess: () => setDialogMode(null) },
              );
            } else {
              rejectMutation.mutate({ id, comment }, { onSuccess: () => setDialogMode(null) });
            }
          }}
        />
      )}
    </div>
  );
}
