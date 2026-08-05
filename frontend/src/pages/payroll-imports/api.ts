import { apiClient } from '../../lib/apiClient';
import type { components } from '../../types/api.generated';
import type {
  ImportPayrollCsvParams,
  PayrollImport,
  PayrollImportListParams,
  PayrollImportMapping,
  PayrollImportMappingFormInput,
  PayrollImportMappingListParams,
} from './types';

type Meta = components['schemas']['Meta'];

export interface PayrollImportListResult {
  imports: PayrollImport[];
  meta: Meta | undefined;
}

export interface PayrollImportMappingListResult {
  mappings: PayrollImportMapping[];
  meta: Meta | undefined;
}

export async function fetchPayrollImports(params: PayrollImportListParams): Promise<PayrollImportListResult> {
  const { data } = await apiClient.get<{ success: true; data: PayrollImport[]; meta?: Meta }>(
    '/payroll-imports',
    { params },
  );
  return { imports: data.data ?? [], meta: data.meta };
}

export async function importPayrollCsv(params: ImportPayrollCsvParams): Promise<PayrollImport> {
  const formData = new FormData();
  formData.append('file', params.file);
  formData.append('import_mapping_id', params.import_mapping_id);
  formData.append('pay_period_start', params.pay_period_start);
  formData.append('pay_period_end', params.pay_period_end);
  formData.append('payment_date', params.payment_date);
  const { data } = await apiClient.post<{ success: true; data: PayrollImport }>('/payroll-imports/csv', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  if (!data.data) throw new Error('給与CSV取込に失敗しました');
  return data.data;
}

export async function postPayrollImport(id: string): Promise<PayrollImport> {
  const { data } = await apiClient.post<{ success: true; data: PayrollImport }>(`/payroll-imports/${id}/post`);
  if (!data.data) throw new Error('給与仕訳の確定に失敗しました');
  return data.data;
}

export async function fetchPayrollImportMappings(
  params: PayrollImportMappingListParams,
): Promise<PayrollImportMappingListResult> {
  const { data } = await apiClient.get<{ success: true; data: PayrollImportMapping[]; meta?: Meta }>(
    '/payroll-import-mappings',
    { params },
  );
  return { mappings: data.data ?? [], meta: data.meta };
}

export async function createPayrollImportMapping(
  dto: PayrollImportMappingFormInput,
): Promise<PayrollImportMapping> {
  const { data } = await apiClient.post<{ success: true; data: PayrollImportMapping }>(
    '/payroll-import-mappings',
    dto,
  );
  if (!data.data) throw new Error('給与CSV取込マッピングの作成に失敗しました');
  return data.data;
}

export async function updatePayrollImportMapping(
  id: string,
  dto: PayrollImportMappingFormInput,
): Promise<PayrollImportMapping> {
  const { data } = await apiClient.patch<{ success: true; data: PayrollImportMapping }>(
    `/payroll-import-mappings/${id}`,
    dto,
  );
  if (!data.data) throw new Error('給与CSV取込マッピングの更新に失敗しました');
  return data.data;
}
