import { apiClient } from '../../lib/apiClient';
import type {
  AttendanceListQuery,
  AttendanceRecord,
  AttendanceRecordCreateInput,
  AttendanceRecordUpdateInput,
  ClockActionInput,
  Meta,
} from './types';

export const attendanceApi = {
  clock: async (input: ClockActionInput) => {
    const { data } = await apiClient.post<{
      success: boolean;
      data: AttendanceRecord;
    }>('/attendance/clock', input);
    return data.data;
  },

  list: async (query: AttendanceListQuery = {}) => {
    const { data } = await apiClient.get<{
      success: boolean;
      data: AttendanceRecord[];
      pagination?: Meta;
    }>('/attendance/records', { params: query });
    return { records: data.data, pagination: data.pagination };
  },

  getById: async (id: string) => {
    const { data } = await apiClient.get<{
      success: boolean;
      data: AttendanceRecord;
    }>(`/attendance/records/${id}`);
    return data.data;
  },

  createRecord: async (input: AttendanceRecordCreateInput) => {
    const { data } = await apiClient.post<{
      success: boolean;
      data: AttendanceRecord;
    }>('/attendance/records', input);
    return data.data;
  },

  updateRecord: async (id: string, input: AttendanceRecordUpdateInput) => {
    const { data } = await apiClient.put<{
      success: boolean;
      data: AttendanceRecord;
    }>(`/attendance/records/${id}`, input);
    return data.data;
  },
};
