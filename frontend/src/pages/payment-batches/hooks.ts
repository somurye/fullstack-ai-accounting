import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatApiErrorMessage } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import { downloadPaymentBatchFile, exportZengin, fetchPaymentBatch, fetchPaymentBatches } from './api';
import type { ExportZenginRequest, PaymentBatchListParams } from './types';

const PAYMENT_BATCHES_KEY = 'payment-batches';

export function usePaymentBatches(params: PaymentBatchListParams) {
  return useQuery({
    queryKey: [PAYMENT_BATCHES_KEY, 'list', params],
    queryFn: () => fetchPaymentBatches(params),
  });
}

export function usePaymentBatch(id: string | undefined) {
  return useQuery({
    queryKey: [PAYMENT_BATCHES_KEY, 'detail', id],
    queryFn: () => fetchPaymentBatch(id as string),
    enabled: Boolean(id),
  });
}

export function useExportZengin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ExportZenginRequest) => exportZengin(payload),
    onSuccess: (batch) => {
      queryClient.invalidateQueries({ queryKey: [PAYMENT_BATCHES_KEY] });
      // 送金対象の仕入請求書/経費精算のステータスが変わるため、両一覧のキャッシュも無効化する。
      queryClient.invalidateQueries({ queryKey: ['vendor-bills'] });
      queryClient.invalidateQueries({ queryKey: ['expense-reports'] });
      toast.success(`支払バッチ ${batch.batch_no} の全銀協FBデータを生成しました`);
    },
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}

export function useDownloadPaymentBatchFile() {
  return useMutation({
    mutationFn: ({ id, batchNo }: { id: string; batchNo: string }) => downloadPaymentBatchFile(id, batchNo),
    onError: (error) => {
      toast.error(formatApiErrorMessage(error));
    },
  });
}
