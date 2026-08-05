import { apiClient } from '../../../lib/apiClient';
import type { components } from '../../../types/api.generated';
import type { Department, DepartmentFormInput, DepartmentListParams } from './types';

type Meta = components['schemas']['Meta'];

export interface DepartmentListResult {
  departments: Department[];
  meta: Meta | undefined;
}

export async function fetchDepartments(params: DepartmentListParams): Promise<DepartmentListResult> {
  const { data } = await apiClient.get<{ success: true; data: Department[]; meta?: Meta }>(
    '/departments',
    { params },
  );
  return { departments: data.data ?? [], meta: data.meta };
}

export async function createDepartment(dto: DepartmentFormInput): Promise<Department> {
  const { data } = await apiClient.post<{ success: true; data: Department }>('/departments', dto);
  if (!data.data) throw new Error('部門の作成に失敗しました');
  return data.data;
}

export async function updateDepartment(id: string, dto: DepartmentFormInput): Promise<Department> {
  const { data } = await apiClient.patch<{ success: true; data: Department }>(`/departments/${id}`, dto);
  if (!data.data) throw new Error('部門の更新に失敗しました');
  return data.data;
}
