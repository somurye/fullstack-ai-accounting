import { z } from 'zod';

/**
 * `docs/openapi.yaml` では `POST /auto-journal-rules` と `PATCH /auto-journal-rules/{id}` の
 * 両方が同じ `AutoJournalRuleCreate` スキーマを参照している(全項目指定の置換として定義)。
 *
 * ルール評価の解釈(スキーマ・仕様に明記が無いため実装上の規約として定める。
 * `bank-transactions.service.ts` の `tryAutoMatchByRules` 参照):
 *   - `priority` は数値が小さいほど優先して評価する。
 *   - 入金(amount > 0)には `credit_account_id`、出金(amount < 0)には `debit_account_id` を
 *     銀行口座側の相手勘定として使用する。該当する側が未設定のルールは、その入出金方向には
 *     適用しない(スキップして次のルールを評価する)。
 */
export const autoJournalRuleCreateSchema = z.object({
  rule_name: z.string().min(1, 'rule_nameは必須です'),
  priority: z.number().int().default(100),
  source: z.enum(['bank', 'card']),
  match_pattern: z.string().min(1, 'match_patternは必須です'),
  min_amount: z.number().optional(),
  max_amount: z.number().optional(),
  debit_account_id: z.string().uuid().optional(),
  credit_account_id: z.string().uuid().optional(),
});
export type AutoJournalRuleCreateInput = z.infer<typeof autoJournalRuleCreateSchema>;

export const autoJournalRuleListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(200),
  source: z.enum(['bank', 'card']).optional(),
  // 【注意】 `z.coerce.boolean()` はJSの `Boolean(str)` を使うため、クエリ文字列
  // `?is_active=false` も(空文字列でない限り)truthyな `true` に化ける既知の罠がある。
  // `accounts`/`ai-suggestions`/`expense-reports` の各モジュールに同種の既存バグが
  // 残っているが、本モジュールでは新規作成にあたり正しく文字列比較で解決する。
  is_active: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});
export type AutoJournalRuleListQuery = z.infer<typeof autoJournalRuleListQuerySchema>;
