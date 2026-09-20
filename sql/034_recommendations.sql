-- ============================================================================
-- 034_recommendations.sql
-- Phase 5 Task 2 (P5-T2): AIレコメンドエンジン基盤 (ルールベース推奨エンジン)
--
-- 背景・目的:
--   業務横断的なデータ相関から、担当者への提案（レコメンド）を生成・記録・表示する基盤。
--   本タスクでは提案の生成・表示・採用/見送りの記録に専念し、業務データの自動変更は一切行わない
--   （本計画書7.2節の設計原則を厳格に適用する）。
--   外部LLM APIへの通信は一切行わず、構造化データに基づくルールベースの推奨エンジンとする。
--
-- 確立された設計原則の遵守:
--   1. 完全テナント分離: ENABLE + FORCE ROW LEVEL SECURITY (fail-closed)
--   2. テナント整合性のDBトリガー保証 (MAJOR-02教訓):
--      target_domain に応じた各ドメインテーブル (contracts, approval_requests, quotations)
--      と recommendations.tenant_id の一致をDBトリガーで検証
--   3. WORM 不変性・データ保護:
--      作成後の tenant_id, type, target_domain, target_id の改ざんを禁止、DELETE禁止
--   4. Append-only マイグレーション:
--      既存マイグレーション (001〜033) に一切手を加えず新規テーブルとして追加
--   5. RBAC三層防御:
--      recommendation.view / recommendation.act 権限体系の整備
-- ============================================================================

-- 1. recommendations テーブル作成
CREATE TABLE IF NOT EXISTS recommendations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    type                VARCHAR(50) NOT NULL,
    target_domain       VARCHAR(50) NOT NULL,
    target_id           UUID NOT NULL,
    title               VARCHAR(255) NOT NULL,
    message             TEXT NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new', 'shown', 'accepted', 'dismissed')),
    action_url          VARCHAR(255),
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    shown_at            TIMESTAMPTZ,
    responded_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_recommendations_tenant_type_target UNIQUE (tenant_id, type, target_id)
);

COMMENT ON TABLE recommendations IS 'AI/ルールベース業務横断レコメンド・提案テーブル';
COMMENT ON COLUMN recommendations.type IS '推奨タイプ (例: contract_renewal_pending, approval_stale, quotation_follow_up)';
COMMENT ON COLUMN recommendations.target_domain IS '対象ドメイン識別子 (contracts, approval_requests, quotations)';
COMMENT ON COLUMN recommendations.target_id IS '対象業務レコードID (ポリモーフィック参照)';
COMMENT ON COLUMN recommendations.title IS '提案タイトル';
COMMENT ON COLUMN recommendations.message IS '提案理由・詳細メッセージ';
COMMENT ON COLUMN recommendations.status IS '提案ステータス (new: 未提示, shown: 提示済, accepted: 採用, dismissed: 見送り)';
COMMENT ON COLUMN recommendations.action_url IS '推奨アクション導線URL (正規画面へのナビゲーション)';
COMMENT ON COLUMN recommendations.metadata IS '根拠データ・補助情報 (JSON)';

-- 2. インデックス作成
CREATE INDEX IF NOT EXISTS ix_recommendations_tenant_status
    ON recommendations (tenant_id, status);

CREATE INDEX IF NOT EXISTS ix_recommendations_tenant_domain
    ON recommendations (tenant_id, target_domain);

-- 3. 行レベルセキュリティ (RLS)
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_recommendations ON recommendations;
CREATE POLICY tenant_isolation_recommendations ON recommendations
    FOR ALL
    USING (tenant_id = fn_current_tenant_id())
    WITH CHECK (tenant_id = fn_current_tenant_id());

-- 4. テナント整合性ガードトリガー
CREATE OR REPLACE FUNCTION fn_validate_recommendation_tenant_consistency()
RETURNS TRIGGER AS $$
BEGIN
    -- 4.1 契約ドメイン (contracts)
    IF NEW.target_domain = 'contracts' THEN
        IF NOT EXISTS (
            SELECT 1 FROM contracts
            WHERE id = NEW.target_id AND tenant_id = NEW.tenant_id
        ) THEN
            RAISE EXCEPTION 'contract % does not belong to tenant %',
                NEW.target_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;

    -- 4.2 承認依頼ドメイン (approval_requests)
    ELSIF NEW.target_domain = 'approval_requests' THEN
        IF NOT EXISTS (
            SELECT 1 FROM approval_requests
            WHERE id = NEW.target_id AND tenant_id = NEW.tenant_id
        ) THEN
            RAISE EXCEPTION 'approval_request % does not belong to tenant %',
                NEW.target_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;

    -- 4.3 見積ドメイン (quotations)
    ELSIF NEW.target_domain = 'quotations' THEN
        IF NOT EXISTS (
            SELECT 1 FROM quotations
            WHERE id = NEW.target_id AND tenant_id = NEW.tenant_id
        ) THEN
            RAISE EXCEPTION 'quotation % does not belong to tenant %',
                NEW.target_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_recommendation_tenant_consistency ON recommendations;
CREATE TRIGGER trg_validate_recommendation_tenant_consistency
    BEFORE INSERT OR UPDATE ON recommendations
    FOR EACH ROW EXECUTE FUNCTION fn_validate_recommendation_tenant_consistency();

-- 5. WORM不変性・削除禁止トリガー
CREATE OR REPLACE FUNCTION fn_guard_recommendation_immutability()
RETURNS TRIGGER AS $$
BEGIN
    -- 5.1 削除禁止 (WORM監査性保護)
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'cannot delete recommendation % (immutable WORM)', OLD.id
            USING ERRCODE = '55000';
    END IF;

    -- 5.2 基本識別列の改ざん禁止
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'cannot change id of recommendation % (immutable WORM)', OLD.id
            USING ERRCODE = '55000';
    END IF;

    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
        RAISE EXCEPTION 'cannot change tenant_id of recommendation % (immutable WORM)', OLD.id
            USING ERRCODE = '55000';
    END IF;

    IF NEW.type IS DISTINCT FROM OLD.type THEN
        RAISE EXCEPTION 'cannot change type of recommendation % (immutable WORM)', OLD.id
            USING ERRCODE = '55000';
    END IF;

    IF NEW.target_domain IS DISTINCT FROM OLD.target_domain THEN
        RAISE EXCEPTION 'cannot change target_domain of recommendation % (immutable WORM)', OLD.id
            USING ERRCODE = '55000';
    END IF;

    IF NEW.target_id IS DISTINCT FROM OLD.target_id THEN
        RAISE EXCEPTION 'cannot change target_id of recommendation % (immutable WORM)', OLD.id
            USING ERRCODE = '55000';
    END IF;

    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'cannot change created_at of recommendation % (immutable WORM)', OLD.id
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_recommendation_immutability ON recommendations;
CREATE TRIGGER trg_guard_recommendation_immutability
    BEFORE UPDATE OR DELETE ON recommendations
    FOR EACH ROW EXECUTE FUNCTION fn_guard_recommendation_immutability();

-- 6. RBAC 権限の追加 (recommendation.*)
INSERT INTO permissions (code, description) VALUES
    ('recommendation.view', 'AI/ルールベース業務提案・レコメンドの閲覧権限'),
    ('recommendation.act',  'AI/ルールベース業務提案の採用・見送りステータス更新権限')
ON CONFLICT (code) DO NOTHING;

-- 7. ロールと権限の紐付け (role_permissions)
-- 対象: 経営・管理職・一般従業員 (viewer_external は除外)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE p.code IN ('recommendation.view', 'recommendation.act')
  AND r.code IN (
    'owner',
    'accounting_manager',
    'legal_admin',
    'approver',
    'accountant',
    'payroll_admin',
    'employee'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 8. app_runtime 権限付与
GRANT SELECT, INSERT, UPDATE, DELETE ON recommendations TO app_runtime;
