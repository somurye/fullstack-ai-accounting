import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import { useAccounts, useTaxCategories } from '../journal-entries/hooks';
import {
  createCreditNote,
  createInvoice,
  fetchCustomers,
  fetchInvoice,
  fetchInvoices,
  issueInvoice,
  recordInvoicePayment,
  updateInvoice,
  voidInvoice,
} from './api';
import type { InvoiceCreate, InvoiceListParams } from './types';

const INVOICES_KEY = 'invoices';

export { useAccounts, useTaxCategories };

export function useInvoices(params: InvoiceListParams) {
  return useQuery({
    queryKey: [INVOICES_KEY, 'list', params],
    queryFn: () => fetchInvoices(params),
  });
}

export function useInvoice(id: string | undefined) {
  return useQuery({
    queryKey: [INVOICES_KEY, 'detail', id],
    queryFn: () => fetchInvoice(id as string),
    enabled: Boolean(id),
  });
}

export function useCustomers() {
  return useQuery({ queryKey: ['customers'], queryFn: fetchCustomers, staleTime: 5 * 60_000 });
}

export function useCreateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: InvoiceCreate) => createInvoice(payload),
    onSuccess: (invoice) => {
      queryClient.invalidateQueries({ queryKey: [INVOICES_KEY, 'list'] });
      toast.success(`請求書 ${invoice.invoice_no} を下書きとして作成しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useUpdateInvoice(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: InvoiceCreate) => updateInvoice(id, payload),
    onSuccess: (invoice) => {
      queryClient.invalidateQueries({ queryKey: [INVOICES_KEY, 'list'] });
      queryClient.invalidateQueries({ queryKey: [INVOICES_KEY, 'detail', id] });
      toast.success(`請求書 ${invoice.invoice_no} を更新しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useIssueInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => issueInvoice(id),
    onSuccess: (invoice) => {
      queryClient.invalidateQueries({ queryKey: [INVOICES_KEY] });
      toast.success(`請求書 ${invoice.invoice_no} を発行し、売上計上仕訳を確定しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useVoidInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => voidInvoice(id),
    onSuccess: (invoice) => {
      queryClient.invalidateQueries({ queryKey: [INVOICES_KEY] });
      toast.success(`請求書 ${invoice.invoice_no} を取消しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useRecordInvoicePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payment_date,
      amount,
      bank_transaction_id,
    }: {
      id: string;
      payment_date: string;
      amount: number;
      bank_transaction_id?: string;
    }) => recordInvoicePayment(id, { payment_date, amount, bank_transaction_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [INVOICES_KEY] });
      toast.success('入金消込を登録しました');
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useCreateCreditNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amount, reason }: { id: string; amount: number; reason: string }) =>
      createCreditNote(id, { amount, reason }),
    onSuccess: (creditNote) => {
      queryClient.invalidateQueries({ queryKey: [INVOICES_KEY] });
      toast.success(`クレジットノート ${creditNote.credit_note_no} を起票しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}
