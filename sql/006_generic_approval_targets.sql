-- ============================================================================
-- 006_generic_approval_targets.sql
-- 汎用承認ワークフローの拡張: contract (契約書), purchase_request (購買稟議) を許可
--
-- 背景・目的:
-- keiri-kaikei の全社バックオフィス統合SaaS拡張(Phase 0)に伴い、
-- approval_rules および approval_requests の target_type に
-- 'contract' (契約書) および 'purchase_request' (購買稟議) を追加する。
-- approval_requests / approval_history のテーブル列構成や RLS、
-- fn_prevent_self_approval() トリガーによる職務分掌ガードはそのまま維持する。
--
-- 【テーブル駆動 vs CHECK制約の設計判断】
-- 現段階ではテーブル構造を不可侵とし、高速な値検証が可能な CHECK 制約の更新を採用する。
-- 将来テナントごとの動的カスタム target_type や詳細なワークフロー定義が必要となった場合は、
-- approval_target_types マスタテーブルを作成して FK 参照するテーブル駆動型への移行が可能。
-- ============================================================================

-- 1. approval_rules の target_type CHECK 制約更新
ALTER TABLE approval_rules
    DROP CONSTRAINT IF EXISTS approval_rules_target_type_check;

ALTER TABLE approval_rules
    ADD CONSTRAINT approval_rules_target_type_check
    CHECK (target_type IN ('journal_entry', 'expense_report', 'vendor_bill', 'contract', 'purchase_request'));

-- 2. approval_requests の target_type CHECK 制約更新
ALTER TABLE approval_requests
    DROP CONSTRAINT IF EXISTS approval_requests_target_type_check;

ALTER TABLE approval_requests
    ADD CONSTRAINT approval_requests_target_type_check
    CHECK (target_type IN ('journal_entry', 'expense_report', 'vendor_bill', 'contract', 'purchase_request'));



-- ============================================================================
-- ロールバック手順 (Down Migration):
--
-- DELETE FROM approval_history WHERE approval_request_id IN (
--     SELECT id FROM approval_requests WHERE target_type IN ('contract', 'purchase_request')
-- );
-- DELETE FROM approval_requests WHERE target_type IN ('contract', 'purchase_request');
-- DELETE FROM approval_rules WHERE target_type IN ('contract', 'purchase_request');
--
-- ALTER TABLE approval_rules DROP CONSTRAINT IF EXISTS approval_rules_target_type_check;
-- ALTER TABLE approval_rules ADD CONSTRAINT approval_rules_target_type_check
--     CHECK (target_type IN ('journal_entry', 'expense_report', 'vendor_bill'));
--
-- ALTER TABLE approval_requests DROP CONSTRAINT IF EXISTS approval_requests_target_type_check;
-- ALTER TABLE approval_requests ADD CONSTRAINT approval_requests_target_type_check
--     CHECK (target_type IN ('journal_entry', 'expense_report', 'vendor_bill'));
-- ============================================================================
