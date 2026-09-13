import { apiClient } from '../../lib/apiClient';
import type {
  Employee,
  EmployeeCreateInput,
  EmployeeListQuery,
  EmployeeUpdateInput,
  Meta,
} from './types';

export const employeesApi = {
  list: async (query: EmployeeListQuery = {}) => {
    const { data } = await apiClient.get<{
      success: boolean;
      data: Employee[];
      pagination?: Meta;
    }>('/employees', { params: query });
    return { employees: data.data, pagination: data.pagination };
  },

  getById: async (id: string) => {
    const { data } = await apiClient.get<{
      success: boolean;
      data: Employee;
    }>(`/employees/${id}`);
    return data.data;
  },

  create: async (input: EmployeeCreateInput) => {
    const { data } = await apiClient.post<{
      success: boolean;
      data: Employee;
    }>('/employees', input);
    return data.data;
  },

  update: async (id: string, input: EmployeeUpdateInput) => {
    const { data } = await apiClient.put<{
      success: boolean;
      data: Employee;
    }>(`/employees/${id}`, input);
    return data.data;
  },
};
