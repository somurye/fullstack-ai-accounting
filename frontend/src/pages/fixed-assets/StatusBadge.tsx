import { FIXED_ASSET_STATUS_LABEL, type FixedAssetStatus } from './types';

const STATUS_BADGE_CLASS: Record<FixedAssetStatus, string> = {
  active: 'badge-posted',
  disposed: 'badge-void',
  sold: 'badge-reversed',
};

export function StatusBadge({ status }: { status: FixedAssetStatus }) {
  return <span className={STATUS_BADGE_CLASS[status]}>{FIXED_ASSET_STATUS_LABEL[status]}</span>;
}
