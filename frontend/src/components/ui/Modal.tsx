import { X } from 'lucide-react';
import type { ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** 汎用モーダルダイアログ。ダーク基調のデザインシステム(`card`)に合わせたシンプルな実装 */
export function Modal({ title, onClose, children }: ModalProps) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-lg p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-surface-50">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-surface-500 transition-colors hover:text-surface-200"
            aria-label="閉じる"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
