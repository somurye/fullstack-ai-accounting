import type { components } from '../../../types/api.generated';

export type Department = components['schemas']['Department'];

export interface DepartmentListParams {
  page?: number;
  page_size?: number;
}

export interface DepartmentFormInput {
  code: string;
  name: string;
  is_active: boolean;
}
