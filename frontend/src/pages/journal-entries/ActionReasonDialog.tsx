import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';

interface ActionReasonDialogProps {
  mode: 'void' | 'reverse';
  entryNo: string;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: (input: { reason: string; entryDate?: string }) => void;
}

/**
 * void(取消)/ reverse(反対仕訳起票)の理由入力ダイアログ。
 * reverseは`reason`必須、voidは任意(`JournalEntryUpdate`同様APIのbodyはoptional)。
 */
export function ActionReasonDialog({
  mode,
  entryNo,
  isSubmitting,
  onCancel,
  onConfirm,
}: ActionReasonDialogProps) {
  const [reason, setReason] = useState('');
  const [entryDate, setEntryDate] = useState('');

  const isReverse = mode === 'reverse';
  const canSubmit = !isReverse || reason.trim().length > 0;

  return (
    <Modal title={isReverse ? '反対仕訳を起票' : '仕訳をvoid(即時取消)'} onClose={onCancel}>
      <p className="mb-4 text-sm text-surface-400">
        対象: <span className="font-mono text-surface-200">{entryNo}</span>
        {isReverse
          ? ' の反対仕訳(貸借を反転した下書き)を新規作成します。'
          : ' を取り消します。確定から24時間以内かつ他レコードから未参照の場合のみ実行できます。'}
      </p>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">
            理由{isReverse && <span className="text-negative"> *</span>}
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            placeholder={isReverse ? '例: 計上科目の誤りのため訂正' : '例: 入力ミスのため取消'}
          />
        </div>

        {isReverse && (
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">
              反対仕訳の伝票日付(未指定時は当日)
            </label>
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={isSubmitting}>
          キャンセル
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={!canSubmit || isSubmitting}
          onClick={() => onConfirm({ reason: reason.trim(), entryDate: entryDate || undefined })}
        >
          {isSubmitting ? '処理中…' : isReverse ? '反対仕訳を起票' : 'voidを実行'}
        </button>
      </div>
    </Modal>
  );
}
