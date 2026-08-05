import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';

interface CreditNoteDialogProps {
  invoiceNo: string;
  maxAmount: number;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: (input: { amount: number; reason: string }) => void;
}

const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

/** クレジットノート(赤黒訂正)発行ダイアログ */
export function CreditNoteDialog({
  invoiceNo,
  maxAmount,
  isSubmitting,
  onCancel,
  onConfirm,
}: CreditNoteDialogProps) {
  const [amount, setAmount] = useState(String(maxAmount > 0 ? maxAmount : ''));
  const [reason, setReason] = useState('');

  const canSubmit = Number(amount) > 0 && Number(amount) <= maxAmount && reason.trim().length > 0;

  return (
    <Modal title="クレジットノートを起票" onClose={onCancel}>
      <p className="mb-4 text-sm text-surface-400">
        対象: <span className="font-mono text-surface-200">{invoiceNo}</span>
        <br />
        訂正可能な上限額: {currencyFormatter.format(maxAmount)}
      </p>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">訂正金額</label>
          <input
            type="number"
            min="0"
            max={maxAmount}
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">
            理由 <span className="text-negative">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            placeholder="例: 数量誤りのため訂正"
          />
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={isSubmitting}>
          キャンセル
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={!canSubmit || isSubmitting}
          onClick={() => onConfirm({ amount: Number(amount), reason: reason.trim() })}
        >
          {isSubmitting ? '処理中…' : 'クレジットノートを起票'}
        </button>
      </div>
    </Modal>
  );
}
