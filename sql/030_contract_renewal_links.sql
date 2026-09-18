-- ============================================================================
-- 030_contract_renewal_links.sql
-- 契約更新連携（契約更新期限アラートと商談・見積の紐付けリンク） (Phase 4: P4-T3)
--
-- 背景・目的:
--   Phase 1 で構築した契約更新期限アラート（P1-T4）に基づき、契約満了・更新予告期日を
--   迎える顧客に対する営業アプローチ（更新提案商談・見積作成）を追跡可能にする。
--   アラート等から人間（営業担当者・管理者）の明示的操作によって起票された案件（P4-T2 deals）
--   および見積（P4-T1 quotations）と、原契約（contracts）の関連を多層防御で安全に保持する。
--
-- 確立された設計原則の遵守:
--   1. 完全テナント分離: ENABLE + FORCE ROW LEVEL SECURITY (fail-closed)
--   2. テナント整合性のDBトリガー保証 (MAJOR-02教訓):
--      contract_id, deal_id, quotation_id, created_by の tenant_id 整合性をDBトリガーで検証
--   3. Append-only マイグレーション:
--      既存マイグレーション (001〜029) に一切手を加えず新規テーブルとして追加
--   4. RBAC三層防御:
--      contract_renewal_link.create / view の権限体系を整備
--   5. 人間の明示的操作による起票:
--      自動生成・自動確定ではなく、人間の明示的アクションによって本テーブルのレコードが生成される
-- ============================================================================

-- 1. contract_renewal_links テーブル作成
CREATE TABLE IF NOT EXISTS contract_renewal_links (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),
    contract_id         UUID NOT NULL REFERENCES contracts(id),
    deal_id             UUID REFERENCES deals(id) ON DELETE SET NULL,
    quotation_id        UUID REFERENCES quotations(id) ON DELETE SET NULL,
    created_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE contract_renewal_links IS '契約更新連携テーブル (原契約と更新商談・見積の紐付け追跡)';
COMMENT ON COLUMN contract_renewal_links.contract_id IS '原契約ID (contracts への外部キー参照)';
COMMENT ON COLUMN contract_renewal_links.deal_id IS '更新提案案件ID (deals への外部キー参照、nullable)';
COMMENT ON COLUMN contract_renewal_links.quotation_id IS '更新見積ID (quotations への外部キー参照、nullable)';
COMMENT ON COLUMN contract_renewal_links.created_by IS '作成者ユーザーID (users への外部キー参照)';

-- 2. インデックス作成
CREATE INDEX IF NOT EXISTS ix_crl_tenant_contract
    ON contract_renewal_links (tenant_id, contract_id);

CREATE INDEX IF NOT EXISTS ix_crl_tenant_deal
    ON contract_renewal_links (tenant_id, deal_id)
    WHERE deal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_crl_tenant_quotation
    ON contract_renewal_links (tenant_id, quotation_id)
    WHERE quotation_id IS NOT NULL;

-- 3. 行レベルセキュリティ (RLS)
ALTER TABLE contract_renewal_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_renewal_links FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_contract_renewal_links ON contract_renewal_links;
CREATE POLICY tenant_isolation_contract_renewal_links ON contract_renewal_links
    FOR ALL
    USING (tenant_id = fn_current_tenant_id())
    WITH CHECK (tenant_id = fn_current_tenant_id());

-- 4. テナント整合性ガードトリガー (MAJOR-02教訓)
CREATE OR REPLACE FUNCTION fn_validate_contract_renewal_link_tenant_consistency()
RETURNS TRIGGER AS $$
BEGIN
    -- 4.1 contract_id が当該テナントに属していることを検証
    IF NEW.contract_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM contracts
            WHERE id = NEW.contract_id AND tenant_id = NEW.tenant_id
        ) THEN
            RAISE EXCEPTION 'contract % does not belong to tenant %',
                NEW.contract_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    -- 4.2 deal_id が指定されている場合、当該テナントに属していることを検証
    IF NEW.deal_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM deals
            WHERE id = NEW.deal_id AND tenant_id = NEW.tenant_id
        ) THEN
            RAISE EXCEPTION 'deal % does not belong to tenant %',
                NEW.deal_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    -- 4.3 quotation_id が指定されている場合、当該テナントに属していることを検証
    IF NEW.quotation_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM quotations
            WHERE id = NEW.quotation_id AND tenant_id = NEW.tenant_id
        ) THEN
            RAISE EXCEPTION 'quotation % does not belong to tenant %',
                NEW.quotation_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    -- 4.4 created_by ユーザーが当該テナント (tenant_users) に所属していることを検証
    IF NEW.created_by IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM tenant_users
            WHERE tenant_id = NEW.tenant_id AND user_id = NEW.created_by
        ) THEN
            RAISE EXCEPTION 'user % does not belong to tenant %',
                NEW.created_by, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_contract_renewal_link_tenant_consistency ON contract_renewal_links;
CREATE TRIGGER trg_validate_contract_renewal_link_tenant_consistency
    BEFORE INSERT OR UPDATE ON contract_renewal_links
    FOR EACH ROW EXECUTE FUNCTION fn_validate_contract_renewal_link_tenant_consistency();

-- 5. RBAC 権限の追加 (contract_renewal_link.*)
INSERT INTO permissions (code, description) VALUES
    ('contract_renewal_link.create', '契約更新に伴う商談・見積連携の起票権限'),
    ('contract_renewal_link.view',   '契約更新連携情報の閲覧権限')
ON CONFLICT (code) DO NOTHING;

-- 6. ロールと権限の紐付け (role_permissions)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE (
    (r.code = 'owner' AND p.code IN ('contract_renewal_link.create', 'contract_renewal_link.view'))
    OR (r.code = 'legal_admin' AND p.code IN ('contract_renewal_link.create', 'contract_renewal_link.view'))
    OR (r.code = 'accounting_manager' AND p.code IN ('contract_renewal_link.create', 'contract_renewal_link.view'))
    OR (r.code = 'employee' AND p.code IN ('contract_renewal_link.create', 'contract_renewal_link.view'))
    OR (r.code = 'accountant' AND p.code = 'contract_renewal_link.view')
    OR (r.code = 'legal_viewer' AND p.code = 'contract_renewal_link.view')
    OR (r.code = 'approver' AND p.code = 'contract_renewal_link.view')
    OR (r.code = 'bookkeeper' AND p.code = 'contract_renewal_link.view')
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 7. 権限付与
GRANT SELECT, INSERT, UPDATE, DELETE ON contract_renewal_links TO app_runtime;

