import type { components } from '../../types/api.generated';

export type JournalEntryDto = components['schemas']['JournalEntry'];
export type JournalEntryLineDto = components['schemas']['JournalEntryLine'];

/**
 * SELECTクエリの行(pgは NUMERIC/DATE/TIMESTAMPTZ をそれぞれ文字列/Date/Dateで返す)を
 * `docs/openapi.yaml` のAPIレスポンス形状(number/ISO文字列)へ正規化する。
 */
export interface JournalEntryRow {
  id: string;
  entry_no: string;
  entry_date: string;
  fiscal_period_id: string | null;
  description: string | null;
  status: string;
  source_type: string | null;
  source_id: string | null;
  currency_code: string;
  exchange_rate: string;
  reversal_of_entry_id: string | null;
  posted_at: Date | null;
  voided_at: Date | null;
  created_by: string;
}

export interface JournalEntryLineRow {
  id: string;
  journal_entry_id: string;
  line_no: number;
  account_id: string;
  debit_credit: 'debit' | 'credit';
  amount: string;
  tax_category_id: string | null;
  tax_amount: string;
  department_id: string | null;
  customer_id: string | null;
  vendor_id: string | null;
  description: string | null;
}

export function mapJournalEntryLineRow(row: JournalEntryLineRow): JournalEntryLineDto {
  return {
    id: row.id,
    line_no: row.line_no,
    account_id: row.account_id,
    debit_credit: row.debit_credit,
    amount: Number(row.amount),
    tax_category_id: row.tax_category_id,
    tax_amount: Number(row.tax_amount),
    department_id: row.department_id,
    customer_id: row.customer_id,
    vendor_id: row.vendor_id,
    description: row.description,
  };
}

export function mapJournalEntryRow(
  row: JournalEntryRow,
  lines: JournalEntryLineDto[],
): JournalEntryDto {
  return {
    id: row.id,
    entry_no: row.entry_no,
    entry_date: row.entry_date,
    fiscal_period_id: row.fiscal_period_id,
    description: row.description,
    status: row.status as JournalEntryDto['status'],
    source_type: row.source_type as JournalEntryDto['source_type'],
    source_id: row.source_id,
    currency_code: row.currency_code,
    exchange_rate: Number(row.exchange_rate),
    reversal_of_entry_id: row.reversal_of_entry_id,
    posted_at: row.posted_at ? row.posted_at.toISOString() : null,
    voided_at: row.voided_at ? row.voided_at.toISOString() : null,
    created_by: row.created_by,
    lines,
  };
}

const JOURNAL_ENTRY_COLUMNS = `
  je.id,
  je.entry_no,
  TO_CHAR(je.entry_date, 'YYYY-MM-DD') AS entry_date,
  je.fiscal_period_id,
  je.description,
  je.status,
  je.source_type,
  je.source_id,
  je.currency_code,
  je.exchange_rate,
  je.reversal_of_entry_id,
  je.posted_at,
  je.voided_at,
  je.created_by
`;

const JOURNAL_ENTRY_LINE_COLUMNS = `
  id,
  journal_entry_id,
  line_no,
  account_id,
  debit_credit,
  amount,
  tax_category_id,
  tax_amount,
  department_id,
  customer_id,
  vendor_id,
  description
`;

export const SQL_COLUMNS = {
  journalEntry: JOURNAL_ENTRY_COLUMNS,
  journalEntryLine: JOURNAL_ENTRY_LINE_COLUMNS,
};
