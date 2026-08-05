import type { components } from '../../types/api.generated';

export type TrialBalanceLine = components['schemas']['TrialBalanceLine'];
export type FinancialStatementLine = components['schemas']['FinancialStatementLine'];
export type CashFlowStatement = components['schemas']['CashFlowStatement'];

export interface FinancialStatement {
  period_label: string;
  lines: FinancialStatementLine[];
}
