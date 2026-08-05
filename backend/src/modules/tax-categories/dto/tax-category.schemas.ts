import { z } from 'zod';

const TAX_TYPES = ['taxable', 'non_taxable', 'exempt', 'out_of_scope'] as const;

/**
 * `docs/openapi.yaml` では `POST /tax-categories` と `PATCH /tax-categories/{id}` の
 * 両方が同じ `TaxCategoryCreate` スキーマ(code/name/tax_type/tax_rate必須)を
 * requestBodyとして参照しており、PATCHも部分更新ではなく全項目指定の置換として
 * 定義されている。本実装も仕様に忠実にそのまま従う。
 */
export const taxCategoryCreateSchema = z.object({
  code: z.string().min(1, 'codeは必須です'),
  name: z.string().min(1, 'nameは必須です'),
  tax_type: z.enum(TAX_TYPES),
  tax_rate: z.number().min(0).max(100),
  is_reduced_rate: z.boolean().default(false),
});
export type TaxCategoryCreateInput = z.infer<typeof taxCategoryCreateSchema>;
