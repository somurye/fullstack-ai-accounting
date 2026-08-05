import type { components } from '../../types/api.generated';

export type BankTransactionDto = components['schemas']['BankTransaction'];

export interface BankTransactionRow {
  id: string;
  bank_account_id: string;
  transaction_date: string;
  description: string | null;
  amount: string;
  balance_after: string | null;
  match_status: BankTransactionDto['match_status'];
  matched_journal_entry_id: string | null;
  imported_at: string;
}

/**
 * `transaction_date` は `pg` がDATE型を素通しすると呼び出し元のタイムゾーンに応じて
 * JS Dateオブジェクトとして返る(文字列メソッドが使えずクラッシュ、またはAPIレスポンスで
 * `format: date` ではなく完全なdatetime文字列になる)。`::text` キャストにより
 * PostgreSQL側で確実に `YYYY-MM-DD` 文字列化してから受け取る。
 */
export const BANK_TRANSACTION_COLUMNS =
  "id, bank_account_id, transaction_date::text AS transaction_date, description, amount, balance_after, match_status, matched_journal_entry_id, imported_at";

export function mapBankTransactionRow(row: BankTransactionRow): BankTransactionDto {
  return {
    id: row.id,
    bank_account_id: row.bank_account_id,
    transaction_date: row.transaction_date,
    description: row.description,
    amount: Number(row.amount),
    balance_after: row.balance_after !== null ? Number(row.balance_after) : null,
    match_status: row.match_status,
    matched_journal_entry_id: row.matched_journal_entry_id,
    imported_at: row.imported_at,
  };
}
