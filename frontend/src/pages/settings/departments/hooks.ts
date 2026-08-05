import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../../lib/apiClient';
import { toast } from '../../../stores/toastStore';
import { createDepartment, fetchDepartments, updateDepartment } from './api';
import type { DepartmentFormInput, DepartmentListParams } from './types';

const DEPARTMENTS_KEY = 'settings-departments';

export function useDepartments(params: DepartmentListParams) {
  return useQuery({
    queryKey: [DEPARTMENTS_KEY, 'list', params],
    queryFn: () => fetchDepartments(params),
  });
}

export function useCreateDepartment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: DepartmentFormInput) => createDepartment(dto),
    onSuccess: (department) => {
      queryClient.invalidateQueries({ queryKey: [DEPARTMENTS_KEY] });
      toast.success(`部門「${department.name}」を作成しました`);
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}

export function useUpdateDepartment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: DepartmentFormInput }) => updateDepartment(id, dto),
    onSuccess: (department) => {
      queryClient.invalidateQueries({ queryKey: [DEPARTMENTS_KEY] });
      toast.success(`部門「${department.name}」を更新しました`);
    },
    onError: (error) => toast.error(formatApiErrorMessage(error)),
  });
}
