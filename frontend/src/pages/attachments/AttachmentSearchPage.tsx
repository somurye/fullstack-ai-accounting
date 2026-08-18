import { Eye, Link2, Upload } from 'lucide-react';
import { useState } from 'react';
import { AttachmentViewerModal } from './AttachmentViewerModal';
import { useAttachments, useLinkAttachment, useUploadAttachment } from './hooks';
import { ATTACHMENT_LINKABLE_TYPES, type Attachment, type AttachmentLinkableType } from './types';

const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });
const dateTimeFormatter = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function UploadPanel() {
  const uploadMutation = useUploadAttachment();
  const [file, setFile] = useState<File | null>(null);
  const [transactionDate, setTransactionDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [counterpartyName, setCounterpartyName] = useState('');

  const canSubmit = Boolean(file) && Boolean(transactionDate) && Number(amount) > 0 && counterpartyName.trim().length > 0;

  const handleSubmit = async (): Promise<void> => {
    if (!file) return;
    await uploadMutation.mutateAsync({
      file,
      transaction_date: transactionDate,
      amount: Number(amount),
      counterparty_name: counterpartyName,
    });
    setFile(null);
    setAmount('');
    setCounterpartyName('');
  };

  return (
    <div className="card space-y-4 p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-surface-100">
        <Upload className="h-4 w-4" />
        証憑をアップロード
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <label className="mb-1 block text-xs font-medium text-surface-400">ファイル</label>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-xs text-surface-300 file:mr-3 file:rounded-md file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-brand-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">取引年月日</label>
          <input
            type="date"
            value={transactionDate}
            onChange={(e) => setTransactionDate(e.target.value)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">取引金額</label>
          <input
            type="number"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-right text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">取引先名</label>
          <input
            type="text"
            value={counterpartyName}
            onChange={(e) => setCounterpartyName(e.target.value)}
            placeholder="例: 株式会社サンプル"
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          className="btn-primary"
          disabled={!canSubmit || uploadMutation.isPending}
          onClick={() => void handleSubmit()}
        >
          {uploadMutation.isPending ? 'アップロード中…' : 'アップロード'}
        </button>
      </div>
    </div>
  );
}

function LinkRow({ attachment }: { attachment: Attachment }) {
  const [showForm, setShowForm] = useState(false);
  const [linkableType, setLinkableType] = useState<AttachmentLinkableType>('journal_entry');
  const [linkableId, setLinkableId] = useState('');
  const linkMutation = useLinkAttachment();

  if (!showForm) {
    return (
      <button
        type="button"
        className="inline-flex items-center gap-1 text-xs text-brand-300 hover:text-brand-200"
        onClick={() => setShowForm(true)}
      >
        <Link2 className="h-3.5 w-3.5" />
        業務レコードへ関連付け
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={linkableType}
        onChange={(e) => setLinkableType(e.target.value as AttachmentLinkableType)}
        className="rounded-md border border-surface-700 bg-surface-850 px-2 py-1 text-xs text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
      >
        {ATTACHMENT_LINKABLE_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={linkableId}
        onChange={(e) => setLinkableId(e.target.value)}
        placeholder="対象のUUID"
        className="w-44 rounded-md border border-surface-700 bg-surface-850 px-2 py-1 text-xs text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
      />
      <button
        type="button"
        className="btn-secondary !py-1 text-xs"
        disabled={!linkableId || linkMutation.isPending}
        onClick={() =>
          linkMutation.mutate(
            { attachmentId: attachment.id as string, linkableType, linkableId },
            { onSuccess: () => setShowForm(false) },
          )
        }
      >
        関連付け
      </button>
      <button type="button" className="text-xs text-surface-500 hover:text-surface-300" onClick={() => setShowForm(false)}>
        キャンセル
      </button>
    </div>
  );
}

export function AttachmentSearchPage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [amount, setAmount] = useState('');
  const [counterpartyName, setCounterpartyName] = useState('');
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);

  const { data, isLoading } = useAttachments({
    transaction_date_from: dateFrom || undefined,
    transaction_date_to: dateTo || undefined,
    amount: amount ? Number(amount) : undefined,
    counterparty_name: counterpartyName || undefined,
    page_size: 100,
  });

  const attachments = data?.attachments ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-surface-50">証憑管理(電帳法対応)</h1>
        <p className="mt-1 text-sm text-surface-400">
          電子帳簿保存法のスキャナ保存要件(取引年月日・取引金額・取引先)による複合検索と、
          SHA-256ハッシュによる改ざん検知が可能です。アップロード後の物理削除はできません。
        </p>
      </div>

      <UploadPanel />

      <div className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">取引年月日(from)</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">取引年月日(to)</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">取引金額(完全一致)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-right text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">取引先名(部分一致)</label>
          <input
            type="text"
            value={counterpartyName}
            onChange={(e) => setCounterpartyName(e.target.value)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
      </div>

      {isLoading && <p className="text-sm text-surface-400">読み込み中…</p>}
      {!isLoading && attachments.length === 0 && (
        <div className="card p-8 text-center text-sm text-surface-500">該当する証憑はありません</div>
      )}

      <div className="space-y-3">
        {attachments.map((a) => (
          <div key={a.id} className="card space-y-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-surface-100">{a.file_name}</p>
                <p className="text-xs text-surface-500">
                  {a.transaction_date} ・ {currencyFormatter.format(a.amount ?? 0)} ・ {a.counterparty_name}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-surface-500">
                  {a.uploaded_at ? dateTimeFormatter.format(new Date(a.uploaded_at)) : '—'}
                </span>
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-1 !py-1 text-xs"
                  onClick={() => setPreviewAttachment(a)}
                >
                  <Eye className="h-3.5 w-3.5" />
                  プレビュー
                </button>
              </div>
            </div>
            <p className="break-all font-mono text-[11px] text-surface-500">SHA-256: {a.file_hash}</p>
            <LinkRow attachment={a} />
          </div>
        ))}
      </div>

      {previewAttachment && (
        <AttachmentViewerModal attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />
      )}
    </div>
  );
}
