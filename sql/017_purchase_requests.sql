-- ============================================================================
-- 017_purchase_requests.sql
-- 発注申請テーブルおよび承認ワークフロー連携 (Phase 2: P2-T1)
--
-- 背景・目的:
--   Phase 0 (P0-T1) で汎用化した承認ワークフロー (target_type='purchase_request') を活用し、
--   購買・調達ドメインの中核となる発注申請 (purchase_requests) テーブルを構築する。
--
-- 確立された設計原則の遵守:
--   1. 完全テナント分離: ENABLE + FORCE ROW LEVEL SECURITY (fail-closed)
--   2. テナント整合性のDBトリガー保証 (MAJOR-02教訓):
--      attachment_id (証憑・見積書) および created_by の tenant_id 整合性をDBトリガーで強制検証
--   3. 状態遷移・改ざん防止トリガー (WORM特性):
--      draft のみ物理削除許可、active 後の品目・金額等の重要項目改変禁止、終端状態(terminated)保護
--   4. 金額・数量の非負制約および数量×単価＝合計金額のDBレベル整合性保証 (CHECK制約):
--      quantity > 0, unit_price >= 0, total_amount >= 0, total_amount = round(quantity * unit_price, 2)
--   5. RBAC二重防御:
--      purchase_request.create / view / edit / approve / terminate の権限体系を整備
-- ============================================================================

-- 1. purchase_requests テーブル作成
CREATE TABLE IF NOT EXISTS purchase_requests (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id),
    request_no              TEXT NOT NULL,
    title                   TEXT NOT NULL,
    supplier_name           TEXT NOT NULL,
    item_description        TEXT NOT NULL,
    quantity                NUMERIC(12, 2) NOT NULL,
    unit_price              NUMERIC(15, 2) NOT NULL,
    total_amount            NUMERIC(15, 2) NOT NULL,
    currency                CHAR(3) NOT NULL DEFAULT 'JPY',
    requested_delivery_date DATE,
    status                  TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                                'draft', 'pending_approval', 'active', 'rejected', 'terminated'
                            )),
    attachment_id           UUID REFERENCES attachments(id),
    description             TEXT,
    approved_at             TIMESTAMPTZ,
    created_by              UUID NOT NULL REFERENCES users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_purchase_requests_tenant_no UNIQUE (tenant_id, request_no),
    CONSTRAINT chk_purchase_requests_quantity_positive CHECK (quantity > 0),
    CONSTRAINT chk_purchase_requests_unit_price_nonneg CHECK (unit_price >= 0),
    CONSTRAINT chk_purchase_requests_total_amount_nonneg CHECK (total_amount >= 0),
    CONSTRAINT chk_purchase_requests_calc_match CHECK (total_amount = round(quantity * unit_price, 2))
);

COMMENT ON TABLE purchase_requests IS '発注申請テーブル (品目・単価・数量・合計金額・納期等の購買起票)';
COMMENT ON COLUMN purchase_requests.request_no IS '発注申請番号 (テナント内ユニーク, PR-YYYY-XXXX)';
COMMENT ON COLUMN purchase_requests.supplier_name IS 'サプライヤー・取引先名 (P2-T2でsupplier_idへ正規化予定)';
COMMENT ON COLUMN purchase_requests.quantity IS '発注数量 (0超必須)';
COMMENT ON COLUMN purchase_requests.unit_price IS '単価 (非負)';
COMMENT ON COLUMN purchase_requests.total_amount IS '合計金額 (quantity * unit_price と一致必須)';
COMMENT ON COLUMN purchase_requests.status IS '申請状態 (draft, pending_approval, active, rejected, terminated)';

-- 2. インデックス作成
CREATE INDEX IF NOT EXISTS ix_purchase_requests_tenant_status
    ON purchase_requests (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_purchase_requests_supplier_trgm
    ON purchase_requests USING gin (supplier_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ix_purchase_requests_attachment
    ON purchase_requests (tenant_id, attachment_id)
    WHERE attachment_id IS NOT NULL;

-- 3. 行レベルセキュリティ (RLS)
ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_purchase_requests ON purchase_requests;
CREATE POLICY tenant_isolation_purchase_requests ON purchase_requests
    FOR ALL
    USING (tenant_id = fn_current_tenant_id())
    WITH CHECK (tenant_id = fn_current_tenant_id());

-- 4. テナント整合性ガードトリガー (MAJOR-02教訓)
CREATE OR REPLACE FUNCTION fn_validate_purchase_request_tenant_consistency()
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

DROP TRIGGER IF EXISTS trg_validate_purchase_request_tenant_consistency ON purchase_requests;
CREATE TRIGGER trg_validate_purchase_request_tenant_consistency
    BEFORE INSERT OR UPDATE ON purchase_requests
    FOR EACH ROW EXECUTE FUNCTION fn_validate_purchase_request_tenant_consistency();

-- 5. ステータス遷移ガード ＆ 改ざん防止トリガー (WORM特性)
CREATE OR REPLACE FUNCTION fn_guard_purchase_request_transition()
RETURNS TRIGGER AS $$
BEGIN
    -- 5.1 物理削除ガード: draft のみ物理削除を許可。それ以外は禁止
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'draft' THEN
            RAISE EXCEPTION 'purchase_requests in status % cannot be physically deleted; only draft requests can be deleted',
                OLD.status USING ERRCODE = '23001';
        END IF;
        RETURN OLD;
    END IF;

    -- 5.2 終端状態ガード: terminated からの変更は不可
    IF OLD.status = 'terminated' THEN
        RAISE EXCEPTION 'purchase_requests in status % are final and immutable', OLD.status
            USING ERRCODE = '23001';
    END IF;

    -- 5.3 ステータス遷移許可パスの検証
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        -- draft からの遷移: pending_approval, active (1人テナント自動承認), terminated (取消)
        IF OLD.status = 'draft' AND NEW.status NOT IN ('pending_approval', 'active', 'terminated') THEN
            RAISE EXCEPTION 'invalid purchase_request status transition from % to %', OLD.status, NEW.status
                USING ERRCODE = '23001';
        END IF;

        -- pending_approval からの遷移: active, rejected, draft (差戻し)
        IF OLD.status = 'pending_approval' AND NEW.status NOT IN ('active', 'rejected', 'draft') THEN
            RAISE EXCEPTION 'invalid purchase_request status transition from % to %', OLD.status, NEW.status
                USING ERRCODE = '23001';
        END IF;

        -- active からの遷移: terminated (解約・取消) のみ
        IF OLD.status = 'active' AND NEW.status NOT IN ('terminated') THEN
            RAISE EXCEPTION 'invalid purchase_request status transition from % to %', OLD.status, NEW.status
                USING ERRCODE = '23001';
        END IF;

        -- rejected からの遷移: draft (再申請用下書き戻し) のみ
        IF OLD.status = 'rejected' AND NEW.status NOT IN ('draft') THEN
            RAISE EXCEPTION 'invalid purchase_request status transition from % to %', OLD.status, NEW.status
                USING ERRCODE = '23001';
        END IF;
    END IF;

    -- 5.4 active 状態維持時の重要列改ざん防止 (WORM特性)
    IF OLD.status = 'active' AND NEW.status = 'active' THEN
        IF OLD.title IS DISTINCT FROM NEW.title
           OR OLD.supplier_name IS DISTINCT FROM NEW.supplier_name
           OR OLD.item_description IS DISTINCT FROM NEW.item_description
           OR OLD.quantity IS DISTINCT FROM NEW.quantity
           OR OLD.unit_price IS DISTINCT FROM NEW.unit_price
           OR OLD.total_amount IS DISTINCT FROM NEW.total_amount
           OR OLD.currency IS DISTINCT FROM NEW.currency
           OR OLD.requested_delivery_date IS DISTINCT FROM NEW.requested_delivery_date
           OR OLD.attachment_id IS DISTINCT FROM NEW.attachment_id
        THEN
            RAISE EXCEPTION 'active purchase_requests are immutable for critical fields (title, supplier, items, amount, dates); create a new request or amendment instead'
                USING ERRCODE = '23001';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_purchase_requests_updated_at ON purchase_requests;
CREATE TRIGGER trg_set_purchase_requests_updated_at
    BEFORE UPDATE ON purchase_requests
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_guard_purchase_request_transition ON purchase_requests;
CREATE TRIGGER trg_guard_purchase_request_transition
    BEFORE UPDATE OR DELETE ON purchase_requests
    FOR EACH ROW EXECUTE FUNCTION fn_guard_purchase_request_transition();

-- 6. RBAC: パーミッション登録およびロールへの割当
INSERT INTO permissions (code, description) VALUES
    ('purchase_request.create', '発注申請の作成・登録(draft)'),
    ('purchase_request.view', '発注申請の閲覧'),
    ('purchase_request.edit', '発注申請の編集・更新(draft時)'),
    ('purchase_request.approve', '発注申請の承認・却下'),
    ('purchase_request.terminate', '発注申請の解約・取消(active時)')
ON CONFLICT (code) DO NOTHING;

-- owner: 全権限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'owner'
  AND p.code IN (
      'purchase_request.create', 'purchase_request.view', 'purchase_request.edit',
      'purchase_request.approve', 'purchase_request.terminate'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- employee: 一般社員は起票・閲覧・下書き編集が可能
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'employee'
  AND p.code IN ('purchase_request.create', 'purchase_request.view', 'purchase_request.edit')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- approver: 閲覧・承認
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'approver'
  AND p.code IN ('purchase_request.view', 'purchase_request.approve')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- legal_admin: 閲覧・承認
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'legal_admin'
  AND p.code IN ('purchase_request.view', 'purchase_request.approve')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- legal_viewer, accountant, accounting_manager: 閲覧のみ
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('legal_viewer', 'accountant', 'accounting_manager')
  AND p.code IN ('purchase_request.view')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 7. 権限付与
GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_requests TO app_runtime;
GRANT SELECT ON purchase_requests TO app_readonly_external;
