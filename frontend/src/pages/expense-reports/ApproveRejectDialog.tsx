import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';

interface ApproveRejectDialogProps {
  mode: 'approve' | 'reject';
  reportNo: string;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: (comment: string) => void;
  /** ダイアログタイトル(省略時は経費精算向けの既定文言を使用) */
  titleOverride?: { approve: string; reject: string };
}

/**
 * 承認/却下コメント入力ダイアログ。却下は`comment`必須(openapi.yamlのreject仕様に対応)。
 * 経費精算専用として作られたが、`approval-requests`(汎用承認インボックス)からも
 * 同じUIパターンで再利用されるため、タイトル文言は`titleOverride`で差し替え可能にしている。
 */
export function ApproveRejectDialog({
  mode,
  reportNo,
  isSubmitting,
  onCancel,
  onConfirm,
  titleOverride,
}: ApproveRejectDialogProps) {
  const [comment, setComment] = useState('');
  const isReject = mode === 'reject';
  const canSubmit = !isReject || comment.trim().length > 0;
  const defaultTitle = isReject ? '経費申請を却下' : '経費申請を承認';
  const title = titleOverride ? (isReject ? titleOverride.reject : titleOverride.approve) : defaultTitle;

  return (
    <Modal title={title} onClose={onCancel}>
      <p className="mb-4 text-sm text-surface-400">
        対象: <span className="font-mono text-surface-200">{reportNo}</span>
      </p>

      <label className="mb-1 block text-xs font-medium text-surface-400">
        コメント{isReject && <span className="text-negative"> *</span>}
      </label>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
        className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
        placeholder={isReject ? '却下理由を入力してください' : '任意でコメントを入力'}
      />

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={isSubmitting}>
          キャンセル
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={!canSubmit || isSubmitting}
          onClick={() => onConfirm(comment.trim())}
        >
          {isSubmitting ? '処理中…' : isReject ? '却下する' : '承認する'}
        </button>
      </div>
    </Modal>
  );
}
