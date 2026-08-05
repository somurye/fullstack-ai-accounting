import type { components } from '../../../types/api.generated';

export type TaxCategory = components['schemas']['TaxCategory'];
export type TaxType = components['schemas']['TaxType'];

export interface TaxCategoryListParams {
  page?: number;
  page_size?: number;
}

export interface TaxCategoryFormInput {
  code: string;
  name: string;
  tax_type: TaxType;
  tax_rate: number;
  is_reduced_rate: boolean;
}
