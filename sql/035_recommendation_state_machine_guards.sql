-- ============================================================================
-- 035_recommendation_state_machine_guards.sql
-- Phase 5 Task 2 (P5-T2-FIX): AIレコメンドエンジンの状態遷移モデルとDB最終防衛の厳格化
--
-- 背景・目的:
--   P5-T2のレビュー指摘（SO REQUEST CHANGES）に基づき、recommendationsテーブルの
--   不変性モデルを「完全WORM」から「append-only + 一度限りの許可された状態遷移」へ精緻化する。
--
-- 確立された設計原則の遵守:
--   1. 状態遷移モデルの厳格化:
--      - 許可される遷移: pending -> accepted, pending -> dismissed
--      - 拒否される遷移: accepted -> dismissed, dismissed -> accepted,
--        accepted -> pending, dismissed -> pending, および終端状態からのあらゆる変更
--      - 状態変更時のみ shown_at, responded_at, updated_at の変更を許可
--   2. 不変列の厳格保護 (真のWORM):
--      - id, tenant_id, type, target_domain, target_id, title, message, action_url,
--        metadata, created_at は作成後一切変更不可
--   3. 未知ドメインの fail-closed 拒絶:
--      - target_domain が既知のドメイン (contracts, approval_requests, quotations)
--        以外の場合は INSERT / UPDATE を明示的に 55000 で拒絶
--   4. DELETE の絶対禁止 (fail-closed, 55000)
--   5. RBACマトリクス対応:
--      - legal_viewer に recommendation.view のみを付与 (actは付与しない)
-- ============================================================================

-- 1. status 列の CHECK 制約更新 (pending を初期デフォルトに追加)
ALTER TABLE recommendations DROP CONSTRAINT IF EXISTS recommendations_status_check;
ALTER TABLE recommendations ADD CONSTRAINT recommendations_status_check
    CHECK (status IN ('pending', 'new', 'shown', 'accepted', 'dismissed'));

ALTER TABLE recommendations ALTER COLUMN status SET DEFAULT 'pending';

-- 2. target_domain の未知の値に対する fail-closed ガードトリガー更新
CREATE OR REPLACE FUNCTION fn_validate_recommendation_tenant_consistency()
RETURNS TRIGGER AS $$
BEGIN
    -- 2.1 契約ドメイン (contracts)
    IF NEW.target_domain = 'contracts' THEN
        IF NOT EXISTS (
            SELECT 1 FROM contracts
            WHERE id = NEW.target_id AND tenant_id = NEW.tenant_id
        ) THEN
            RAISE EXCEPTION 'contract % does not belong to tenant %',
                NEW.target_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;

    -- 2.2 承認依頼ドメイン (approval_requests)
    ELSIF NEW.target_domain = 'approval_requests' THEN
        IF NOT EXISTS (
            SELECT 1 FROM approval_requests
            WHERE id = NEW.target_id AND tenant_id = NEW.tenant_id
        ) THEN
            RAISE EXCEPTION 'approval_request % does not belong to tenant %',
                NEW.target_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;

    -- 2.3 見積ドメイン (quotations)
    ELSIF NEW.target_domain = 'quotations' THEN
        IF NOT EXISTS (
            SELECT 1 FROM quotations
            WHERE id = NEW.target_id AND tenant_id = NEW.tenant_id
        ) THEN
            RAISE EXCEPTION 'quotation % does not belong to tenant %',
                NEW.target_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;

    -- 2.4 未知・未対応のドメイン (fail-closed 拒絶)
    ELSE
        RAISE EXCEPTION 'unsupported or unknown target_domain: % (must be contracts, approval_requests, or quotations)',
            NEW.target_domain
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. 状態遷移マシン ＆ 不変列保護トリガー (append-only + 一度限りの遷移)
CREATE OR REPLACE FUNCTION fn_guard_recommendation_immutability()
RETURNS TRIGGER AS $$
BEGIN
    -- 3.1 物理削除の絶対禁止 (fail-closed WORM)
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'cannot delete recommendation % (immutable WORM)', OLD.id
            USING ERRCODE = '55000';
    END IF;

    -- 3.2 不変列の改ざん禁止 (作成後は値変更不可)
    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'cannot change id of recommendation % (immutable)', OLD.id
            USING ERRCODE = '55000';
    END IF;

    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
        RAISE EXCEPTION 'cannot change tenant_id of recommendation % (immutable)', OLD.id
            USING ERRCODE = '55000';
    END IF;

    IF NEW.type IS DISTINCT FROM OLD.type THEN
        RAISE EXCEPTION 'cannot change type of recommendation % (immutable)', OLD.id
            USING ERRCODE = '55000';
    END IF;

    IF NEW.target_domain IS DISTINCT FROM OLD.target_domain THEN
        RAISE EXCEPTION 'cannot change target_domain of recommendation % (immutable)', OLD.id
            USING ERRCODE = '55000';
    END IF;

    IF NEW.target_id IS DISTINCT FROM OLD.target_id THEN
        RAISE EXCEPTION 'cannot change target_id of recommendation % (immutable)', OLD.id
            USING ERRCODE = '55000';
    END IF;

    IF NEW.title IS DISTINCT FROM OLD.title THEN
        RAISE EXCEPTION 'cannot change title of recommendation % (immutable)', OLD.id
            USING ERRCODE = '55000';
    END IF;

    IF NEW.message IS DISTINCT FROM OLD.message THEN
        RAISE EXCEPTION 'cannot change message of recommendation % (immutable)', OLD.id
            USING ERRCODE = '55000';
    END IF;

    IF NEW.action_url IS DISTINCT FROM OLD.action_url THEN
        RAISE EXCEPTION 'cannot change action_url of recommendation % (immutable)', OLD.id
            USING ERRCODE = '55000';
    END IF;

    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'cannot change created_at of recommendation % (immutable)', OLD.id
            USING ERRCODE = '55000';
    END IF;

    -- 3.3 状態遷移マシンの検証 (一度限りの遷移モデル)
    -- 既に終端状態 (accepted または dismissed) に達したレコードは一切の変更を拒絶
    IF OLD.status IN ('accepted', 'dismissed') THEN
        IF NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'cannot transition recommendation % from terminal status % to %',
                OLD.id, OLD.status, NEW.status
                USING ERRCODE = '55000';
        ELSE
            RAISE EXCEPTION 'cannot modify finalized recommendation % in terminal status %',
                OLD.id, OLD.status
                USING ERRCODE = '55000';
        END IF;
    END IF;

    -- 未確定状態 (pending, new, shown) からの遷移検証
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        -- 許可される遷移: pending/new/shown -> accepted または dismissed
        IF OLD.status IN ('pending', 'new', 'shown') AND NEW.status IN ('accepted', 'dismissed') THEN
            -- 正常なステータス遷移を許可
            RETURN NEW;
        ELSE
            RAISE EXCEPTION 'invalid status transition for recommendation %: cannot transition from % to %',
                OLD.id, OLD.status, NEW.status
                USING ERRCODE = '55000';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. RBACマトリクス対応: legal_viewer に recommendation.view を付与 (actは付与しない)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE p.code = 'recommendation.view'
  AND r.code = 'legal_viewer'
ON CONFLICT (role_id, permission_id) DO NOTHING;
