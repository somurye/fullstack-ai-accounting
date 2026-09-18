import { z } from 'zod';

export const createRenewalDealSchema = z.object({
  contract_id: z.string().uuid('契約IDは有効なUUID形式で指定してください'),
  customer_id: z.string().uuid('顧客IDは有効なUUID形式で指定してください').optional(),
  title: z.string().trim().max(200, '商談名は200文字以内で指定してください').optional(),
  expected_amount: z.coerce.number().min(0, '予想金額は0以上で指定してください').optional(),
  expected_close_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '受注予定日はYYYY-MM-DD形式で指定してください')
    .optional()
    .nullable(),
  owner_user_id: z.string().uuid('担当者IDは有効なUUID形式で指定してください').optional().nullable(),
});

export type CreateRenewalDealInput = z.input<typeof createRenewalDealSchema>;

export interface ContractRenewalLinkDto {
  id: string;
  tenant_id: string;
  contract_id: string;
  deal_id: string | null;
  quotation_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  contract?: {
    id: string;
    contract_no: string;
    title: string;
    counterparty_name: string;
    contract_type: string;
    contract_amount: number | null;
    start_date: string;
    end_date: string | null;
    auto_renewal: boolean;
    status: string;
  };
  deal?: {
    id: string;
    title: string;
    stage: string;
    expected_amount: number;
    expected_close_date: string | null;
  };
}
