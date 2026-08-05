import type { components } from '../../types/api.generated';

export type JournalEntry = components['schemas']['JournalEntry'];
export type JournalEntryLine = components['schemas']['JournalEntryLine'];
export type JournalEntryLineCreate = components['schemas']['JournalEntryLineCreate'];
export type JournalEntryCreate = components['schemas']['JournalEntryCreate'];
export type JournalEntryUpdate = components['schemas']['JournalEntryUpdate'];
export type JournalEntryStatus = components['schemas']['JournalEntryStatus'];
export type DebitCredit = components['schemas']['DebitCredit'];

export type Account = components['schemas']['Account'];
export type TaxCategory = components['schemas']['TaxCategory'];
export type Department = components['schemas']['Department'];

export interface JournalEntryListParams {
  page?: number;
  page_size?: number;
  status?: JournalEntryStatus;
  entry_date_from?: string;
  entry_date_to?: string;
  account_id?: string;
}

export const JOURNAL_ENTRY_STATUS_LABEL: Record<JournalEntryStatus, string> = {
  draft: '下書き',
  pending_approval: '承認待ち',
  posted: '確定済み',
  rejected: '却下',
  voided: '取消済み',
  reversed: '反対仕訳起票済み',
};
