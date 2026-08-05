import type { components } from '../../types/api.generated';

export type Customer = components['schemas']['Customer'];

export interface CustomerListParams {
  page?: number;
  page_size?: number;
  q?: string;
}

export interface CustomerFormInput {
  code: string;
  name: string;
  kana_name?: string;
}
