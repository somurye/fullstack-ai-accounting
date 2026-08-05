import { z } from 'zod';

/**
 * fixed-assets モジュールのリクエストバリデーションスキーマ。
 * `docs/openapi.yaml` の `FixedAssetCreate` 等に対応する。
 */

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const FIXED_ASSET_STATUSES = ['active', 'disposed', 'sold'] as const;
export const DEPRECIATION_METHODS = ['straight_line', 'declining_balance'] as const;
export const DISPOSAL_TYPES = ['disposed', 'sold'] as const;

export const fixedAssetCreateSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional(),
  acquisition_date: z.string().regex(DATE_ONLY_RE, 'acquisition_date is YYYY-MM-DD形式で指定してください'),
  acquisition_cost: z.number().positive(),
  useful_life_years: z.number().int().positive(),
  depreciation_method: z.enum(DEPRECIATION_METHODS),
  salvage_value: z.number().min(0).default(0),
  department_id: z.string().uuid().optional(),
  asset_account_id: z.string().uuid(),
  depreciation_expense_account_id: z.string().uuid(),
});
export type FixedAssetCreateInput = z.infer<typeof fixedAssetCreateSchema>;

export const fixedAssetListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(FIXED_ASSET_STATUSES).optional(),
});
export type FixedAssetListQuery = z.infer<typeof fixedAssetListQuerySchema>;

export const fixedAssetDisposeSchema = z.object({
  disposal_date: z.string().regex(DATE_ONLY_RE, 'disposal_date is YYYY-MM-DD形式で指定してください'),
  disposal_type: z.enum(DISPOSAL_TYPES),
  proceeds_amount: z.number().min(0).default(0),
});
export type FixedAssetDisposeInput = z.infer<typeof fixedAssetDisposeSchema>;

export const depreciationRunSchema = z.object({
  fiscal_period_id: z.string().uuid(),
  asset_ids: z.array(z.string().uuid()).optional(),
});
export type DepreciationRunInput = z.infer<typeof depreciationRunSchema>;
