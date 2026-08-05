import { z } from 'zod';

/**
 * ai-suggestions モジュールのリクエストバリデーションスキーマ。
 * `docs/openapi.yaml` の `AiSuggestion` 系エンドポイントに対応する。
 */

export const AI_SUGGESTION_TARGET_TYPES = [
  'journal_entry',
  'expense_report_line',
  'bank_transaction',
  'vendor_bill',
  'expense_report',
] as const;

export const AI_SUGGESTION_TYPES = [
  'account_code',
  'tax_category',
  'reconciliation_match',
  'anomaly_flag',
  'ocr',
] as const;

/**
 * `accepted` はboolean検索パラメータだが、`z.coerce.boolean()` は
 * `Boolean("false")` が `true` になる既知の罠があるため使用しない
 * (クエリ文字列 "false" が空文字でない以上、素朴なcoerceは常にtrueへ倒れる)。
 * ここでは "true"/"false" の文字列を明示的に判定する。
 */
const booleanQueryParam = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const aiSuggestionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  target_type: z.enum(AI_SUGGESTION_TARGET_TYPES).optional(),
  target_id: z.string().uuid().optional(),
  suggestion_type: z.enum(AI_SUGGESTION_TYPES).optional(),
  accepted: booleanQueryParam,
});
export type AiSuggestionListQuery = z.infer<typeof aiSuggestionListQuerySchema>;

export const aiSuggestionRejectSchema = z.object({
  reason: z.string().optional(),
});
export type AiSuggestionRejectInput = z.infer<typeof aiSuggestionRejectSchema>;
