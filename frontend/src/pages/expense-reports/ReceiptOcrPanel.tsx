import { Camera, Check, CheckCheck, Sparkles, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useAcceptAiSuggestion } from '../ai-suggestions/hooks';
import { useExtractExpenseReportOcr } from './hooks';
import type { ExpenseCategory, ExpenseReportOcrSuggestion, ExpenseReportOcrSuggestionData } from './types';

export interface ReceiptOcrAppliedLine {
  expense_date: string;
  amount: string;
  description: string;
  category_id: string;
}

interface ReceiptOcrPanelProps {
  /**
   * 既存申請への明細追加時はその申請id、新規申請作成中はフロントエンドが事前生成した
   * UUID(最終的に`POST /expense-reports`の`id`としても送信される)を指定する。
   */
  expenseReportId: string;
  categories: ExpenseCategory[];
  onApply: (line: ReceiptOcrAppliedLine) => void;
}

const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

function buildDescription(data: ExpenseReportOcrSuggestionData): string {
  if (!data.vendor_name) return '';
  return data.invoice_registration_number
    ? `${data.vendor_name}(T番号: ${data.invoice_registration_number})`
    : data.vendor_name;
}

/**
 * ReceiptOcrPanel
 * ================
 * 1回のアップロードで複数のレシート・領収書が検出されるケースに対応する。
 * `POST /expense-reports/ocr`は検出した数だけ`suggestions`配列を返し(`ai_suggestions`にも
 * その数だけ個別に追記保存済み)、この画面ではそれぞれをカードとして一覧表示する。
 * 各カードの「この明細を追加」で個別に、画面上部の「すべての明細を一括追加」で全件まとめて
 * フォームへ反映できる。
 */
export function ReceiptOcrPanel({ expenseReportId, categories, onApply }: ReceiptOcrPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // null = まだOCRを実行していない。[] = 実行したが検出0件。それ以外 = 検出件数ぶんの提案。
  const [suggestions, setSuggestions] = useState<ExpenseReportOcrSuggestion[] | null>(null);
  const ocrMutation = useExtractExpenseReportOcr();
  const acceptSuggestion = useAcceptAiSuggestion();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setSuggestions(null);
    ocrMutation.mutate(
      { file, expenseReportId },
      { onSuccess: (data) => setSuggestions(data.suggestions) },
    );
  };

  const applyOne = (suggestion: ExpenseReportOcrSuggestion): void => {
    const category = categories.find((c) => c.default_account_id === suggestion.data.suggested_account_id);
    onApply({
      expense_date: suggestion.data.transaction_date ?? '',
      amount: suggestion.data.amount != null ? String(suggestion.data.amount) : '',
      description: buildDescription(suggestion.data),
      category_id: category?.id ?? '',
    });
    acceptSuggestion.mutate(suggestion.id);
  };

  // カードが1件も残らなくなったら`null`(未実行状態)に戻す。`[]`のままだと
  // 「レシートを検出できませんでした」という空状態メッセージと区別が付かなくなるため。
  const removeSuggestion = (suggestionId: string): void => {
    setSuggestions((prev) => {
      const next = (prev ?? []).filter((s) => s.id !== suggestionId);
      return next.length > 0 ? next : null;
    });
  };

  const handleApplyOne = (suggestion: ExpenseReportOcrSuggestion): void => {
    applyOne(suggestion);
    removeSuggestion(suggestion.id);
  };

  const handleApplyAll = (): void => {
    (suggestions ?? []).forEach(applyOne);
    setSuggestions(null);
  };

  const handleDiscardOne = (suggestionId: string): void => {
    removeSuggestion(suggestionId);
  };

  const hasSuggestions = suggestions !== null && suggestions.length > 0;
  const foundNothing = suggestions !== null && suggestions.length === 0;

  return (
    <div className="rounded-lg border border-dashed border-surface-700 bg-surface-900/40 p-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={ocrMutation.isPending}
        className="btn-secondary w-full !py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Camera className="h-4 w-4" />
        領収書を撮影/アップロードして自動入力
      </button>

      {ocrMutation.isPending && (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-800">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-brand-400" />
          </div>
          <p className="mt-1.5 text-xs text-surface-400">AIが領収書を解析しています…</p>
        </div>
      )}

      {foundNothing && !ocrMutation.isPending && (
        <p className="mt-3 text-xs text-surface-400">
          レシート・領収書を検出できませんでした。別の画像でお試しください。
        </p>
      )}

      {hasSuggestions && !ocrMutation.isPending && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-medium text-brand-200">
              <Sparkles className="h-3.5 w-3.5" />
              {suggestions.length}件のレシートを検出しました
            </div>
            <button
              type="button"
              className="btn-secondary !py-1 text-xs"
              onClick={handleApplyAll}
              disabled={acceptSuggestion.isPending}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              すべての明細を一括追加
            </button>
          </div>

          {suggestions.map((suggestion) => (
            <div
              key={suggestion.id}
              className="rounded-lg border border-brand-500/40 bg-brand-500/10 p-3 text-sm"
            >
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-brand-200">
                <Sparkles className="h-3.5 w-3.5" />
                AI提案(レシートOCR抽出結果)
                {typeof suggestion.data.confidence_score === 'number' && (
                  <span className="text-brand-300/80">
                    {Math.round(suggestion.data.confidence_score * 100)}%
                  </span>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-surface-200">
                <dt className="text-surface-400">日付</dt>
                <dd>{suggestion.data.transaction_date ?? '読み取れませんでした'}</dd>
                <dt className="text-surface-400">金額</dt>
                <dd>
                  {suggestion.data.amount != null
                    ? currencyFormatter.format(suggestion.data.amount)
                    : '読み取れませんでした'}
                </dd>
                <dt className="text-surface-400">支払先</dt>
                <dd>{suggestion.data.vendor_name ?? '読み取れませんでした'}</dd>
                <dt className="text-surface-400">T番号(インボイス)</dt>
                <dd>{suggestion.data.invoice_registration_number ?? '記載なし'}</dd>
              </dl>
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="rounded-md p-1.5 text-surface-400 transition-colors hover:bg-surface-800"
                  title="この提案を破棄する"
                  onClick={() => handleDiscardOne(suggestion.id)}
                >
                  <X className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="btn-primary !py-1.5 text-xs"
                  onClick={() => handleApplyOne(suggestion)}
                  disabled={acceptSuggestion.isPending}
                >
                  <Check className="h-3.5 w-3.5" />
                  この明細を追加
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
