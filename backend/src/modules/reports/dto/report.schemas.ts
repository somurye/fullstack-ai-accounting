import { z } from 'zod';

/**
 * reports モジュールのクエリパラメータバリデーションスキーマ。
 * `docs/openapi.yaml` の `/reports/trial-balance`, `/reports/pl`, `/reports/bs` に対応する。
 */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const trialBalanceQuerySchema = z.object({
  fiscal_period_id: z.string().uuid().optional(),
  date_from: z.string().regex(DATE_ONLY_RE).optional(),
  date_to: z.string().regex(DATE_ONLY_RE).optional(),
});
export type TrialBalanceQuery = z.infer<typeof trialBalanceQuerySchema>;

export const plQuerySchema = z.object({
  fiscal_year_id: z.string().uuid().optional(),
  date_from: z.string().regex(DATE_ONLY_RE).optional(),
  date_to: z.string().regex(DATE_ONLY_RE).optional(),
});
export type PlQuery = z.infer<typeof plQuerySchema>;

export const bsQuerySchema = z.object({
  as_of_date: z.string().regex(DATE_ONLY_RE, 'as_of_date is YYYY-MM-DD形式で指定してください'),
});
export type BsQuery = z.infer<typeof bsQuerySchema>;

export const cashFlowQuerySchema = z.object({
  fiscal_year_id: z.string().uuid().optional(),
  date_from: z.string().regex(DATE_ONLY_RE).optional(),
  date_to: z.string().regex(DATE_ONLY_RE).optional(),
});
export type CashFlowQuery = z.infer<typeof cashFlowQuerySchema>;
