import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';

interface DisposeDialogProps {
  assetName: string;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: (input: {
    disposalDate: string;
    disposalType: 'disposed' | 'sold';
    proceedsAmount: number;
  }) => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function DisposeDialog({ assetName, isSubmitting, onCancel, onConfirm }: DisposeDialogProps) {
  const [disposalDate, setDisposalDate] = useState(todayIso());
  const [disposalType, setDisposalType] = useState<'disposed' | 'sold'>('disposed');
  const [proceedsAmount, setProceedsAmount] = useState('0');

  return (
    <Modal title="除却・売却処理" onClose={onCancel}>
      <p className="mb-4 text-sm text-surface-400">
        対象: <span className="text-surface-200">{assetName}</span>
      </p>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">処理日</label>
          <input
            type="date"
            value={disposalDate}
            onChange={(e) => setDisposalDate(e.target.value)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">区分</label>
          <select
            value={disposalType}
            onChange={(e) => setDisposalType(e.target.value as 'disposed' | 'sold')}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="disposed">除却(廃棄)</option>
            <option value="sold">売却</option>
          </select>
        </div>
        {disposalType === 'sold' && (
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">売却代金</label>
            <input
              type="number"
              min="0"
              step="1"
              value={proceedsAmount}
              onChange={(e) => setProceedsAmount(e.target.value)}
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
          disabled={isSubmitting}
          onClick={() =>
            onConfirm({
              disposalDate,
              disposalType,
              proceedsAmount: disposalType === 'sold' ? Number(proceedsAmount) || 0 : 0,
            })
          }
        >
          {isSubmitting ? '処理中…' : '実行'}
        </button>
      </div>
    </Modal>
  );
}
