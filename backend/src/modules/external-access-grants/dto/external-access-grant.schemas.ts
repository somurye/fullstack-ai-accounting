import { z } from 'zod';

/**
 * external-access-grants モジュールのリクエストバリデーションスキーマ。
 * `docs/openapi.yaml` の `ExternalAccessGrantCreate` に対応する。
 */

export const externalAccessGrantListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});
export type ExternalAccessGrantListQuery = z.infer<typeof externalAccessGrantListQuerySchema>;

export const externalAccessGrantCreateSchema = z
  .object({
    user_id: z.string().uuid(),
    valid_from: z.string().min(1, 'valid_fromを指定してください'),
    valid_until: z.string().min(1, 'valid_untilを指定してください'),
    can_export: z.boolean().optional().default(false),
  })
  .refine((v) => new Date(v.valid_until).getTime() > new Date(v.valid_from).getTime(), {
    message: 'valid_untilはvalid_fromより後の日時を指定してください',
    path: ['valid_until'],
  });
export type ExternalAccessGrantCreateInput = z.infer<typeof externalAccessGrantCreateSchema>;
