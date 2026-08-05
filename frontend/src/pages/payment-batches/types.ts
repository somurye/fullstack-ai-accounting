import type { components } from '../../types/api.generated';

export type PaymentBatch = components['schemas']['PaymentBatch'];
export type PaymentBatchItem = components['schemas']['PaymentBatchItem'];
export type PaymentBatchStatus = components['schemas']['PaymentBatchStatus'];

export interface PaymentBatchDetail extends PaymentBatch {
  download_url?: string | null;
}

export interface PaymentBatchListParams {
  page?: number;
  page_size?: number;
  status?: PaymentBatchStatus;
}

export type PaymentBatchSourceType = 'vendor_bill' | 'expense_reimbursement' | 'payroll';

export interface ExportZenginSource {
  source_type: PaymentBatchSourceType;
  source_id: string;
}

export interface ExportZenginRequest {
  payment_date: string;
  sources: ExportZenginSource[];
}

export const PAYMENT_BATCH_STATUS_LABEL: Record<PaymentBatchStatus, string> = {
  draft: '下書き',
  exported: 'FBデータ出力済み',
  completed: '完了',
  cancelled: '取消',
};
