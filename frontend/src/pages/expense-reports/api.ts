import { apiClient } from '../../lib/apiClient';
import type { components } from '../../types/api.generated';
import type {
  ExpenseCategory,
  ExpenseReportCreate,
  ExpenseReportDetail,
  ExpenseReportLine,
  ExpenseReportLineCreate,
  ExpenseReportListParams,
  ExpenseReportOcrResult,
} from './types';

type Meta = components['schemas']['Meta'];

export interface ExpenseReportListResult {
  reports: ExpenseReportDetail[];
  meta: Meta | undefined;
}

interface ExpenseCategoryListResponse {
  success: true;
  data: ExpenseCategory[];
  meta?: Meta;
}

export async function fetchExpenseReports(
  params: ExpenseReportListParams,
): Promise<ExpenseReportListResult> {
  const { data } = await apiClient.get<{ success: true; data: ExpenseReportDetail[]; meta?: Meta }>(
    '/expense-reports',
    { params },
  );
  return { reports: data.data ?? [], meta: data.meta };
}

export async function fetchExpenseReport(id: string): Promise<ExpenseReportDetail> {
  const { data } = await apiClient.get<{ success: true; data: ExpenseReportDetail; meta?: Meta }>(
    `/expense-reports/${id}`,
  );
  if (!data.data) throw new Error('経費申請データを取得できませんでした');
  return data.data;
}

export async function createExpenseReport(payload: ExpenseReportCreate): Promise<ExpenseReportDetail> {
  const { data } = await apiClient.post<{ success: true; data: ExpenseReportDetail; meta?: Meta }>(
    '/expense-reports',
    payload,
  );
  if (!data.data) throw new Error('経費申請の作成に失敗しました');
  return data.data;
}

export async function addExpenseReportLine(
  id: string,
  payload: ExpenseReportLineCreate,
): Promise<ExpenseReportLine> {
  const { data } = await apiClient.post<{ success: true; data: ExpenseReportLine; meta?: Meta }>(
    `/expense-reports/${id}/lines`,
    payload,
  );
  if (!data.data) throw new Error('経費明細の追加に失敗しました');
  return data.data;
}

export async function approveExpenseReport(
  id: string,
  comment?: string,
): Promise<ExpenseReportDetail> {
  const { data } = await apiClient.post<{ success: true; data: ExpenseReportDetail; meta?: Meta }>(
    `/expense-reports/${id}/approve`,
    { comment },
  );
  if (!data.data) throw new Error('経費申請の承認に失敗しました');
  return data.data;
}

export async function rejectExpenseReport(id: string, comment: string): Promise<ExpenseReportDetail> {
  const { data } = await apiClient.post<{ success: true; data: ExpenseReportDetail; meta?: Meta }>(
    `/expense-reports/${id}/reject`,
    { comment },
  );
  if (!data.data) throw new Error('経費申請の却下に失敗しました');
  return data.data;
}

export async function extractExpenseReportOcr(
  file: File,
  expenseReportId: string,
): Promise<ExpenseReportOcrResult> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('expense_report_id', expenseReportId);

  const { data } = await apiClient.post<{ success: true; data: ExpenseReportOcrResult; meta?: Meta }>(
    '/expense-reports/ocr',
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  if (!data.data) throw new Error('レシートのOCR解析に失敗しました');
  return data.data;
}

export async function fetchExpenseCategories(): Promise<ExpenseCategory[]> {
  const { data } = await apiClient.get<ExpenseCategoryListResponse>('/expense-categories', {
    params: { page_size: 200 },
  });
  return data.data ?? [];
}
