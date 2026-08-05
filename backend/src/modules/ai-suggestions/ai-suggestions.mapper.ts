import type { components } from '../../types/api.generated';

export type AiSuggestionDto = components['schemas']['AiSuggestion'];

/**
 * `payload` は openapi.yaml 上 `suggested_account_code` / `candidates` のみを
 * 明示しているが、JSONB列でありスキーマに `additionalProperties: false` は
 * 課されていないため、本実装ではリクエストへ渡す追加コンテキストを自由に
 * 混在させている(`target_line_no`: journal_entry対象時にどの明細行へ反映するかの
 * 決定的な指定 / `rejection_reason`: 不採用理由)。
 */
export interface AiSuggestionPayload {
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
  accepted,
  created_at
`;
