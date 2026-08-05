import type { components } from '../../../types/api.generated';

export type Account = components['schemas']['Account'];
export type AccountType = components['schemas']['AccountType'];
export type DebitCredit = components['schemas']['DebitCredit'];

export interface AccountListParams {
  page?: number;
  page_size?: number;
}

export interface AccountCreateFormInput {
  code: string;
  name: string;
  account_type: AccountType;
  normal_balance: DebitCredit;
  category_id?: string;
  parent_account_id?: string;
  default_tax_category_code?: string;
  allow_manual_entry: boolean;
}

export interface AccountUpdateFormInput {
  name: string;
  category_id?: string;
  allow_manual_entry: boolean;
  is_active: boolean;
}
