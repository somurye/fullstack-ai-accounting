import { z } from 'zod';

/**
 * consumption-tax-returns モジュールのリクエストバリデーションスキーマ。
 * `docs/openapi.yaml` の `POST /consumption-tax-returns` リクエストボディに対応する。
 */

export const TAX_FILING_METHODS = ['general', 'simplified', 'twenty_percent_special'] as const;

export const consumptionTaxReturnCreateSchema = z.object({
  fiscal_year_id: z.string().uuid(),
  filing_method: z.enum(TAX_FILING_METHODS),
});
export type ConsumptionTaxReturnCreateInput = z.infer<typeof consumptionTaxReturnCreateSchema>;

export const consumptionTaxReturnListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});
export type ConsumptionTaxReturnListQuery = z.infer<typeof consumptionTaxReturnListQuerySchema>;
