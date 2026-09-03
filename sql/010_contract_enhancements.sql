-- ============================================================================
-- 010_contract_enhancements.sql
-- 契約書承認ルールの明示的自動承認フラグ & テナント整合性ガードトリガー (Phase 1: P1-T1-FIX)
--
-- 目的:
--   1. MAJOR-01: approval_rules に is_explicit_auto_approve 列を追加し、
--      「承認ルール未設定」と「0-step 明示的自動承認」を厳格に区別可能にする。
--   2. MAJOR-02: contracts.tenant_id と FK先 (attachment_id / created_by) の
--      テナント整合性を検証する DB トリガーを作成し、DB 制約を最終防衛線とする。
-- ============================================================================

-- 1. approval_rules: 明示的自動承認フラグの追加
ALTER TABLE approval_rules
    ADD COLUMN IF NOT EXISTS is_explicit_auto_approve BOOLEAN NOT NULL DEFAULT FALSE;

-- step_number の CHECK 制約を step_number >= 0 に更新 (0 は明示的自動承認用)
ALTER TABLE approval_rules DROP CONSTRAINT IF EXISTS approval_rules_step_number_check;
ALTER TABLE approval_rules ADD CONSTRAINT approval_rules_step_number_check CHECK (step_number >= 0);

-- approver_role_id / approver_user_id の必須制約を、is_explicit_auto_approve = TRUE の場合は不要に緩和
ALTER TABLE approval_rules DROP CONSTRAINT IF EXISTS approval_rules_check;
ALTER TABLE approval_rules DROP CONSTRAINT IF EXISTS approval_rules_approver_check;
ALTER TABLE approval_rules ADD CONSTRAINT approval_rules_approver_check
    CHECK (is_explicit_auto_approve = TRUE OR approver_role_id IS NOT NULL OR approver_user_id IS NOT NULL);


-- 2. contracts: テナント整合性ガードトリガー (MAJOR-02)
CREATE OR REPLACE FUNCTION fn_validate_contract_tenant_consistency()
RETURNS TRIGGER AS $$
BEGIN
    -- 2.1 attachment_id が指定されている場合、参照先 attachments の tenant_id と一致することを検証
    IF NEW.attachment_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM attachments
            WHERE id = NEW.attachment_id AND tenant_id = NEW.tenant_id
        ) THEN
            RAISE EXCEPTION 'attachment % does not belong to tenant %',
                NEW.attachment_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    -- 2.2 created_by ユーザーが当該テナント (tenant_users) に所属していることを検証
    IF NEW.created_by IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM tenant_users
            WHERE tenant_id = NEW.tenant_id AND user_id = NEW.created_by
        ) THEN
            RAISE EXCEPTION 'created_by user % is not a member of tenant %',
                NEW.created_by, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_contract_tenant_consistency ON contracts;
CREATE TRIGGER trg_validate_contract_tenant_consistency
    BEFORE INSERT OR UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION fn_validate_contract_tenant_consistency();
