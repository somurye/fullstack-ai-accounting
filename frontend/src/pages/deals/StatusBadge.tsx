import type { DealStage } from './types';
import { DEAL_STAGE_COLORS, DEAL_STAGE_LABELS } from './types';

interface StatusBadgeProps {
  stage: DealStage;
  className?: string;
}

export function StatusBadge({ stage, className = '' }: StatusBadgeProps) {
  const color = DEAL_STAGE_COLORS[stage] ?? {
    bg: 'bg-slate-100',
    text: 'text-slate-700',
    border: 'border-slate-200',
  };
  const label = DEAL_STAGE_LABELS[stage] ?? stage;

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${color.bg} ${color.text} ${color.border} ${className}`}
    >
      {label}
    </span>
  );
}
