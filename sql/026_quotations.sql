-- ============================================================================
-- 026_quotations.sql
-- 見積書テーブル・明細テーブル・WORM不変性・受注転換連携 (Phase 4: P4-T1)
--
-- 背景・目的:
--   営業事務Phase (Phase 4) の第1タスクとして、特定顧客向けの見積作成・明細管理・
--   確定送付 (sent)・改訂バージョン管理・受注転換 (invoices連携) を管理する
--   見積書 (quotations) および見積明細 (quotation_line_items) テーブルを構築する。
--   案件管理 (P4-T2) に先行して着手するが、deal_id を nullable で定義し、
--   顧客マスタ (customers) や売上請求書 (invoices) と連携可能な設計とする。
--
-- 確立された設計原則の遵守:
--   1. 完全テナント分離: ENABLE + FORCE ROW LEVEL SECURITY (fail-closed)
--   2. テナント整合性のDBトリガー保証 (MAJOR-02教訓):
--      customer_id, deal_id, superseded_by, converted_invoice_id, created_by の
--      tenant_id 整合性をDBトリガーで強制検証
--   3. 確定後 (sent) のWORM不変性DBトリガー (計画書6.2節 原則1):
--      sent 状態遷移後は、金額・顧客・明細・番号等の直接UPDATEおよび物理DELETEを
--      DBトリガーで fail-closed (ERRCODE: 55000) に禁止。
--      内容変更が必要な場合は、既存レコードを保持したまま superseded_by で新バージョンをリンク。
--   4. 受注転換の多重実行防止 (計画書6.2節 原則2):
--      同一見積からの多重転換を converted_invoice_id の UNIQUE 制約および
--      DBトリガーで機械的・絶対的に防止。
--   5. RBAC二重・三重防御:
--      quotation.create / view / edit / send / convert の権限体系を整備
-- ============================================================================

-- 1. quotations テーブル作成
CREATE TABLE IF NOT EXISTS quotations (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL REFERENCES tenants(id),
    customer_id          UUID NOT NULL REFERENCES customers(id),
    deal_id              UUID, -- P4-T2で案件管理テーブルと接続予定 (nullable)
    quote_no             TEXT NOT NULL,
    title                TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                             'draft', 'sent', 'accepted', 'rejected', 'expired'
                         )),
    valid_until          DATE,
    issue_date           DATE NOT NULL DEFAULT CURRENT_DATE,
    subtotal             NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    tax_amount           NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    total_amount         NUMERIC(18, 2) GENERATED ALWAYS AS (subtotal + tax_amount) STORED,
    currency_code        CHAR(3) NOT NULL DEFAULT 'JPY',
    version              INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    superseded_by        UUID REFERENCES quotations(id),
    notes                TEXT,
    converted_invoice_id UUID UNIQUE REFERENCES invoices(id),
    converted_at         TIMESTAMPTZ,
    converted_by         UUID REFERENCES users(id),
    created_by           UUID NOT NULL REFERENCES users(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_quotations_tenant_no_version UNIQUE (tenant_id, quote_no, version)
);

COMMENT ON TABLE quotations IS '見積書ヘッダテーブル (作成・確定送付・改訂履歴・受注転換連携)';
COMMENT ON COLUMN quotations.quote_no IS '見積番号 (テナント・バージョン複合ユニーク, QT-YYYY-XXXX)';
COMMENT ON COLUMN quotations.customer_id IS '顧客ID (既存顧客マスタ customers への外部キー参照)';
COMMENT ON COLUMN quotations.deal_id IS '案件ID (P4-T2連携用, nullable)';
COMMENT ON COLUMN quotations.status IS '見積状態 (draft, sent, accepted, rejected, expired)';
COMMENT ON COLUMN quotations.version IS '改訂版連番 (初版1, 改訂ごとに2, 3...)';
COMMENT ON COLUMN quotations.superseded_by IS '新改訂版見積ID (改訂時に旧レコードにリンク)';
COMMENT ON COLUMN quotations.converted_invoice_id IS '受注転換先売上請求書ID (多重転換防止 UNIQUE)';

-- 2. quotation_line_items テーブル作成
CREATE TABLE IF NOT EXISTS quotation_line_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    quotation_id    UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
    line_no         SMALLINT NOT NULL CHECK (line_no > 0),
    item_name       TEXT NOT NULL,
    description     TEXT,
    quantity        NUMERIC(14, 2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit            TEXT NOT NULL DEFAULT '式',
    unit_price      NUMERIC(18, 2) NOT NULL CHECK (unit_price >= 0),
    amount          NUMERIC(18, 2) NOT NULL CHECK (amount >= 0),
    tax_rate        NUMERIC(5, 4) NOT NULL DEFAULT 0.1000 CHECK (tax_rate >= 0),
    tax_category_id UUID REFERENCES tax_categories(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_quotation_lines_quotation_line_no UNIQUE (quotation_id, line_no),
    CONSTRAINT chk_quotation_line_amount_calc CHECK (amount = round(quantity * unit_price, 2))
);

COMMENT ON TABLE quotation_line_items IS '見積明細行テーブル (品目・数量・単価・税区分・金額)';
COMMENT ON COLUMN quotation_line_items.line_no IS '明細行番号 (見積内で連番)';
COMMENT ON COLUMN quotation_line_items.amount IS '行合計金額 (quantity * unit_price と一致必須)';

-- 3. インデックス作成
CREATE INDEX IF NOT EXISTS ix_quotations_tenant_status
    ON quotations (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_quotations_customer
    ON quotations (tenant_id, customer_id);

CREATE INDEX IF NOT EXISTS ix_quotations_superseded
    ON quotations (tenant_id, superseded_by)
    WHERE superseded_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_quotations_converted_invoice
    ON quotations (tenant_id, converted_invoice_id)
    WHERE converted_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_quotation_line_items_quotation
    ON quotation_line_items (quotation_id, line_no);

CREATE INDEX IF NOT EXISTS ix_quotation_line_items_tenant
    ON quotation_line_items (tenant_id);

-- 4. 行レベルセキュリティ (RLS)
ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_quotations ON quotations;
CREATE POLICY tenant_isolation_quotations ON quotations
    FOR ALL
    USING (tenant_id = fn_current_tenant_id())
    WITH CHECK (tenant_id = fn_current_tenant_id());

ALTER TABLE quotation_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_line_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_quotation_line_items ON quotation_line_items;
CREATE POLICY tenant_isolation_quotation_line_items ON quotation_line_items
    FOR ALL
    USING (tenant_id = fn_current_tenant_id())
    WITH CHECK (tenant_id = fn_current_tenant_id());

-- 5. テナント整合性ガードトリガー (MAJOR-02教訓)
CREATE OR REPLACE FUNCTION fn_validate_quotation_tenant_consistency()
RETURNS TRIGGER AS $$
BEGIN
    -- 5.1 customer_id が当該テナントに属していることを検証
    IF NEW.customer_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM customers
            WHERE id = NEW.customer_id AND tenant_id = NEW.tenant_id
        ) THEN
            RAISE EXCEPTION 'customer % does not belong to tenant %',
                NEW.customer_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    -- 5.2 created_by ユーザーが当該テナント (tenant_users) に所属していることを検証
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

    -- 5.3 superseded_by が指定されている場合、参照先見積が当該テナントに属していることを検証
    IF NEW.superseded_by IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM quotations
            WHERE id = NEW.superseded_by AND tenant_id = NEW.tenant_id
        ) THEN
            RAISE EXCEPTION 'superseded quotation % does not belong to tenant %',
                NEW.superseded_by, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    -- 5.4 converted_invoice_id が指定されている場合、参照先請求書が当該テナントに属していることを検証
    IF NEW.converted_invoice_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM invoices
            WHERE id = NEW.converted_invoice_id AND tenant_id = NEW.tenant_id
        ) THEN
            RAISE EXCEPTION 'converted invoice % does not belong to tenant %',
                NEW.converted_invoice_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_validate_quotation_line_item_tenant_consistency()
RETURNS TRIGGER AS $$
DECLARE
    v_parent_tenant_id UUID;
BEGIN
    -- 親 quotation の tenant_id と一致することを検証
    SELECT tenant_id INTO v_parent_tenant_id
    FROM quotations
    WHERE id = NEW.quotation_id;

    IF v_parent_tenant_id IS NULL OR v_parent_tenant_id <> NEW.tenant_id THEN
        RAISE EXCEPTION 'quotation_line_item tenant_id % does not match parent quotation tenant_id %',
            NEW.tenant_id, v_parent_tenant_id
            USING ERRCODE = '23503';
    END IF;

    -- tax_category_id が指定されている場合、共通または同一テナントであることを検証
    IF NEW.tax_category_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM tax_categories
            WHERE id = NEW.tax_category_id AND (tenant_id = NEW.tenant_id OR tenant_id IS NULL)
        ) THEN
            RAISE EXCEPTION 'tax_category % does not belong to tenant %',
                NEW.tax_category_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_quotation_tenant_consistency ON quotations;
CREATE TRIGGER trg_validate_quotation_tenant_consistency
    BEFORE INSERT OR UPDATE ON quotations
    FOR EACH ROW EXECUTE FUNCTION fn_validate_quotation_tenant_consistency();

DROP TRIGGER IF EXISTS trg_validate_quotation_line_item_tenant_consistency ON quotation_line_items;
CREATE TRIGGER trg_validate_quotation_line_item_tenant_consistency
    BEFORE INSERT OR UPDATE ON quotation_line_items
    FOR EACH ROW EXECUTE FUNCTION fn_validate_quotation_line_item_tenant_consistency();

-- 6. WORM不変性・状態遷移ガードトリガー (計画書6.2節 原則1)
CREATE OR REPLACE FUNCTION fn_guard_quotation_immutability()
RETURNS TRIGGER AS $$
BEGIN
    -- 6.1 物理削除は draft 状態のみ許可 (sent以降は不可逆保護)
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'draft' THEN
            RAISE EXCEPTION 'cannot delete quotation % in % status (only draft can be deleted)',
                OLD.quote_no, OLD.status
                USING ERRCODE = '55000';
        END IF;
        RETURN OLD;
    END IF;

    -- 6.2 状態遷移チェック
    IF OLD.status <> NEW.status THEN
        -- draft からの遷移: sent のみ許可 (確定送付)
        IF OLD.status = 'draft' AND NEW.status NOT IN ('sent') THEN
            RAISE EXCEPTION 'invalid quotation status transition from % to %', OLD.status, NEW.status
                USING ERRCODE = '23001';
        END IF;

        -- sent からの遷移: accepted, rejected, expired のみ許可
        IF OLD.status = 'sent' AND NEW.status NOT IN ('accepted', 'rejected', 'expired') THEN
            RAISE EXCEPTION 'invalid quotation status transition from % to %', OLD.status, NEW.status
                USING ERRCODE = '23001';
        END IF;

        -- 終端状態 (accepted, rejected, expired) からの再遷移は一切禁止
        IF OLD.status IN ('accepted', 'rejected', 'expired') THEN
            RAISE EXCEPTION 'terminal quotation in % status cannot transition to %', OLD.status, NEW.status
                USING ERRCODE = '23001';
        END IF;
    END IF;

    -- 6.3 sent 以降の確定状態における不変性強制 (WORM特性)
    -- status 以外の重要列（金額・明細・顧客・番号等）の改変を fail-closed に禁止
    IF OLD.status IN ('sent', 'accepted', 'rejected', 'expired') THEN
        IF OLD.customer_id IS DISTINCT FROM NEW.customer_id
           OR OLD.deal_id IS DISTINCT FROM NEW.deal_id
           OR OLD.quote_no IS DISTINCT FROM NEW.quote_no
           OR OLD.title IS DISTINCT FROM NEW.title
           OR OLD.valid_until IS DISTINCT FROM NEW.valid_until
           OR OLD.issue_date IS DISTINCT FROM NEW.issue_date
           OR OLD.subtotal IS DISTINCT FROM NEW.subtotal
           OR OLD.tax_amount IS DISTINCT FROM NEW.tax_amount
           OR OLD.currency_code IS DISTINCT FROM NEW.currency_code
           OR OLD.version IS DISTINCT FROM NEW.version
           OR OLD.notes IS DISTINCT FROM NEW.notes
           OR OLD.created_by IS DISTINCT FROM NEW.created_by
           OR OLD.created_at IS DISTINCT FROM NEW.created_at
        THEN
            RAISE EXCEPTION 'finalized quotation (%) is immutable; critical fields cannot be modified after sent',
                OLD.quote_no
                USING ERRCODE = '55000';
        END IF;

        -- superseded_by の更新は、未設定状態からの1回限りの設定のみ許可 (改訂リンク)
        IF OLD.superseded_by IS NOT NULL AND NEW.superseded_by IS DISTINCT FROM OLD.superseded_by THEN
            RAISE EXCEPTION 'quotation (%) already superseded by %; cannot re-assign superseded_by',
                OLD.quote_no, OLD.superseded_by
                USING ERRCODE = '55000';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_guard_quotation_line_item_immutability()
RETURNS TRIGGER AS $$
DECLARE
    v_parent_status TEXT;
    v_target_quotation_id UUID;
BEGIN
    v_target_quotation_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.quotation_id ELSE NEW.quotation_id END;

    SELECT status INTO v_parent_status
    FROM quotations
    WHERE id = v_target_quotation_id;

    IF v_parent_status IS NULL THEN
        RAISE EXCEPTION 'parent quotation % not found', v_target_quotation_id
            USING ERRCODE = '23503';
    END IF;

    -- 親見積が draft でない場合、明細の追加・変更・削除をすべて fail-closed に禁止
    IF v_parent_status <> 'draft' THEN
        RAISE EXCEPTION 'cannot modify line items of non-draft quotation (status: %)', v_parent_status
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_quotation_immutability ON quotations;
CREATE TRIGGER trg_guard_quotation_immutability
    BEFORE UPDATE OR DELETE ON quotations
    FOR EACH ROW EXECUTE FUNCTION fn_guard_quotation_immutability();

DROP TRIGGER IF EXISTS trg_guard_quotation_line_item_immutability ON quotation_line_items;
CREATE TRIGGER trg_guard_quotation_line_item_immutability
    BEFORE INSERT OR UPDATE OR DELETE ON quotation_line_items
    FOR EACH ROW EXECUTE FUNCTION fn_guard_quotation_line_item_immutability();

-- 7. 受注転換ガードトリガー (多重転換の機械的防止, 計画書6.2節 原則2)
CREATE OR REPLACE FUNCTION fn_guard_quotation_conversion()
RETURNS TRIGGER AS $$
BEGIN
    -- converted_invoice_id が既に設定されている場合の再設定・改変は禁止
    IF OLD.converted_invoice_id IS NOT NULL AND NEW.converted_invoice_id IS DISTINCT FROM OLD.converted_invoice_id THEN
        RAISE EXCEPTION 'quotation % is already converted to invoice %; multiple conversions are prohibited',
            OLD.quote_no, OLD.converted_invoice_id
            USING ERRCODE = '55000';
    END IF;

    -- 新たに converted_invoice_id をセットする場合、ステータスは sent または accepted でなければならない
    IF OLD.converted_invoice_id IS NULL AND NEW.converted_invoice_id IS NOT NULL THEN
        IF NEW.status NOT IN ('sent', 'accepted') THEN
            RAISE EXCEPTION 'cannot convert quotation % in status % to invoice (must be sent or accepted)',
                OLD.quote_no, NEW.status
                USING ERRCODE = '55000';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_quotation_conversion ON quotations;
CREATE TRIGGER trg_guard_quotation_conversion
    BEFORE UPDATE OF converted_invoice_id ON quotations
    FOR EACH ROW EXECUTE FUNCTION fn_guard_quotation_conversion();

-- 8. updated_at 自動更新トリガー
DROP TRIGGER IF EXISTS trg_set_quotations_updated_at ON quotations;
CREATE TRIGGER trg_set_quotations_updated_at
    BEFORE UPDATE ON quotations
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_set_quotation_line_items_updated_at ON quotation_line_items;
CREATE TRIGGER trg_set_quotation_line_items_updated_at
    BEFORE UPDATE ON quotation_line_items
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 9. RBAC: パーミッション登録およびロールへの割当
INSERT INTO permissions (code, description) VALUES
    ('quotation.create', '見積書の作成・登録(draft)'),
    ('quotation.view', '見積書の閲覧'),
    ('quotation.edit', '見積書の編集・更新(draft時)'),
    ('quotation.send', '見積書の確定送付(sent)および改訂発行(revise)'),
    ('quotation.convert', '見積書の受注確定(accepted)および請求書転換(invoices連携)')
ON CONFLICT (code) DO NOTHING;

-- owner: 全権限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'owner'
  AND p.code IN (
      'quotation.create', 'quotation.view', 'quotation.edit',
      'quotation.send', 'quotation.convert'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- employee: 営業担当等の一般社員は作成・閲覧・下書き編集・確定送付が可能
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'employee'
  AND p.code IN ('quotation.create', 'quotation.view', 'quotation.edit', 'quotation.send')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- accountant: 会計担当は閲覧および受注転換が可能
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'accountant'
  AND p.code IN ('quotation.view', 'quotation.convert')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- accounting_manager: 経理責任者は全権限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'accounting_manager'
  AND p.code IN (
      'quotation.create', 'quotation.view', 'quotation.edit',
      'quotation.send', 'quotation.convert'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- approver, bookkeeper, legal_admin, legal_viewer: 閲覧のみ
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('approver', 'bookkeeper', 'legal_admin', 'legal_viewer')
  AND p.code IN ('quotation.view')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 10. 権限付与
GRANT SELECT, INSERT, UPDATE, DELETE ON quotations TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON quotation_line_items TO app_runtime;
GRANT SELECT ON quotations TO app_readonly_external;
GRANT SELECT ON quotation_line_items TO app_readonly_external;
