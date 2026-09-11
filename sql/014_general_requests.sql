-- ============================================================================
-- 014_general_requests.sql
-- 汎用稟議申請テーブルおよび承認ワークフロー連携 (Phase 1: P1-T5)
--
-- 背景・目的:
--   契約書(contracts)のような専用ドメインテーブルを持たない、
--   自由記述の汎用稟議（備品購入、規程変更、出張申請等）を、
--   既存のポリモーフィック承認エンジン(approval_requests / approval_rules)に乗せて
--   起票・承認・ステータス管理できる基盤を提供する。
--
-- 過去タスクからの重要設計原則:
--   1. 完全テナント分離: ENABLE + FORCE ROW LEVEL SECURITY (fail-closed)
--   2. テナント整合性のDBトリガー保証 (MAJOR-02教訓):
--      attachment_id および created_by の tenant_id 整合性をDBトリガーで検証
--   3. 状態遷移・改ざん防止トリガー (WORM特性):
--      draft のみ物理削除許可、active 後の重要項目改ざん禁止
--   4. target_type 制約拡張:
--      approval_rules / approval_requests の target_type に 'general_request' を追加
-- ============================================================================

-- 1. general_requests テーブル作成
CREATE TABLE IF NOT EXISTS general_requests (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id),
    request_no    TEXT NOT NULL,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL,
    category      TEXT NOT NULL DEFAULT 'general',
    amount        NUMERIC(14, 2),
    attachment_id UUID REFERENCES attachments(id),
    status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'active', 'rejected')),
    created_by    UUID NOT NULL REFERENCES users(id),
    approved_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_general_requests_tenant_no UNIQUE (tenant_id, request_no)
);

COMMENT ON TABLE general_requests IS '汎用稟議申請テーブル (備品購入・規程変更等の自由記述稟議)';
COMMENT ON COLUMN general_requests.request_no IS '稟議番号 (テナント内ユニーク)';
COMMENT ON COLUMN general_requests.category IS '稟議カテゴリ (general, equipment, rule_change, business_trip, other)';
COMMENT ON COLUMN general_requests.amount IS '申請金額 (任意)';
COMMENT ON COLUMN general_requests.status IS '申請状態 (draft, pending_approval, active, rejected)';

-- 2. インデックス
CREATE INDEX IF NOT EXISTS ix_general_requests_tenant_status
    ON general_requests (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_general_requests_attachment
    ON general_requests (tenant_id, attachment_id)
    WHERE attachment_id IS NOT NULL;

-- 3. 行レベルセキュリティ (RLS)
ALTER TABLE general_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE general_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_general_requests ON general_requests;
CREATE POLICY tenant_isolation_general_requests ON general_requests
    USING (tenant_id = fn_current_tenant_id())
    WITH CHECK (tenant_id = fn_current_tenant_id());

-- 4. テナント整合性ガードトリガー (MAJOR-02教訓)
CREATE OR REPLACE FUNCTION fn_validate_general_request_tenant_consistency()
RETURNS TRIGGER AS $$
BEGIN
    -- 4.1 attachment_id が指定されている場合、参照先 attachments の tenant_id と一致することを検証
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

    -- 4.2 created_by ユーザーが当該テナント (tenant_users) に所属していることを検証
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

DROP TRIGGER IF EXISTS trg_validate_general_request_tenant_consistency ON general_requests;
CREATE TRIGGER trg_validate_general_request_tenant_consistency
    BEFORE INSERT OR UPDATE ON general_requests
    FOR EACH ROW EXECUTE FUNCTION fn_validate_general_request_tenant_consistency();

-- 5. ステータス遷移ガード & 改ざん防止トリガー
CREATE OR REPLACE FUNCTION fn_guard_general_request_transition()
RETURNS TRIGGER AS $$
BEGIN
    -- 5.1 物理削除ガード: draft のみ許可
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'draft' THEN
            RAISE EXCEPTION 'general_requests in status % cannot be physically deleted; only draft requests can be deleted',
                OLD.status USING ERRCODE = '23001';
        END IF;
        RETURN OLD;
    END IF;

    -- 5.2 ステータス遷移許可パスの検証
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        -- draft からの遷移
        IF OLD.status = 'draft' AND NEW.status NOT IN ('pending_approval', 'active') THEN
            RAISE EXCEPTION 'invalid general_request status transition from % to %', OLD.status, NEW.status
                USING ERRCODE = '23001';
        END IF;

        -- pending_approval からの遷移
        IF OLD.status = 'pending_approval' AND NEW.status NOT IN ('active', 'rejected', 'draft') THEN
            RAISE EXCEPTION 'invalid general_request status transition from % to %', OLD.status, NEW.status
                USING ERRCODE = '23001';
        END IF;

        -- active からの遷移 (終端状態)
        IF OLD.status = 'active' THEN
            RAISE EXCEPTION 'active general_requests are final and immutable (status: %)', OLD.status
                USING ERRCODE = '23001';
        END IF;

        -- rejected からの遷移
        IF OLD.status = 'rejected' AND NEW.status NOT IN ('draft') THEN
            RAISE EXCEPTION 'invalid general_request status transition from % to %', OLD.status, NEW.status
                USING ERRCODE = '23001';
        END IF;
    END IF;

    -- 5.3 active 状態維持時の重要列改ざん防止 (WORM特性)
    IF OLD.status = 'active' AND NEW.status = 'active' THEN
        IF OLD.title IS DISTINCT FROM NEW.title
           OR OLD.description IS DISTINCT FROM NEW.description
           OR OLD.category IS DISTINCT FROM NEW.category
           OR OLD.amount IS DISTINCT FROM NEW.amount
           OR OLD.attachment_id IS DISTINCT FROM NEW.attachment_id
        THEN
            RAISE EXCEPTION 'active general_requests are immutable for critical fields (title, description, category, amount, attachment)'
                USING ERRCODE = '23001';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_general_requests_updated_at ON general_requests;
CREATE TRIGGER trg_set_general_requests_updated_at
    BEFORE UPDATE ON general_requests
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_guard_general_request_transition ON general_requests;
CREATE TRIGGER trg_guard_general_request_transition
    BEFORE UPDATE OR DELETE ON general_requests
    FOR EACH ROW EXECUTE FUNCTION fn_guard_general_request_transition();

-- 6. approval_rules / approval_requests の target_type CHECK 制約更新
ALTER TABLE approval_rules
    DROP CONSTRAINT IF EXISTS approval_rules_target_type_check;

ALTER TABLE approval_rules
    ADD CONSTRAINT approval_rules_target_type_check
    CHECK (target_type IN ('journal_entry', 'expense_report', 'vendor_bill', 'contract', 'purchase_request', 'general_request'));

ALTER TABLE approval_requests
    DROP CONSTRAINT IF EXISTS approval_requests_target_type_check;

ALTER TABLE approval_requests
    ADD CONSTRAINT approval_requests_target_type_check
    CHECK (target_type IN ('journal_entry', 'expense_report', 'vendor_bill', 'contract', 'purchase_request', 'general_request'));

-- 7. RBAC: パーミッション登録およびロールへの割当
INSERT INTO permissions (code, description) VALUES
    ('general_request.create', '汎用稟議の作成・登録(draft)'),
    ('general_request.view', '汎用稟議の閲覧'),
    ('general_request.edit', '汎用稟議の編集・更新'),
    ('general_request.approve', '汎用稟議の承認')
ON CONFLICT (code) DO NOTHING;

-- owner: 全権限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'owner'
  AND p.code IN ('general_request.create', 'general_request.view', 'general_request.edit', 'general_request.approve')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- employee: 一般社員は起票・閲覧・下書き編集が可能
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'employee'
  AND p.code IN ('general_request.create', 'general_request.view', 'general_request.edit')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- approver: 閲覧・承認
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'approver'
  AND p.code IN ('general_request.view', 'general_request.approve')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- legal_admin: 全権限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'legal_admin'
  AND p.code IN ('general_request.create', 'general_request.view', 'general_request.edit', 'general_request.approve')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- legal_viewer, accountant, accounting_manager: 閲覧のみ
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('legal_viewer', 'accountant', 'accounting_manager')
  AND p.code IN ('general_request.view')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 8. 権限付与
GRANT SELECT, INSERT, UPDATE, DELETE ON general_requests TO app_runtime;
GRANT SELECT ON general_requests TO app_readonly_external;
