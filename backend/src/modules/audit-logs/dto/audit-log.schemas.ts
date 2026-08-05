import { z } from 'zod';

/**
 * audit-logs モジュールのリクエストバリデーションスキーマ。
 * `docs/openapi.yaml` の `GET /audit-logs` クエリパラメータに対応する。
 * 書き込みAPIは提供しない(`AuditLogsService.record()` はサービス間呼び出し専用)。
 */

// `YYYY-MM-DD` または ISO 8601 日時(オフセット有無を問わない)を許容する。
// `<input type="datetime-local">` はオフセット無しの値を送るため `z.string().datetime()` は使えない。
const DATE_OR_DATETIME_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

export const auditLogListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  target_type: z.string().optional(),
  target_id: z.string().uuid().optional(),
  actor_user_id: z.string().uuid().optional(),
  occurred_from: z.string().regex(DATE_OR_DATETIME_RE).optional(),
  occurred_to: z.string().regex(DATE_OR_DATETIME_RE).optional(),
});
export type AuditLogListQuery = z.infer<typeof auditLogListQuerySchema>;
