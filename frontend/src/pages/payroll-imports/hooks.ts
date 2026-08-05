import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import {
  createPayrollImportMapping,
  fetchPayrollImportMappings,
  fetchPayrollImports,
  importPayrollCsv,
  postPayrollImport,
  updatePayrollImportMapping,
} from './api';
import type {
  ImportPayrollCsvParams,
  PayrollImportListParams,
  PayrollImportMappingFormInput,
  PayrollImportMappingListParams,
} from './types';

const IMPORTS_KEY = 'payroll-imports';
const MAPPINGS_KEY = 'payroll-import-mappings';

export function usePayrollImports(params: PayrollImportListParams) {
  return useQuery({
    queryKey: [IMPORTS_KEY, 'list', params],
    queryFn: () => fetchPayrollImports(params),
  });
}

export function useImportPayrollCsv() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: ImportPayrollCsvParams) => importPayrollCsv(params),
    onSuccess: (record) => {
      queryClient.invalidateQueries({ queryKey: [IMPORTS_KEY] });
      toast.success(`給与CSVを取込みました(従業員${record.lines?.length ?? 0}名分)`);
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}

export function usePostPayrollImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => postPayrollImport(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [IMPORTS_KEY] });
      toast.success('給与仕訳を確定しました');
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}

export function usePayrollImportMappings(params: PayrollImportMappingListParams) {
  return useQuery({
    queryKey: [MAPPINGS_KEY, 'list', params],
    queryFn: () => fetchPayrollImportMappings(params),
  });
}

export function useCreatePayrollImportMapping() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: PayrollImportMappingFormInput) => createPayrollImportMapping(dto),
    onSuccess: (mapping) => {
      queryClient.invalidateQueries({ queryKey: [MAPPINGS_KEY] });
      toast.success(`給与CSV取込マッピング「${mapping.name}」を作成しました`);
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}

export function useUpdatePayrollImportMapping() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: PayrollImportMappingFormInput }) =>
      updatePayrollImportMapping(id, dto),
    onSuccess: (mapping) => {
      queryClient.invalidateQueries({ queryKey: [MAPPINGS_KEY] });
      toast.success(`給与CSV取込マッピング「${mapping.name}」を更新しました`);
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}
