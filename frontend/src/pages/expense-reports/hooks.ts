import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import {
  addExpenseReportLine,
  approveExpenseReport,
  createExpenseReport,
  extractExpenseReportOcr,
  fetchExpenseCategories,
  fetchExpenseReport,
  fetchExpenseReports,
  rejectExpenseReport,
} from './api';
import type { ExpenseReportCreate, ExpenseReportLineCreate, ExpenseReportListParams } from './types';

const EXPENSE_REPORTS_KEY = 'expense-reports';

export function useExpenseReports(params: ExpenseReportListParams) {
  return useQuery({
    queryKey: [EXPENSE_REPORTS_KEY, 'list', params],
    queryFn: () => fetchExpenseReports(params),
  });
}

export function useExpenseReport(id: string | undefined) {
  return useQuery({
    queryKey: [EXPENSE_REPORTS_KEY, 'detail', id],
    queryFn: () => fetchExpenseReport(id as string),
    enabled: Boolean(id),
  });
}

export function useExpenseCategories() {
  return useQuery({
    queryKey: ['expense-categories'],
    queryFn: fetchExpenseCategories,
    staleTime: 5 * 60_000,
  });
}

export function useCreateExpenseReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ExpenseReportCreate) => createExpenseReport(payload),
    onSuccess: (report) => {
      queryClient.invalidateQueries({ queryKey: [EXPENSE_REPORTS_KEY, 'list'] });
      toast.success(`経費申請 ${report.report_no} を提出しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useAddExpenseReportLine(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ExpenseReportLineCreate) => addExpenseReportLine(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [EXPENSE_REPORTS_KEY, 'detail', id] });
      queryClient.invalidateQueries({ queryKey: [EXPENSE_REPORTS_KEY, 'list'] });
      // 摘要付きで追加した場合、バックエンドがAI提案(勘定科目再推薦)を生成するため、
      // そのキャッシュも合わせて無効化しないと新しい提案バッジが表示されない。
      queryClient.invalidateQueries({ queryKey: ['ai-suggestions'] });
      toast.success('経費明細を追加しました');
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

/**
 * レシートOCR解析。成功/失敗のトーストは呼び出し側(プレビューカードの表示/再試行導線)に
 * 委ねるため、ここでは`ai-suggestions`一覧キャッシュの無効化のみ行う。
 */
export function useExtractExpenseReportOcr() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, expenseReportId }: { file: File; expenseReportId: string }) =>
      extractExpenseReportOcr(file, expenseReportId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-suggestions'] });
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useApproveExpenseReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, comment }: { id: string; comment?: string }) => approveExpenseReport(id, comment),
    onSuccess: (report) => {
      queryClient.invalidateQueries({ queryKey: [EXPENSE_REPORTS_KEY] });
      toast.success(
        report.status === 'approved'
          ? `経費申請 ${report.report_no} を承認し、仕訳を確定しました`
          : `経費申請 ${report.report_no} を承認しました`,
      );
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useRejectExpenseReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) => rejectExpenseReport(id, comment),
    onSuccess: (report) => {
      queryClient.invalidateQueries({ queryKey: [EXPENSE_REPORTS_KEY] });
      toast.success(`経費申請 ${report.report_no} を却下しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}
