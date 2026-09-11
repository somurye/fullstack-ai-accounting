import type { components } from '../../types/api.generated';

export type GeneralRequest = components['schemas']['GeneralRequest'];
export type CreateGeneralRequestInput = components['schemas']['CreateGeneralRequestInput'];
export type UpdateGeneralRequestInput = components['schemas']['UpdateGeneralRequestInput'];

export const GENERAL_REQUEST_CATEGORIES = [
  { value: 'general', label: '一般・その他稟議' },
  { value: 'equipment', label: '備品・機材・ソフトウェア購入' },
  { value: 'rule_change', label: '社内規程・制度変更提案' },
  { value: 'business_trip', label: '出張・研修申請' },
  { value: 'other', label: 'その他相談・申請' },
] as const;

export const STATUS_LABELS: Record<
  GeneralRequest['status'],
  { label: string; bg: string; text: string; border: string }
> = {
  draft: {
    label: '下書き',
    bg: 'bg-surface-800',
    text: 'text-surface-300',
    border: 'border-surface-700',
  },
  pending_approval: {
    label: '承認待ち',
    bg: 'bg-amber-950/40',
    text: 'text-amber-400',
    border: 'border-amber-800/60',
  },
  active: {
    label: '承認済',
    bg: 'bg-emerald-950/40',
    text: 'text-emerald-400',
    border: 'border-emerald-800/60',
  },
  rejected: {
    label: '却下',
    bg: 'bg-rose-950/40',
    text: 'text-rose-400',
    border: 'border-rose-800/60',
  },
};
