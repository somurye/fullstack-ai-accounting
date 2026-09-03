-- ============================================================================
-- 011_ai_suggestions_generic_types.sql
-- AI提案(ai_suggestions)のtarget_typeおよびsuggestion_typeの拡張
--
-- 背景・目的:
-- P0-T3で導入された契約書・購買等の汎用AI提案(contract_terms, generic_fields)
-- および P1-T2(契約書条項抽出)の稼働に伴い、ai_suggestionsテーブルの
-- target_type / suggestion_type CHECK制約を拡張する。
-- AI提案の隔離領域原則(WORM、contractsへの直接確定書き込み禁止)は維持。
-- ============================================================================

-- 1. target_type CHECK制約の更新
ALTER TABLE ai_suggestions
    DROP CONSTRAINT IF EXISTS ai_suggestions_target_type_check;

ALTER TABLE ai_suggestions
    ADD CONSTRAINT ai_suggestions_target_type_check
    CHECK (target_type IN (
        'journal_entry',
        'expense_report_line',
        'bank_transaction',
        'vendor_bill',
        'expense_report',
        'contract',
        'attachment',
        'purchase_request'
    ));

-- 2. suggestion_type CHECK制約の更新
ALTER TABLE ai_suggestions
    DROP CONSTRAINT IF EXISTS ai_suggestions_suggestion_type_check;

ALTER TABLE ai_suggestions
    ADD CONSTRAINT ai_suggestions_suggestion_type_check
    CHECK (suggestion_type IN (
        'account_code',
        'tax_category',
        'reconciliation_match',
        'anomaly_flag',
        'ocr',
        'contract_terms',
        'generic_fields'
    ));
