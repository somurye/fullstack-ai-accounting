import type { components } from '../../types/api.generated';

export interface SuggestedField<T = unknown> {
  value: T;
  confidence: number;
  rationale?: string;
}

/**
 * `payload` はopenapi.yaml上 `suggested_account_code` / `candidates` (code/score) / `suggested_fields` 等を
 * 定義している。バックエンド実装ではJSONB列の柔軟性を活かし、汎用構造化提案やドメイン固有コンテキストを追加で格納している。
 */
export type AiSuggestion = Omit<components['schemas']['AiSuggestion'], 'payload'> & {
  payload?: {
    document_type?: string;
    suggested_fields?: Record<string, SuggestedField>;

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
    [key: string]: unknown;
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
  contract: '契約書',
  attachment: '添付ファイル・証憑',
  purchase_request: '購買稟議',
};

export const SUGGESTION_TYPE_LABEL: Record<AiSuggestionType, string> = {
  account_code: '勘定科目推測',
  tax_category: '税区分推測',
  reconciliation_match: '照合マッチング',
  anomaly_flag: '異常検知',
  ocr: 'レシートOCR抽出',
  contract_terms: '契約条項抽出',
  generic_fields: '汎用項目抽出',
};

export const TARGET_LINK: Partial<Record<AiSuggestionTargetType, (targetId: string) => string>> = {
  journal_entry: (targetId) => `/journal-entries/${targetId}`,
  expense_report_line: () => `/expense-reports`,
  expense_report: (targetId) => `/expense-reports/${targetId}`,
  attachment: () => `/attachments`,
  contract: () => `/contracts`,
  purchase_request: () => `/purchase-requests`,
};

export const FIELD_LABEL_MAP: Record<string, string> = {
  contract_title: '契約書名',
  contract_parties: '当事者 (甲/乙)',
  contract_start_date: '契約開始日',
  contract_end_date: '契約終了日',
  contract_amount: '契約金額',
  auto_renewal: '自動更新条項',
  governing_law_jurisdiction: '準拠法・管轄裁判所',
  notice_period_days: '解約予告期間(日数)',
  item_name: '品名・品目',
  estimated_price: '概算金額',
  supplier_name: '取引先・サプライヤー名',
  delivery_deadline: '希望納期',
};
