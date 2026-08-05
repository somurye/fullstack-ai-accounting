import type { components } from '../../types/api.generated';

export type ConsumptionTaxReturn = components['schemas']['ConsumptionTaxReturn'];
export type ConsumptionTaxReturnLine = components['schemas']['ConsumptionTaxReturnLine'];
export type TaxFilingMethod = components['schemas']['TaxFilingMethod'];

export interface ConsumptionTaxReturnListParams {
  page?: number;
  page_size?: number;
}

export const TAX_FILING_METHOD_LABEL: Record<TaxFilingMethod, string> = {
  general: '本則課税',
  simplified: '簡易課税',
  twenty_percent_special: '2割特例',
};
