import type { components } from '../../types/api.generated';

export type ConsumptionTaxReturnDto = components['schemas']['ConsumptionTaxReturn'];
export type ConsumptionTaxReturnLineDto = components['schemas']['ConsumptionTaxReturnLine'];

export interface ConsumptionTaxReturnRow {
  id: string;
  fiscal_year_id: string;
  filing_method: string;
  taxable_sales_amount: string;
  taxable_purchase_amount: string;
  tax_due_amount: string;
  status: string;
  finalized_at: Date | null;
}

export interface ConsumptionTaxReturnLineRow {
  id: string;
  category: string;
  amount: string;
}

export function mapConsumptionTaxReturnLineRow(row: ConsumptionTaxReturnLineRow): ConsumptionTaxReturnLineDto {
  return { id: row.id, category: row.category, amount: Number(row.amount) };
}

export function mapConsumptionTaxReturnRow(
  row: ConsumptionTaxReturnRow,
  lines: ConsumptionTaxReturnLineDto[],
): ConsumptionTaxReturnDto {
  return {
    id: row.id,
    fiscal_year_id: row.fiscal_year_id,
    filing_method: row.filing_method as ConsumptionTaxReturnDto['filing_method'],
    taxable_sales_amount: Number(row.taxable_sales_amount),
    taxable_purchase_amount: Number(row.taxable_purchase_amount),
    tax_due_amount: Number(row.tax_due_amount),
    status: row.status as ConsumptionTaxReturnDto['status'],
    finalized_at: row.finalized_at ? row.finalized_at.toISOString() : null,
    lines,
  };
}

const CONSUMPTION_TAX_RETURN_COLUMNS = `
  id,
  fiscal_year_id,
  filing_method,
  taxable_sales_amount,
  taxable_purchase_amount,
  tax_due_amount,
  status,
  finalized_at
`;

const CONSUMPTION_TAX_RETURN_LINE_COLUMNS = `
  id,
  category,
  amount
`;

export const SQL_COLUMNS = {
  consumptionTaxReturn: CONSUMPTION_TAX_RETURN_COLUMNS,
  consumptionTaxReturnLine: CONSUMPTION_TAX_RETURN_LINE_COLUMNS,
};
