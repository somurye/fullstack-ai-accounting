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

-- 3. 新規 target_type 向けの承認ルール登録確認用テストデータ
-- (テナントが存在する場合にサンプルルールを挿入)
DO $$
DECLARE
    v_tenant_id UUID;
    v_owner_role_id UUID;
    v_mgr_role_id UUID;
BEGIN
    SELECT id INTO v_tenant_id FROM tenants LIMIT 1;
    SELECT id INTO v_owner_role_id FROM roles WHERE code = 'owner' LIMIT 1;
    SELECT id INTO v_mgr_role_id FROM roles WHERE code = 'accounting_manager' LIMIT 1;

    IF v_tenant_id IS NOT NULL AND v_owner_role_id IS NOT NULL THEN
        -- contract: 1段階承認 (管理者)
        INSERT INTO approval_rules (tenant_id, target_type, step_number, condition, approver_role_id, is_active)
        VALUES (v_tenant_id, 'contract', 1, '{"min_amount": 0}', v_owner_role_id, TRUE)
        ON CONFLICT (tenant_id, target_type, step_number, approver_role_id, approver_user_id) DO NOTHING;

        -- purchase_request: 1段階承認 (責任者または管理者)
        IF v_mgr_role_id IS NOT NULL THEN
            INSERT INTO approval_rules (tenant_id, target_type, step_number, condition, approver_role_id, is_active)
            VALUES (v_tenant_id, 'purchase_request', 1, '{"min_amount": 0}', v_mgr_role_id, TRUE)
            ON CONFLICT (tenant_id, target_type, step_number, approver_role_id, approver_user_id) DO NOTHING;
        END IF;
    END IF;
END $$;

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
