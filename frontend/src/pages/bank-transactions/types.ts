import type { components } from '../../types/api.generated';

export type BankTransaction = components['schemas']['BankTransaction'];
export type BankMatchStatus = NonNullable<BankTransaction['match_status']>;

export interface BankTransactionListParams {
  page?: number;
  page_size?: number;
  bank_account_id?: string;
  match_status?: BankMatchStatus;
  transaction_date_from?: string;
  transaction_date_to?: string;
}

export interface ImportCsvParams {
  file: File;
  bank_account_id: string;
  import_profile_id?: string;
}

export interface ImportCsvResult {
  imported_count: number;
  duplicate_skipped_count: number;
  auto_matched_count: number;
  transactions: BankTransaction[];
}

export interface MatchInput {
  target_type?: 'invoice' | 'vendor_bill' | 'journal_entry';
  target_id?: string;
  account_id?: string;
}

export const MATCH_STATUS_LABEL: Record<BankMatchStatus, string> = {
  unmatched: '未消込',
  auto_matched: '自動消込',
  manually_matched: '手動消込',
  reconciled: '照合済み',
  ignored: '無視',
};

export const MATCH_STATUS_BADGE: Record<BankMatchStatus, string> = {
  unmatched: 'badge-draft',
  auto_matched: 'badge-posted',
  manually_matched: 'badge-posted',
  reconciled: 'badge-posted',
  ignored: 'badge-rejected',
};
