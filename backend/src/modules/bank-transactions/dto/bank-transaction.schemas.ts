import { z } from 'zod';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const BANK_MATCH_STATUSES = [
  'unmatched',
  'auto_matched',
  'manually_matched',
  'reconciled',
  'ignored',
] as const;

export const bankTransactionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  bank_account_id: z.string().uuid().optional(),
  match_status: z.enum(BANK_MATCH_STATUSES).optional(),
  transaction_date_from: z.string().regex(DATE_ONLY_RE).optional(),
  transaction_date_to: z.string().regex(DATE_ONLY_RE).optional(),
});
export type BankTransactionListQuery = z.infer<typeof bankTransactionListQuerySchema>;

/** `POST /bank-transactions/import-csv` はmultipart/form-dataのため、file以外は文字列で届く。 */
export const bankTransactionImportCsvFieldsSchema = z.object({
  bank_account_id: z.string().uuid('bank_account_idはUUID形式で指定してください'),
  import_profile_id: z.string().uuid().optional(),
});
export type BankTransactionImportCsvFields = z.infer<typeof bankTransactionImportCsvFieldsSchema>;

/**
 * `POST /bank-transactions/{id}/match`
 *
 * `docs/openapi.yaml` は `target_type`+`target_id`(既存の請求書/仕入請求書/仕訳への手動紐付け)
 * のみを定義しているが、本タスクで要求されたルールエンジン評価・AI提案採用フローを
 * 同一エンドポイントの拡張として以下のように定義する(いずれもoptional、排他的に解釈する):
 *   - `{ target_type, target_id }` … 仕様通りの手動紐付け
 *   - `{ account_id }`             … 指定した勘定科目(AI提案の採用等)で消込仕訳を作成
 *   - `{}` (未指定)                … 自動仕訳ルールを評価。適合すれば自動起票、
 *                                    不適合ならAI提案(pgvector類似度検索)を生成する
 */
export const bankTransactionMatchSchema = z
  .object({
    target_type: z.enum(['invoice', 'vendor_bill', 'journal_entry']).optional(),
    target_id: z.string().uuid().optional(),
    account_id: z.string().uuid().optional(),
  })
  .refine((v) => !v.target_type === !v.target_id, {
    message: 'target_typeとtarget_idは両方指定するか、両方省略してください',
  })
  .refine((v) => !(v.target_type && v.account_id), {
    message: 'target_type/target_idとaccount_idは同時に指定できません',
  });
export type BankTransactionMatchInput = z.infer<typeof bankTransactionMatchSchema>;
