import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import { useAccounts, useDepartments, useTaxCategories } from '../journal-entries/hooks';
import {
  createVendorBill,
  fetchVendorBill,
  fetchVendorBills,
  fetchVendors,
  recordVendorBillPayment,
  submitVendorBill,
} from './api';
import type { VendorBillCreate, VendorBillListParams } from './types';

const VENDOR_BILLS_KEY = 'vendor-bills';

export { useAccounts, useDepartments, useTaxCategories };

export function useVendorBills(params: VendorBillListParams) {
  return useQuery({
    queryKey: [VENDOR_BILLS_KEY, 'list', params],
    queryFn: () => fetchVendorBills(params),
  });
}

export function useVendorBill(id: string | undefined) {
  return useQuery({
    queryKey: [VENDOR_BILLS_KEY, 'detail', id],
    queryFn: () => fetchVendorBill(id as string),
    enabled: Boolean(id),
  });
}

export function useVendors() {
  return useQuery({ queryKey: ['vendors'], queryFn: fetchVendors, staleTime: 5 * 60_000 });
}

export function useCreateVendorBill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: VendorBillCreate) => createVendorBill(payload),
    onSuccess: (vendorBill) => {
      queryClient.invalidateQueries({ queryKey: [VENDOR_BILLS_KEY, 'list'] });
      toast.success(`仕入請求書 ${vendorBill.bill_no} を下書きとして作成しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useSubmitVendorBill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => submitVendorBill(id),
    onSuccess: (vendorBill) => {
      queryClient.invalidateQueries({ queryKey: [VENDOR_BILLS_KEY] });
      const message =
        vendorBill.status === 'approved'
          ? `仕入請求書 ${vendorBill.bill_no} を提出し、承認不要のため買掛金計上仕訳を確定しました`
          : `仕入請求書 ${vendorBill.bill_no} を提出しました(承認待ち)`;
      toast.success(message);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useRecordVendorBillPayment() {
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
    }) => recordVendorBillPayment(id, { payment_date, amount, bank_transaction_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [VENDOR_BILLS_KEY] });
      toast.success('支払消込を登録しました');
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}
