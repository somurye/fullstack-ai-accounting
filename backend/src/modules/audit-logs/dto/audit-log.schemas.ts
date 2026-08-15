import { z } from 'zod';

/**
 * audit-logs モジュールのリクエストバリデーションスキーマ。
 * `docs/openapi.yaml` の `GET /audit-logs` クエリパラメータに対応する。
 * 書き込みAPIは提供しない(`AuditLogsService.record()` はサービス間呼び出し専用)。
 */

// `YYYY-MM-DD` または ISO 8601 日時(オフセット有無を問わない)を許容する。
// `<input type="datetime-local">` はオフセット無しの値を送るため `z.string().datetime()` は使えない。
const DATE_OR_DATETIME_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * 実際に `auditLogs.record({ targetType: ... })` で使用されている値のホワイトリスト
 * (`AUDIT_LOG_TARGET_NAME_EXPR` の`CASE`分岐と対応させている)。未知の値を受け付けると
 * `target_name` が常にNULLになる無意味な検索になるため、フロントのドロップダウンと
 * ここで選択肢を揃える。
 */
export const AUDIT_TARGET_TYPES = [
  'journal_entry',
  'expense_report',
  'invoice',
  'vendor_bill',
  'bank_transaction',
  'bank_account',
  'payroll_import',
  'fixed_asset',
  'consumption_tax_return',
  'payment_batch',
  'external_access_grant',
  'attachment',
  'tenant',
  'user',
] as const;

export const auditLogListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  target_type: z.enum(AUDIT_TARGET_TYPES).optional(),
  target_id: z.string().uuid().optional(),
  actor_user_id: z.string().uuid().optional(),
  /** 操作者名の部分一致(ILIKE)。`actor_user_id`と併用した場合は両方の条件がANDで適用される */
  actor_name: z.string().trim().min(1).optional(),
  /** 操作者名・対象名・対象IDの部分一致によるフリーワード検索 */
  keyword: z.string().trim().min(1).optional(),
  occurred_from: z.string().regex(DATE_OR_DATETIME_RE).optional(),
  occurred_to: z.string().regex(DATE_OR_DATETIME_RE).optional(),
});
export type AuditLogListQuery = z.infer<typeof auditLogListQuerySchema>;
