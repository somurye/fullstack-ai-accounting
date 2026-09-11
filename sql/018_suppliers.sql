-- ============================================================================
-- 018_suppliers.sql
-- サプライヤー（取引先）マスタ管理および発注申請連携 (Phase 2: P2-T2)
--
-- 背景・目的:
--   P2-T1 で作成した purchase_requests.supplier_name（フリーテキスト）に加え、
--   正式なサプライヤーマスタ (suppliers) テーブルを構築し、発注申請から実在する
--   サプライヤーレコードを選択・関連付けできるようにする。
--   これにより、将来の P2-T3（発注〜検収〜請求連携）および P2-T4（購買ダッシュボード）
--   でのサプライヤー別集計・分析基盤を確立する。
--
-- 確立された設計原則の遵守:
--   1. 完全テナント分離: ENABLE + FORCE ROW LEVEL SECURITY (fail-closed)
--   2. テナント整合性のDBトリガー保証:
--      - suppliers.created_by が tenant_users に所属することを検証 (23503)
--      - purchase_requests.supplier_id が同一 tenant_id に属することを検証 (23503)
--   3. supplier_id と supplier_name の不整合防止 (SOレビュー重点観点):
--      - purchase_requests で supplier_id が指定された場合、参照先 suppliers.name と
--        supplier_name が一致することを強制検証 (不一致なら 23514 拒否、空なら自動同期)
--   4. 後方互換性保証:
--      - supplier_id = NULL のフリーテキスト起票（P2-T1の動作）もそのまま正常に動作
--   5. RBAC二重防御:
--      - supplier.create / view / edit のパーミッション体系を整備
--   6. append-only / fail-closed migration:
--      - 既存マイグレーションを改変せず、018 を 2 回連続適用しても冪等に完了
-- ============================================================================

-- 1. suppliers テーブル作成
CREATE TABLE IF NOT EXISTS suppliers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    name            TEXT NOT NULL,
    contact_name    TEXT,
    contact_email   TEXT,
    contact_phone   TEXT,
    payment_terms   TEXT,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_suppliers_tenant_name UNIQUE (tenant_id, name)
);

COMMENT ON TABLE suppliers IS 'サプライヤー・取引先マスタテーブル (購買先・仕入先情報)';
COMMENT ON COLUMN suppliers.name IS 'サプライヤー名 (テナント内で一意)';
COMMENT ON COLUMN suppliers.contact_name IS '担当者名';
COMMENT ON COLUMN suppliers.contact_email IS '担当者メールアドレス';
COMMENT ON COLUMN suppliers.contact_phone IS '担当者電話番号';
COMMENT ON COLUMN suppliers.payment_terms IS '支払条件 (例: 月末締め翌月末払い)';
COMMENT ON COLUMN suppliers.status IS '有効ステータス (active, inactive)';

-- 2. インデックス作成
CREATE INDEX IF NOT EXISTS ix_suppliers_tenant_status
    ON suppliers (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_suppliers_name_trgm
    ON suppliers USING gin (name gin_trgm_ops);

-- 3. 行レベルセキュリティ (RLS)
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_suppliers ON suppliers;
CREATE POLICY tenant_isolation_suppliers ON suppliers
    FOR ALL
    USING (tenant_id = fn_current_tenant_id())
    WITH CHECK (tenant_id = fn_current_tenant_id());

-- 4. テナント整合性ガードトリガー (suppliers)
CREATE OR REPLACE FUNCTION fn_validate_supplier_tenant_consistency()
RETURNS TRIGGER AS $$
BEGIN
    -- created_by ユーザーが当該テナント (tenant_users) に所属していることを検証
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

DROP TRIGGER IF EXISTS trg_validate_supplier_tenant_consistency ON suppliers;
CREATE TRIGGER trg_validate_supplier_tenant_consistency
    BEFORE INSERT OR UPDATE ON suppliers
    FOR EACH ROW EXECUTE FUNCTION fn_validate_supplier_tenant_consistency();

-- 4.2 サプライヤー名変更不整合防止トリガー (参照中サプライヤーの名称変更禁止)
--     発注申請 (purchase_requests) で参照されている supplier の名前変更を DB レベルで遮断し、
--     過去の確定伝票当時の取引先名とマスタ名との不整合を防ぐ (BLOCKER-01)。
--     並行実行時の race condition を防ぐため、同一 supplier_id に対する transaction advisory lock を取得する (P2-T2-FIX2)。
CREATE OR REPLACE FUNCTION fn_prevent_supplier_name_change_if_referenced()
RETURNS TRIGGER AS $$
BEGIN
    -- name 列が変更されている場合のみ検証 (他の列、contact情報等の変更は許可)
    IF NEW.name IS DISTINCT FROM OLD.name THEN
        -- 同一 supplier_id に対する並行 purchase_request 作成との競合を防ぐため transaction advisory lock を取得
        PERFORM pg_advisory_xact_lock(hashtextextended('supplier:' || OLD.id::text, 0));

        IF EXISTS (
            SELECT 1 FROM purchase_requests
            WHERE supplier_id = OLD.id
        ) THEN
            RAISE EXCEPTION 'Cannot change name of supplier "%" (id=%) because it is referenced by existing purchase requests',
                OLD.name, OLD.id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_supplier_name_change_if_referenced ON suppliers;
CREATE TRIGGER trg_prevent_supplier_name_change_if_referenced
    BEFORE UPDATE ON suppliers
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_supplier_name_change_if_referenced();

DROP TRIGGER IF EXISTS trg_set_suppliers_updated_at ON suppliers;
CREATE TRIGGER trg_set_suppliers_updated_at
    BEFORE UPDATE ON suppliers
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 5. purchase_requests への supplier_id 列追加
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'purchase_requests' AND column_name = 'supplier_id'
    ) THEN
        ALTER TABLE purchase_requests ADD COLUMN supplier_id UUID REFERENCES suppliers(id);
    END IF;
END $$;

COMMENT ON COLUMN purchase_requests.supplier_id IS 'サプライヤーマスタ参照ID (任意、nullable)';

CREATE INDEX IF NOT EXISTS ix_purchase_requests_supplier_id
    ON purchase_requests (tenant_id, supplier_id)
    WHERE supplier_id IS NOT NULL;

-- 6. テナント整合性トリガー更新 (purchase_requests: supplier_id 検証 & 名前整合性ガード)
CREATE OR REPLACE FUNCTION fn_validate_purchase_request_tenant_consistency()
RETURNS TRIGGER AS $$
DECLARE
    v_supplier_name TEXT;
    v_supplier_tenant UUID;
BEGIN
    -- 6.1 attachment_id が指定されている場合、参照先 attachments の tenant_id と一致することを検証
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

    -- 6.2 created_by ユーザーが当該テナント (tenant_users) に所属していることを検証
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

    -- 6.3 supplier_id が指定されている場合、参照先 suppliers の tenant_id と一致することを検証 (23503)
    --     および supplier_name との整合性を検証 (23514 / 自動補完)
    IF NEW.supplier_id IS NOT NULL THEN
        -- 同一 supplier_id に対する並行 supplier.name 変更との競合を防ぐため transaction advisory lock を取得 (P2-T2-FIX2)
        PERFORM pg_advisory_xact_lock(hashtextextended('supplier:' || NEW.supplier_id::text, 0));

        SELECT tenant_id, name INTO v_supplier_tenant, v_supplier_name
        FROM suppliers
        WHERE id = NEW.supplier_id;

        IF NOT FOUND OR v_supplier_tenant != NEW.tenant_id THEN
            RAISE EXCEPTION 'supplier % does not belong to tenant %',
                NEW.supplier_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;

        -- supplier_name が空の場合はマスタ名で自動補完
        IF NEW.supplier_name IS NULL OR TRIM(NEW.supplier_name) = '' THEN
            NEW.supplier_name := v_supplier_name;
        ELSIF NEW.supplier_name != v_supplier_name THEN
            -- 明示的に渡された名前がマスタと食い違う場合はデータの二重管理・不整合として拒否
            RAISE EXCEPTION 'supplier_name "%" does not match registered supplier name "%" for supplier_id %',
                NEW.supplier_name, v_supplier_name, NEW.supplier_id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_purchase_request_tenant_consistency ON purchase_requests;
CREATE TRIGGER trg_validate_purchase_request_tenant_consistency
    BEFORE INSERT OR UPDATE ON purchase_requests
    FOR EACH ROW EXECUTE FUNCTION fn_validate_purchase_request_tenant_consistency();

-- 7. RBAC: パーミッション登録およびロールへの割当
INSERT INTO permissions (code, description) VALUES
    ('supplier.create', 'サプライヤー（取引先）の作成・登録'),
    ('supplier.view', 'サプライヤー（取引先）の閲覧・検索'),
    ('supplier.edit', 'サプライヤー（取引先）の編集・更新')
ON CONFLICT (code) DO NOTHING;

-- owner, accounting_manager, accountant: フル管理権限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('owner', 'accounting_manager', 'accountant')
  AND p.code IN ('supplier.create', 'supplier.view', 'supplier.edit')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- employee, approver, legal_admin, legal_viewer: 閲覧・検索（発注起票・審査用）
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('employee', 'approver', 'legal_admin', 'legal_viewer')
  AND p.code IN ('supplier.view')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 8. 権限付与
GRANT SELECT, INSERT, UPDATE, DELETE ON suppliers TO app_runtime;
GRANT SELECT ON suppliers TO app_readonly_external;
