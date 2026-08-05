import { z } from 'zod';

/**
 * `docs/openapi.yaml` では `POST /customers` と `PATCH /customers/{id}` の両方が
 * 同じ `CustomerCreate` スキーマを参照している(全項目指定の置換として定義)。
 */
export const customerCreateSchema = z.object({
  code: z.string().min(1, 'codeは必須です'),
  name: z.string().min(1, 'nameは必須です'),
  kana_name: z.string().optional(),
});
export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;
