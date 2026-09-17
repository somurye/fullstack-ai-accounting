import { FileCheck } from 'lucide-react';
import {
  QUOTATION_STATUS_COLORS,
  QUOTATION_STATUS_LABELS,
  type QuotationStatus,
} from './types';

interface StatusBadgeProps {
  status: QuotationStatus;
  isConverted?: boolean;
  convertedInvoiceNo?: string | null;
  className?: string;
}

export function StatusBadge({ status, isConverted, convertedInvoiceNo, className = '' }: StatusBadgeProps) {
  const color = QUOTATION_STATUS_COLORS[status] ?? QUOTATION_STATUS_COLORS.draft;
  const label = QUOTATION_STATUS_LABELS[status] ?? status;

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${color.bg} ${color.text} ${color.border}`}
      >
        {label}
      </span>
      {isConverted && (
        <span
          title={convertedInvoiceNo ? `売上請求書 (${convertedInvoiceNo}) 発行済` : '請求書発行済'}
          className="inline-flex items-center gap-1 rounded-md border border-indigo-800 bg-indigo-950/70 px-2 py-0.5 text-xs font-medium text-indigo-300"
        >
          <FileCheck className="h-3 w-3 text-indigo-400" />
          受注転換済
        </span>
      )}
    </div>
  );
}
