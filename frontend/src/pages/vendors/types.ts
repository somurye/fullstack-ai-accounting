import type { components } from '../../types/api.generated';

export type Vendor = components['schemas']['Vendor'];
export type BankAccountInfo = NonNullable<Vendor['bank_account_info']>;

export interface VendorListParams {
  page?: number;
  page_size?: number;
  q?: string;
}

export interface VendorFormInput {
  code: string;
  name: string;
  kana_name?: string;
  invoice_registration_number?: string;
  bank_account_info?: BankAccountInfo;
}
