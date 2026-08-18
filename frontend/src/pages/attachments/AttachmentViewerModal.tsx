import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAttachmentContent } from './hooks';
import type { Attachment } from './types';

/**
 * AttachmentViewerModal
 * ======================
 * 電帳法(電子帳簿保存法)のスキャナ保存要件が求める「速やかな可視性」を満たすための
 * 証憑プレビューモーダル。`GET /attachments/:id/content` から取得したblobを
 * object URLへ変換し、画像はimg、PDFはiframeでインライン表示する。
 *
 * `Attachment.mime_type`未対応の形式(Office文書等)はブラウザ内プレビュー不可のため、
 * ダウンロードリンクへフォールバックする。
 */
export function AttachmentViewerModal({
  attachment,
  onClose,
}: {
  attachment: Attachment;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useAttachmentContent(attachment.id ?? null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!data) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(data.blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [data]);

  const contentType = data?.contentType ?? attachment.mime_type ?? '';
  const isImage = contentType.startsWith('image/');
  const isPdf = contentType === 'application/pdf';

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div className="card flex h-[85vh] w-full max-w-4xl flex-col p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-surface-50">{attachment.file_name}</h2>
            <p className="text-xs text-surface-500">{contentType || '不明な形式'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-surface-500 transition-colors hover:text-surface-200"
            aria-label="閉じる"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-1 items-center justify-center overflow-auto rounded-lg bg-surface-950">
          {isLoading && <p className="text-sm text-surface-400">読み込み中…</p>}
          {isError && <p className="text-sm text-negative">証憑ファイルの取得に失敗しました</p>}
          {!isLoading && !isError && objectUrl && isImage && (
            <img src={objectUrl} alt={attachment.file_name} className="max-h-full max-w-full object-contain" />
          )}
          {!isLoading && !isError && objectUrl && isPdf && (
            <iframe src={objectUrl} title={attachment.file_name} className="h-full w-full border-0" />
          )}
          {!isLoading && !isError && objectUrl && !isImage && !isPdf && (
            <div className="space-y-3 p-6 text-center">
              <p className="text-sm text-surface-400">
                この形式(<span className="font-mono">{contentType}</span>)はブラウザ内プレビューに対応していません。
              </p>
              <a href={objectUrl} download={attachment.file_name} className="btn-secondary inline-flex text-sm">
                ダウンロード
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
