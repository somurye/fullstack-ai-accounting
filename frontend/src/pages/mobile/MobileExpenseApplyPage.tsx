import { AlertTriangle, Camera, Check, History, Loader2, Receipt, RefreshCw, Sparkles, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { useAuthStore } from '../../stores/authStore';
import { useAcceptAiSuggestion } from '../ai-suggestions/hooks';
import { useLinkAttachment, useUploadAttachment } from '../attachments/hooks';
import { useCreateExpenseReport, useExpenseCategories, useExtractExpenseReportOcr } from '../expense-reports/hooks';
import type { ExpenseReportOcrSuggestionData } from '../expense-reports/types';

type WizardStep = 'start' | 'capture' | 'review' | 'confirm' | 'done';

interface FormState {
  transaction_date: string;
  amount: string;
  vendor_name: string;
  category_id: string;
  description: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(): FormState {
  return { transaction_date: todayIso(), amount: '', vendor_name: '', category_id: '', description: '' };
}

function buildDescription(data: ExpenseReportOcrSuggestionData): string {
  if (!data.vendor_name) return '';
  return data.invoice_registration_number
    ? `${data.vendor_name}(T番号: ${data.invoice_registration_number})`
    : data.vendor_name;
}

/** `navigator.onLine`をReact状態として追跡する(オフライン時に送信系ボタンを無効化するため) */
function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  return online;
}

const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

/**
 * MobileExpenseApplyPage
 * =======================
 * 一般社員がスマホでレシートを撮影し、その場でAI解析(既存の`POST /expense-reports/ocr`,
 * `receipt-ocr-extraction.service.ts`のVision AI OCR)→内容確認→申請確定までを
 * 1画面のステップウィザードで完結させる。
 *
 * PC版(`ExpenseReportFormPage`)との違い:
 *   - 1回の申請=1枚のレシート(明細行1件)に限定し、複数レシート検出時も最初の1件のみ使う
 *     (複数枚の一括処理はPC版の役割とし、スマホでは「1枚撮って即申請」の速さを優先する)。
 *   - 証憑ファイルは電帳法対応の`POST /attachments`へ実体を保存し、
 *     `POST /attachments/:id/links`で作成した経費申請明細(`expense_report_line`)に
 *     紐付ける(PC版のOCRパネルはAI提案の生成のみでファイル自体は保存しない)。
 *   - この3ステップ(証憑保存→申請作成→紐付け)はDBトランザクションで一括化されて
 *     いない(`/v1/expense-applications`のような統合APIは存在しないため、既存の
 *     `/attachments`・`/expense-reports`・`/attachments/:id/links`を順に呼び出す)。
 *     途中失敗時に再送信すると、既に成功したステップの結果(`attachmentId`/`createdReport`)
 *     を再利用し、失敗した箇所からのみ再試行する。
 */
export function MobileExpenseApplyPage() {
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const currentUserId = useAuthStore((state) => state.user?.id);

  const [step, setStep] = useState<WizardStep>('start');
  const [draftReportId, setDraftReportId] = useState(() => crypto.randomUUID());
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [ocrSuggestionId, setOcrSuggestionId] = useState<string | null>(null);
  const [ocrDetectedNothing, setOcrDetectedNothing] = useState(false);
  const [attachmentId, setAttachmentId] = useState<string | null>(null);
  const [createdReportNo, setCreatedReportNo] = useState<string | null>(null);
  const [createdLineId, setCreatedLineId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: categories = [] } = useExpenseCategories();
  const ocrMutation = useExtractExpenseReportOcr();
  const acceptSuggestion = useAcceptAiSuggestion();
  const uploadAttachmentMutation = useUploadAttachment();
  const linkAttachmentMutation = useLinkAttachment();
  const createReportMutation = useCreateExpenseReport();

  // 選択済みファイルが変わるたびobject URLを作り直し、直前のURLは解放する(メモリリーク防止)。
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const resetWizard = (next: 'start' | 'capture'): void => {
    setFile(null);
    setForm(emptyForm());
    setOcrSuggestionId(null);
    setOcrDetectedNothing(false);
    setAttachmentId(null);
    setCreatedReportNo(null);
    setCreatedLineId(null);
    setSubmitError(null);
    setDraftReportId(crypto.randomUUID());
    setStep(next);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const selected = e.target.files?.[0];
    e.target.value = '';
    if (!selected) return;
    setFile(selected);
    setOcrDetectedNothing(false);
  };

  const runOcr = async (): Promise<void> => {
    if (!file) return;
    setStep('review');
    setOcrDetectedNothing(false);
    try {
      const result = await ocrMutation.mutateAsync({ file, expenseReportId: draftReportId });
      const suggestion = result.suggestions[0];
      if (!suggestion) {
        setOcrDetectedNothing(true);
        return;
      }
      const category = categories.find((c) => c.default_account_id === suggestion.data.suggested_account_id);
      setForm({
        transaction_date: suggestion.data.transaction_date ?? todayIso(),
        amount: suggestion.data.amount != null ? String(suggestion.data.amount) : '',
        vendor_name: suggestion.data.vendor_name ?? '',
        category_id: category?.id ?? '',
        description: buildDescription(suggestion.data),
      });
      setOcrSuggestionId(suggestion.id as string);
    } catch {
      // ocrMutationのonErrorで既にtoast表示済み。撮影ステップへ戻して再撮影/再試行できるようにする。
      setStep('capture');
    }
  };

  const hasValidForm =
    Boolean(form.transaction_date) &&
    Number(form.amount) > 0 &&
    Boolean(form.category_id) &&
    form.vendor_name.trim().length > 0;

  const handleSubmit = async (): Promise<void> => {
    if (!currentUserId) {
      setSubmitError('ユーザー情報を取得できませんでした。再ログインしてください');
      return;
    }
    setSubmitError(null);
    try {
      let attId = attachmentId;
      if (!attId) {
        if (!file) throw new Error('レシート画像が選択されていません');
        const attachment = await uploadAttachmentMutation.mutateAsync({
          file,
          transaction_date: form.transaction_date,
          amount: Number(form.amount),
          counterparty_name: form.vendor_name,
        });
        attId = attachment.id as string;
        setAttachmentId(attId);
      }

      let lineId = createdLineId;
      if (!lineId) {
        const report = await createReportMutation.mutateAsync({
          id: draftReportId,
          on_behalf_of: currentUserId,
          purpose: form.description || form.vendor_name || undefined,
          lines: [
            {
              expense_date: form.transaction_date,
              category_id: form.category_id,
              amount: Number(form.amount),
              payment_method: 'employee_advance',
              description: form.description || undefined,
            },
          ],
        });
        lineId = report.lines?.[0]?.id ?? null;
        setCreatedReportNo(report.report_no ?? null);
        setCreatedLineId(lineId);
      }

      if (attId && lineId) {
        await linkAttachmentMutation.mutateAsync({
          attachmentId: attId,
          linkableType: 'expense_report_line',
          linkableId: lineId,
        });
      }

      if (ocrSuggestionId) {
        acceptSuggestion.mutate(ocrSuggestionId);
      }
      setStep('done');
    } catch (error) {
      setSubmitError(formatApiErrorMessage(error));
    }
  };

  const isSubmitting =
    uploadAttachmentMutation.isPending || createReportMutation.isPending || linkAttachmentMutation.isPending;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 pb-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      {!online && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-subtle px-3 py-2 text-xs text-warning">
          <WifiOff className="h-4 w-4 shrink-0" />
          オフラインです。通信状態を確認してから操作してください。
        </div>
      )}

      {step === 'start' && (
        <div className="flex flex-col items-center gap-6 pt-12 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-600/15">
            <Receipt className="h-10 w-10 text-brand-300" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-surface-50">経費申請</h1>
            <p className="mt-1 text-sm text-surface-400">レシートを撮影するだけで、AIが内容を読み取って申請書を作成します</p>
          </div>
          <button
            type="button"
            className="btn-primary min-h-[56px] w-full justify-center text-base"
            onClick={() => setStep('capture')}
          >
            <Camera className="h-5 w-5" />
            経費申請を作成する
          </button>
          <button
            type="button"
            className="flex min-h-[48px] items-center gap-1.5 text-sm text-surface-400 hover:text-surface-200"
            onClick={() => navigate('/mobile/my-applications')}
          >
            <History className="h-4 w-4" />
            過去の申請履歴を見る
          </button>
        </div>
      )}

      {step === 'capture' && (
        <div className="flex flex-col gap-4">
          <h1 className="text-base font-semibold text-surface-50">レシートを撮影</h1>

          {!previewUrl ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-xl2 border-2 border-dashed border-surface-700 bg-surface-900/40 text-surface-400 transition-colors hover:border-brand-500/60 hover:text-brand-300"
            >
              <Camera className="h-12 w-12" />
              <span className="text-sm font-medium">タップして撮影 / 画像を選択</span>
            </button>
          ) : (
            <div className="space-y-3">
              <div className="overflow-hidden rounded-xl2 border border-surface-800 bg-surface-950">
                <img src={previewUrl} alt="レシートプレビュー" className="max-h-[50vh] w-full object-contain" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className="btn-secondary min-h-[48px] justify-center"
                  onClick={() => fileInputRef.current?.click()}
                >
                  撮り直す
                </button>
                <button
                  type="button"
                  className="btn-primary min-h-[48px] justify-center"
                  disabled={!online}
                  onClick={() => void runOcr()}
                >
                  <Sparkles className="h-4 w-4" />
                  この画像でAI解析する
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 'review' && (
        <div className="flex flex-col gap-4">
          {ocrMutation.isPending ? (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <Loader2 className="h-10 w-10 animate-spin text-brand-400" />
              <p className="text-sm text-surface-300">レシートをAI解析中…</p>
            </div>
          ) : (
            <>
              <h1 className="text-base font-semibold text-surface-50">申請内容の確認</h1>
              {ocrDetectedNothing && (
                <div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-subtle px-3 py-2 text-xs text-warning">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  レシートを検出できませんでした。内容を手動で入力するか、別の画像でお試しください。
                </div>
              )}
              {previewUrl && (
                <div className="overflow-hidden rounded-xl2 border border-surface-800 bg-surface-950">
                  <img src={previewUrl} alt="レシートプレビュー" className="max-h-40 w-full object-contain" />
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-surface-400">支払日</label>
                  <input
                    type="date"
                    value={form.transaction_date}
                    onChange={(e) => setForm((prev) => ({ ...prev, transaction_date: e.target.value }))}
                    className="w-full min-h-[48px] rounded-lg border border-surface-700 bg-surface-850 px-3 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-surface-400">金額(税込)</label>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={form.amount}
                    onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                    className="w-full min-h-[48px] rounded-lg border border-surface-700 bg-surface-850 px-3 text-right text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-surface-400">取引先</label>
                  <input
                    type="text"
                    value={form.vendor_name}
                    onChange={(e) => setForm((prev) => ({ ...prev, vendor_name: e.target.value }))}
                    placeholder="例: 株式会社サンプル"
                    className="w-full min-h-[48px] rounded-lg border border-surface-700 bg-surface-850 px-3 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-surface-400">経費科目</label>
                  <select
                    value={form.category_id}
                    onChange={(e) => setForm((prev) => ({ ...prev, category_id: e.target.value }))}
                    className="w-full min-h-[48px] rounded-lg border border-surface-700 bg-surface-850 px-3 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                  >
                    <option value="">選択してください</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-surface-400">備考・用途メモ</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                    rows={2}
                    placeholder="例: 取引先訪問の交通費"
                    className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button type="button" className="btn-secondary min-h-[48px] justify-center" onClick={() => setStep('capture')}>
                  撮り直す
                </button>
                <button
                  type="button"
                  className="btn-primary min-h-[48px] justify-center"
                  disabled={!hasValidForm}
                  onClick={() => setStep('confirm')}
                >
                  確認画面へ
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {step === 'confirm' && (
        <div className="flex flex-col gap-4">
          <h1 className="text-base font-semibold text-surface-50">最終確認</h1>

          {previewUrl && (
            <div className="overflow-hidden rounded-xl2 border border-surface-800 bg-surface-950">
              <img src={previewUrl} alt="レシートプレビュー" className="max-h-48 w-full object-contain" />
            </div>
          )}

          <dl className="card grid grid-cols-2 gap-x-3 gap-y-3 p-4 text-sm">
            <dt className="text-surface-500">支払日</dt>
            <dd className="text-right text-surface-100">{form.transaction_date}</dd>
            <dt className="text-surface-500">金額</dt>
            <dd className="text-right font-semibold text-surface-100">{currencyFormatter.format(Number(form.amount) || 0)}</dd>
            <dt className="text-surface-500">取引先</dt>
            <dd className="text-right text-surface-100">{form.vendor_name}</dd>
            <dt className="text-surface-500">経費科目</dt>
            <dd className="text-right text-surface-100">
              {categories.find((c) => c.id === form.category_id)?.name ?? '—'}
            </dd>
            {form.description && (
              <>
                <dt className="text-surface-500">備考</dt>
                <dd className="text-right text-surface-100">{form.description}</dd>
              </>
            )}
          </dl>

          {submitError && (
            <div className="flex items-start gap-2 rounded-lg border border-negative/40 bg-negative-subtle px-3 py-2 text-xs text-negative">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p>{submitError}</p>
                <p className="mt-0.5 text-negative/80">再試行すると、既に完了した処理はやり直さず続きから送信します。</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              className="btn-secondary min-h-[48px] justify-center"
              disabled={isSubmitting}
              onClick={() => setStep('review')}
            >
              内容を修正
            </button>
            <button
              type="button"
              className="btn-primary min-h-[48px] justify-center"
              disabled={!online || isSubmitting}
              onClick={() => void handleSubmit()}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  送信中…
                </>
              ) : submitError ? (
                <>
                  <RefreshCw className="h-4 w-4" />
                  再試行する
                </>
              ) : (
                '申請を送信する'
              )}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="flex flex-col items-center gap-6 pt-12 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-positive-subtle">
            <Check className="h-10 w-10 text-positive" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-surface-50">申請が完了しました！</h1>
            {createdReportNo && <p className="mt-1 text-sm text-surface-400">申請番号: {createdReportNo}</p>}
          </div>
          <div className="flex w-full flex-col gap-3">
            <button
              type="button"
              className="btn-primary min-h-[48px] justify-center"
              onClick={() => resetWizard('capture')}
            >
              <Camera className="h-4 w-4" />
              続けて別のレシートを申請する
            </button>
            <button
              type="button"
              className="btn-secondary min-h-[48px] justify-center"
              onClick={() => navigate('/mobile/my-applications')}
            >
              <History className="h-4 w-4" />
              履歴を見る
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
