import type { components } from '../../types/api.generated';
import type { BankTransaction } from '../bank-transactions/types';

export type BankAccount = components['schemas']['BankAccount'];

export interface BankAccountListParams {
  page?: number;
  page_size?: number;
}

export interface BankAccountFormInput {
  bank_name: string;
  bank_code?: string;
  branch_name?: string;
  branch_code?: string;
  account_type: 'ordinary' | 'checking';
  account_number: string;
  account_holder_kana?: string;
  currency_code: string;
  opening_balance: number;
  linked_account_id?: string;
}

export interface BankSyncParams {
  bank_account_id: string;
  start_date?: string;
  end_date?: string;
}

export interface BankSyncResult {
  synced_count: number;
  duplicate_skipped_count: number;
  auto_matched_count: number;
  transactions: BankTransaction[];
}
