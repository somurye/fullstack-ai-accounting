import { apiClient } from '../../lib/apiClient';
import type { components } from '../../types/api.generated';
import type {
  ExportZenginRequest,
  PaymentBatch,
  PaymentBatchDetail,
  PaymentBatchListParams,
} from './types';

type Meta = components['schemas']['Meta'];

export interface PaymentBatchListResult {
  paymentBatches: PaymentBatch[];
  meta: Meta | undefined;
}

export async function fetchPaymentBatches(params: PaymentBatchListParams): Promise<PaymentBatchListResult> {
  const { data } = await apiClient.get<{ success: true; data: PaymentBatch[]; meta?: Meta }>(
    '/payment-batches',
    { params },
  );
  return { paymentBatches: data.data ?? [], meta: data.meta };
}

export async function fetchPaymentBatch(id: string): Promise<PaymentBatchDetail> {
  const { data } = await apiClient.get<{ success: true; data: PaymentBatchDetail; meta?: Meta }>(
    `/payment-batches/${id}`,
  );
  if (!data.data) throw new Error('支払バッチデータを取得できませんでした');
  return data.data;
}

export async function exportZengin(payload: ExportZenginRequest): Promise<PaymentBatchDetail> {
  const { data } = await apiClient.post<{ success: true; data: PaymentBatchDetail; meta?: Meta }>(
    '/payment-batches/export-zengin',
    payload,
  );
  if (!data.data) throw new Error('全銀協FBデータの生成に失敗しました');
  return data.data;
}

/**
 * 全銀協FBデータファイルをダウンロードし、ブラウザから保存できるようにする。
 * サーバーは銀行提出用にShift-JISでエンコード済みのバイト列を返す(`Content-Type`に
 * 実際の文字コードが載る)ため、ブラウザ側で再エンコードせずバイト列をそのまま
 * blobへ渡す(テキストとして読み込むと文字コードが化けるため`responseType: 'blob'`必須)。
 */
export async function downloadPaymentBatchFile(id: string, batchNo: string): Promise<void> {
  const response = await apiClient.get(`/payment-batches/${id}/download`, { responseType: 'blob' });
  const contentType = (response.headers['content-type'] as string | undefined) ?? 'text/plain;charset=Shift_JIS';
  const blob = new Blob([response.data], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${batchNo}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
