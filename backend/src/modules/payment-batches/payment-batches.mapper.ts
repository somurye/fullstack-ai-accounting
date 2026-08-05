import type { components } from '../../types/api.generated';

export type PaymentBatchDto = components['schemas']['PaymentBatch'];
export type PaymentBatchItemDto = components['schemas']['PaymentBatchItem'];

/** 全銀協FBデータ生成成功時のみ付与されるダウンロードURLを加算した拡張レスポンス型 */
export interface PaymentBatchDetailDto extends PaymentBatchDto {
  download_url?: string | null;
}

export interface PaymentBatchRow {
  id: string;
  batch_no: string;
  payment_date: string;
  batch_type: string;
  status: string;
  total_amount: string;
  file_hash: string | null;
  exported_at: Date | null;
}

export interface PaymentBatchItemRow {
  id: string;
  source_type: string;
  source_id: string;
  payee_name: string;
  amount: string;
}

export function mapPaymentBatchItemRow(row: PaymentBatchItemRow): PaymentBatchItemDto {
  return {
    id: row.id,
    source_type: row.source_type as PaymentBatchItemDto['source_type'],
    source_id: row.source_id,
    payee_name: row.payee_name,
    amount: Number(row.amount),
  };
}

export function mapPaymentBatchRow(row: PaymentBatchRow, items: PaymentBatchItemDto[]): PaymentBatchDto {
  return {
    id: row.id,
    batch_no: row.batch_no,
    payment_date: row.payment_date,
    batch_type: row.batch_type as PaymentBatchDto['batch_type'],
    status: row.status as PaymentBatchDto['status'],
    total_amount: Number(row.total_amount),
    file_hash: row.file_hash,
    exported_at: row.exported_at ? row.exported_at.toISOString() : null,
    items,
  };
}

const PAYMENT_BATCH_COLUMNS = `
  id,
  batch_no,
  TO_CHAR(payment_date, 'YYYY-MM-DD') AS payment_date,
  batch_type,
  status,
  total_amount,
  file_hash,
  exported_at
`;

const PAYMENT_BATCH_ITEM_COLUMNS = `
  id,
  source_type,
  source_id,
  payee_name,
  amount
`;

export const SQL_COLUMNS = {
  paymentBatch: PAYMENT_BATCH_COLUMNS,
  paymentBatchItem: PAYMENT_BATCH_ITEM_COLUMNS,
};
