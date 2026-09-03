-- ============================================================================
-- 012_contract_rbac_and_lifecycle.sql
-- 契約RBAC強制・AI提案ライフサイクル正式化 & 自動承認ルール混在防止 (Phase 1: P1-T3)
--
-- 目的:
--   1. contracts テーブルに source_suggestion_id 列を追加し、起草元となった
--      ai_suggestions レコードとの来歴 (Provenance) を保持可能にする。
--   2. 契約書抽出段階の ai_suggestions の target_type を 'attachment' に統一
--      (既存の 'contract' データを 'attachment' にデータマイグレーション)。
--   3. approval_rules に対し、is_explicit_auto_approve = TRUE (0-step) のルールと
--      通常ルール (step_number >= 1) が同一ルールセット (tenant_id, target_type) 内で
--      共存できないよう DB ガードトリガーを追加 (DEBT-006 解消)。
-- ============================================================================

-- 1. contracts テーブルに source_suggestion_id 列を追加
ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS source_suggestion_id UUID REFERENCES ai_suggestions(id);

CREATE INDEX IF NOT EXISTS ix_contracts_source_suggestion_id
    ON contracts(tenant_id, source_suggestion_id);


-- 2. 既存の契約書条項抽出 ai_suggestions レコードの target_type を 'attachment' へ更新
-- (抽出段階では contracts.id は未生成であり、対象実体は添付ファイルであるため)
UPDATE ai_suggestions
SET target_type = 'attachment'
WHERE suggestion_type = 'contract_terms' AND target_type = 'contract';


-- 3. approval_rules: 自動承認ルールと通常ルールの混在防止トリガー (DEBT-006)
CREATE OR REPLACE FUNCTION fn_prevent_auto_approve_mix()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_explicit_auto_approve = TRUE THEN
        -- 同一 (tenant_id, target_type) に通常ステップ (step_number >= 1) が既に存在する場合は拒否
        IF EXISTS (
            SELECT 1 FROM approval_rules
            WHERE tenant_id = NEW.tenant_id
              AND target_type = NEW.target_type
              AND id <> NEW.id
              AND is_explicit_auto_approve = FALSE
        ) THEN
            RAISE EXCEPTION 'Cannot add auto-approve rule when normal approval steps exist for tenant % and target_type %',
                NEW.tenant_id, NEW.target_type
                USING ERRCODE = '23514'; -- check_violation
        END IF;
    ELSE
        -- 通常ルールの追加時、同一 (tenant_id, target_type) に自動承認ルールが既に存在する場合は拒否
        IF EXISTS (
            SELECT 1 FROM approval_rules
            WHERE tenant_id = NEW.tenant_id
              AND target_type = NEW.target_type
              AND id <> NEW.id
              AND is_explicit_auto_approve = TRUE
        ) THEN
            RAISE EXCEPTION 'Cannot add normal approval step when auto-approve rule exists for tenant % and target_type %',
                NEW.tenant_id, NEW.target_type
                USING ERRCODE = '23514'; -- check_violation
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_auto_approve_mix ON approval_rules;
CREATE TRIGGER trg_prevent_auto_approve_mix
    BEFORE INSERT OR UPDATE ON approval_rules
    FOR EACH ROW
    EXECUTE FUNCTION fn_prevent_auto_approve_mix();
