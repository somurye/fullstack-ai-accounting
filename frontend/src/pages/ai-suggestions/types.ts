import type { components } from '../../types/api.generated';

/**
 * `payload` はopenapi.yaml上 `suggested_account_code` / `candidates` (code/score)のみを
 * 明示しているが、バックエンド実装ではJSONB列の柔軟性を活かし `candidates[].name`
 * (科目名, 表示用) / `target_line_no`(仕訳対象時の反映先行番号) / `rejection_reason`
 * (不採用理由)を追加で格納している(`backend/.../ai-suggestions.mapper.ts` 参照)。
 * ここではそれらを含む拡張済みの型を定義し、生成型の代わりに使用する。
 */
export type AiSuggestion = Omit<components['schemas']['AiSuggestion'], 'payload'> & {
  payload?: {
    suggested_account_code?: string | null;
    candidates?: { code?: string; score?: number; name?: string }[];
    target_line_no?: number;
    rejection_reason?: string | null;
    /** suggestion_type='ocr' 専用フィールド(レシートOCR抽出結果) */
    transaction_date?: string | null;
    amount?: number | null;
    vendor_name?: string | null;
    invoice_registration_number?: string | null;
    suggested_account_id?: string | null;
  };
};
export type AiSuggestionTargetType = NonNullable<AiSuggestion['target_type']>;
export type AiSuggestionType = NonNullable<AiSuggestion['suggestion_type']>;

export interface AiSuggestionListParams {
  page?: number;
  page_size?: number;
  target_type?: AiSuggestionTargetType;
  target_id?: string;
  suggestion_type?: AiSuggestionType;
  accepted?: boolean;
}

export const TARGET_TYPE_LABEL: Record<AiSuggestionTargetType, string> = {
  journal_entry: '仕訳',
  expense_report_line: '経費明細',
  bank_transaction: '銀行明細',
  vendor_bill: '仕入請求書',
  expense_report: '経費精算申請',
};

export const SUGGESTION_TYPE_LABEL: Record<AiSuggestionType, string> = {
  account_code: '勘定科目推測',
  tax_category: '税区分推測',
  reconciliation_match: '照合マッチング',
  anomaly_flag: '異常検知',
  ocr: 'レシートOCR抽出',
};

export const TARGET_LINK: Partial<Record<AiSuggestionTargetType, (targetId: string) => string>> = {
  journal_entry: (targetId) => `/journal-entries/${targetId}`,
  expense_report_line: () => `/expense-reports`,
  expense_report: (targetId) => `/expense-reports/${targetId}`,
};
