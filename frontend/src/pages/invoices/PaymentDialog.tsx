import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';

interface PaymentDialogProps {
  invoiceNo: string;
  remainingAmount: number;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: (input: { paymentDate: string; amount: number }) => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

/** 入金消込登録ダイアログ。過入金にも対応するため`remainingAmount`は目安表示に留め、上限バリデーションはしない */
export function PaymentDialog({
  invoiceNo,
  remainingAmount,
  isSubmitting,
  onCancel,
  onConfirm,
}: PaymentDialogProps) {
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [amount, setAmount] = useState(String(remainingAmount > 0 ? remainingAmount : ''));

  const canSubmit = Number(amount) > 0 && paymentDate;

  return (
    <Modal title="入金消込を登録" onClose={onCancel}>
      <p className="mb-4 text-sm text-surface-400">
        対象: <span className="font-mono text-surface-200">{invoiceNo}</span>
        <br />
        残高目安: {currencyFormatter.format(remainingAmount)}
      </p>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">入金日</label>
          <input
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">入金額</label>
          <input
            type="number"
            min="0"
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
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
          onClick={() => onConfirm({ paymentDate, amount: Number(amount) })}
        >
          {isSubmitting ? '処理中…' : '消込を登録'}
        </button>
      </div>
    </Modal>
  );
}
