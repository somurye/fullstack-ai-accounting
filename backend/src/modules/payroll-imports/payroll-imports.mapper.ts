import type { components } from '../../types/api.generated';

export type PayrollImportDto = components['schemas']['PayrollImport'];
export type PayrollImportLineDto = components['schemas']['PayrollImportLine'];

export interface PayrollImportRow {
  id: string;
  pay_period_start: string;
  pay_period_end: string;
  payment_date: string;
  status: 'imported' | 'posted';
  journal_entry_id: string | null;
}

export interface PayrollImportLineRow {
  id: string;
  employee_name: string;
  employee_code: string | null;
  executive_compensation_amount: string;
  salary_amount: string;
  withholding_tax_amount: string;
  resident_tax_amount: string;
  social_insurance_employee_amount: string;
  social_insurance_company_amount: string;
  net_payment_amount: string;
}

/**
 * `pg` はDATE型カラムをランタイムでJSの`Date`オブジェクトとして返す(TSの型注釈とは無関係)。
 * `generateJournalEntryNo` 等が文字列を期待してクラッシュするのを防ぐため、
 * 日付カラムは必ず`::text`でキャストしてから取得する
 * (`bank-transactions.mapper.ts` の`transaction_date::text`と同じ対策)。
 */
export const PAYROLL_IMPORT_COLUMNS = `
  id,
  pay_period_start::text AS pay_period_start,
  pay_period_end::text AS pay_period_end,
  payment_date::text AS payment_date,
  status,
  journal_entry_id
`;

export const PAYROLL_IMPORT_LINE_COLUMNS = `
  id, employee_name, employee_code,
  executive_compensation_amount, salary_amount, withholding_tax_amount, resident_tax_amount,
  social_insurance_employee_amount, social_insurance_company_amount, net_payment_amount
`;

export function mapPayrollImportLineRow(row: PayrollImportLineRow): PayrollImportLineDto {
  return {
    id: row.id,
    employee_name: row.employee_name,
    employee_code: row.employee_code,
    executive_compensation_amount: Number(row.executive_compensation_amount),
    salary_amount: Number(row.salary_amount),
    withholding_tax_amount: Number(row.withholding_tax_amount),
    resident_tax_amount: Number(row.resident_tax_amount),
    social_insurance_employee_amount: Number(row.social_insurance_employee_amount),
    social_insurance_company_amount: Number(row.social_insurance_company_amount),
    net_payment_amount: Number(row.net_payment_amount),
  };
}

export function mapPayrollImportRow(row: PayrollImportRow, lines: PayrollImportLineDto[]): PayrollImportDto {
  return {
    id: row.id,
    pay_period_start: row.pay_period_start,
    pay_period_end: row.pay_period_end,
    payment_date: row.payment_date,
    status: row.status,
    journal_entry_id: row.journal_entry_id,
    lines,
  };
}
