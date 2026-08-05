import { JOURNAL_ENTRY_STATUS_LABEL, type JournalEntryStatus } from './types';

const STATUS_BADGE_CLASS: Record<JournalEntryStatus, string> = {
  draft: 'badge-draft',
  pending_approval: 'badge-pending',
  posted: 'badge-posted',
  rejected: 'badge-rejected',
  voided: 'badge-void',
  reversed: 'badge-reversed',
};

export function StatusBadge({ status }: { status: JournalEntryStatus }) {
  return <span className={STATUS_BADGE_CLASS[status]}>{JOURNAL_ENTRY_STATUS_LABEL[status]}</span>;
}
