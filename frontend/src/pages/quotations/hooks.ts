import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import {
  acceptQuotation,
  convertQuotation,
  createQuotation,
  deleteQuotation,
  fetchCustomers,
  fetchQuotation,
  fetchQuotations,
  rejectQuotation,
  reviseQuotation,
  sendQuotation,
  updateQuotation,
  type QuotationListParams,
} from './api';
import type { QuotationFormInput } from './types';

export const QUOTATIONS_KEY = 'quotations';

export function useQuotations(params: QuotationListParams) {
  return useQuery({
    queryKey: [QUOTATIONS_KEY, 'list', params],
    queryFn: () => fetchQuotations(params),
  });
}

export function useQuotation(id: string | undefined) {
  return useQuery({
    queryKey: [QUOTATIONS_KEY, 'detail', id],
    queryFn: () => fetchQuotation(id as string),
    enabled: Boolean(id),
  });
}

export function useCustomers() {
  return useQuery({
    queryKey: ['customers'],
    queryFn: fetchCustomers,
    staleTime: 5 * 60_000,
  });
}

export function useCreateQuotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: QuotationFormInput) => createQuotation(payload),
    onSuccess: (quotation) => {
      queryClient.invalidateQueries({ queryKey: [QUOTATIONS_KEY] });
      toast.success(`見積書 ${quotation.quote_no} (v${quotation.version}) を作成しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useUpdateQuotation(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<QuotationFormInput>) => updateQuotation(id, payload),
    onSuccess: (quotation) => {
      queryClient.invalidateQueries({ queryKey: [QUOTATIONS_KEY] });
      toast.success(`見積書 ${quotation.quote_no} を更新しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useDeleteQuotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteQuotation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUOTATIONS_KEY] });
      toast.success('下書き見積書を削除しました');
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useSendQuotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendQuotation(id),
    onSuccess: (quotation) => {
      queryClient.invalidateQueries({ queryKey: [QUOTATIONS_KEY] });
      toast.success(`見積書 ${quotation.quote_no} を提示・確定送付しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useAcceptQuotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => acceptQuotation(id),
    onSuccess: (quotation) => {
      queryClient.invalidateQueries({ queryKey: [QUOTATIONS_KEY] });
      toast.success(`見積書 ${quotation.quote_no} を受注確定しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useRejectQuotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rejectQuotation(id),
    onSuccess: (quotation) => {
      queryClient.invalidateQueries({ queryKey: [QUOTATIONS_KEY] });
      toast.success(`見積書 ${quotation.quote_no} を失注・却下としました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useReviseQuotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string | null }) => reviseQuotation(id, notes),
    onSuccess: (newQuotation) => {
      queryClient.invalidateQueries({ queryKey: [QUOTATIONS_KEY] });
      toast.success(`改訂版見積書 ${newQuotation.quote_no} (v${newQuotation.version}) を発行しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useConvertQuotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => convertQuotation(id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [QUOTATIONS_KEY] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success(`見積書を受注転換し、売上請求書 ${result.invoiceNo} を起票しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}
