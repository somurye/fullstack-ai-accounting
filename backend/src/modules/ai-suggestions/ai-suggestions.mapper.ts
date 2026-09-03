import type { components } from '../../types/api.generated';

export type AiSuggestionDto = components['schemas']['AiSuggestion'];

export interface SuggestedField<T = unknown> {
  value: T;
  confidence: number;
  rationale?: string;
}

/**
 * `payload` は openapi.yaml 上 `suggested_account_code` / `candidates` / `suggested_fields` 等を
 * 定義している。JSONB列でありスキーマに `additionalProperties: false` は
 * 課されていないため、汎用構造化提案やドメイン固有コンテキストを柔軟に保持する。
 */
export interface AiSuggestionPayload {
  document_type?: string;
  suggested_fields?: Record<string, SuggestedField>;

  suggested_account_code?: string | null;
  candidates?: { code: string; score: number; name?: string }[];
  target_line_no?: number;
  rejection_reason?: string | null;

  /** suggestion_type='ocr' 専用フィールド(レシートOCR抽出結果) */
  transaction_date?: string | null;
  amount?: number | null;
  vendor_name?: string | null;
  invoice_registration_number?: string | null;
  suggested_account_id?: string | null;

  [key: string]: unknown;
}

export interface AiSuggestionRow {
  id: string;
  tenant_id: string;
  target_type: string;
  target_id: string;
  suggestion_type: string;
  payload: AiSuggestionPayload;
  confidence_score: string | null;
  model_name: string;
  provider?: string | null;
  accepted: boolean | null;
  created_at: Date;
}

export function mapAiSuggestionRow(row: AiSuggestionRow): AiSuggestionDto {
  return {
    id: row.id,
    target_type: row.target_type as AiSuggestionDto['target_type'],
    target_id: row.target_id,
    suggestion_type: row.suggestion_type as AiSuggestionDto['suggestion_type'],
    payload: row.payload,
    confidence_score: row.confidence_score !== null ? Number(row.confidence_score) : null,
    model_name: row.model_name,
    provider: row.provider ?? 'rule_engine',
    accepted: row.accepted,
    created_at: row.created_at.toISOString(),
  };
}

export const AI_SUGGESTION_COLUMNS = `
  id,
  tenant_id,
  target_type,
  target_id,
  suggestion_type,
  payload,
  confidence_score,
  model_name,
  provider,
  accepted,
  created_at
`;
