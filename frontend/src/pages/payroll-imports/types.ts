import type { components } from '../../types/api.generated';

export type PayrollImport = components['schemas']['PayrollImport'];
export type PayrollImportLine = components['schemas']['PayrollImportLine'];
export type PayrollImportMapping = components['schemas']['PayrollImportMapping'];
export type PayrollImportColumnMapping = components['schemas']['PayrollImportColumnMapping'];
export type PayrollImportAccountMapping = components['schemas']['PayrollImportAccountMapping'];

export interface PayrollImportListParams {
  page?: number;
  page_size?: number;
}

export interface PayrollImportMappingListParams {
  page?: number;
  page_size?: number;
  is_active?: boolean;
}

export interface PayrollImportMappingFormInput {
  name: string;
  column_mapping: PayrollImportColumnMapping;
  account_mapping: PayrollImportAccountMapping;
  is_active: boolean;
}

export interface ImportPayrollCsvParams {
  file: File;
  import_mapping_id: string;
  pay_period_start: string;
  pay_period_end: string;
  payment_date: string;
}
