import type { ZodType, ZodTypeDef } from 'zod';
import { AppException, type ErrorDetail } from '../exceptions/app.exception';

/**
 * リクエストのbody/queryをzodスキーマで検証する共通ヘルパー。
 * 失敗時は `AppException.badRequest` に変換し、`docs/openapi.yaml` の
 * `ApiError.details` 形式(`{ field, message }[]`)へ整形する。
 *
 * 【型引数の注意】`ZodSchema<T>`(= `ZodType<T, ZodTypeDef, T>`)をそのまま使うと、
 * Tが出力(Output)位置と入力(Input, 反変)位置の両方に現れるため、
 * `.default()` 等でOutput/Inputが異なるスキーマを渡した際にTが
 * 意図せず「省略可能な入力型」側へ推論されてしまう(zodのよく知られた挙動)。
 * Input型パラメータを`any`に固定してこの共変/反変の衝突を避けている。
 */
export function parseWithZod<T>(schema: ZodType<T, ZodTypeDef, any>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const details: ErrorDetail[] = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || undefined,
      message: issue.message,
    }));
    throw AppException.badRequest('リクエスト内容が不正です', details);
  }
  return result.data;
}
