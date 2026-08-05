import { z } from 'zod';

/**
 * `docs/openapi.yaml` では `POST /departments` と `PATCH /departments/{id}` の
 * 両方が同じ `DepartmentCreate` スキーマを参照している(tax-categories/customers/vendors
 * と同様、PATCHも全項目指定の置換として定義されている)。
 */
export const departmentCreateSchema = z.object({
  code: z.string().min(1, 'codeは必須です'),
  name: z.string().min(1, 'nameは必須です'),
  is_active: z.boolean().default(true),
});
export type DepartmentCreateInput = z.infer<typeof departmentCreateSchema>;
