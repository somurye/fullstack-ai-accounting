-- ============================================================================
-- 022_insurance_and_tax_rates.sql
-- Phase 3 Task 2 (P3-T2): 保険料率・税率マスタ管理
--
-- 1. btree_gist 拡張の有効化 (EXCLUDE 制約による期間・所得範囲重複防止のため)
-- 2. insurance_rate_tables テーブル作成 (社会保険料率マスタ)
-- 3. income_tax_withholding_brackets テーブル作成 (源泉徴収税額表)
-- 4. RLS (ENABLE + FORCE) による完全テナント分離
-- 5. DB レベルの tenant 整合性トリガー (fail-closed)
-- 6. RBAC パーミッション定義およびロールへの割当
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. btree_gist 拡張の有効化
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ----------------------------------------------------------------------------
-- 2. insurance_rate_tables (社会保険料率マスタ)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS insurance_rate_tables (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    rate_type       TEXT NOT NULL,
    prefecture      TEXT,
    rate_employee   NUMERIC(7, 5) NOT NULL,
    rate_employer   NUMERIC(7, 5) NOT NULL,
    effective_from  DATE NOT NULL,
    effective_to    DATE,
    description     TEXT,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_insurance_rate_type CHECK (
        rate_type IN ('health_insurance', 'care_insurance', 'pension', 'employment_insurance')
    ),
    CONSTRAINT chk_insurance_rate_rates_nonneg CHECK (
        rate_employee >= 0 AND rate_employee <= 1 AND
        rate_employer >= 0 AND rate_employer <= 1
    ),
    CONSTRAINT chk_insurance_rate_dates CHECK (
        effective_to IS NULL OR effective_to >= effective_from
    ),
    -- 同一テナント・同一料率種別・同一都道府県について有効期間が重複しないことをDBレベルで保証
    CONSTRAINT excl_insurance_rate_period EXCLUDE USING gist (
        tenant_id WITH =,
        rate_type WITH =,
        COALESCE(prefecture, '') WITH =,
        daterange(effective_from, effective_to, '[]') WITH &&
    )
);

CREATE INDEX IF NOT EXISTS ix_insurance_rate_tenant_type ON insurance_rate_tables (tenant_id, rate_type);
CREATE INDEX IF NOT EXISTS ix_insurance_rate_tenant_dates ON insurance_rate_tables (tenant_id, effective_from, effective_to);

-- RLS
ALTER TABLE insurance_rate_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_rate_tables FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_insurance_rate_tables ON insurance_rate_tables;
CREATE POLICY tenant_isolation_insurance_rate_tables ON insurance_rate_tables
    FOR ALL
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    );

-- ----------------------------------------------------------------------------
-- 3. income_tax_withholding_brackets (源泉徴収税額表)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS income_tax_withholding_brackets (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    dependents_count  INTEGER NOT NULL DEFAULT 0,
    income_min        NUMERIC(12, 2) NOT NULL,
    income_max        NUMERIC(12, 2),
    tax_amount        NUMERIC(12, 2) NOT NULL,
    effective_from    DATE NOT NULL,
    effective_to      DATE,
    description       TEXT,
    created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_tax_brackets_dependents_nonneg CHECK (dependents_count >= 0),
    CONSTRAINT chk_tax_brackets_income_valid CHECK (
        income_min >= 0 AND (income_max IS NULL OR income_max > income_min)
    ),
    CONSTRAINT chk_tax_brackets_tax_nonneg CHECK (tax_amount >= 0),
    CONSTRAINT chk_tax_brackets_dates CHECK (
        effective_to IS NULL OR effective_to >= effective_from
    ),
    -- 同一テナント・同一扶養人数において有効期間と所得範囲が同時に重複しないことをDBレベルで保証
    CONSTRAINT excl_tax_brackets_period_income EXCLUDE USING gist (
        tenant_id WITH =,
        dependents_count WITH =,
        daterange(effective_from, effective_to, '[]') WITH &&,
        numrange(income_min, income_max, '[)') WITH &&
    )
);

CREATE INDEX IF NOT EXISTS ix_tax_brackets_tenant_dep ON income_tax_withholding_brackets (tenant_id, dependents_count);
CREATE INDEX IF NOT EXISTS ix_tax_brackets_tenant_dates ON income_tax_withholding_brackets (tenant_id, effective_from, effective_to);

-- RLS
ALTER TABLE income_tax_withholding_brackets ENABLE ROW LEVEL SECURITY;
ALTER TABLE income_tax_withholding_brackets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_income_tax_withholding_brackets ON income_tax_withholding_brackets;
CREATE POLICY tenant_isolation_income_tax_withholding_brackets ON income_tax_withholding_brackets
    FOR ALL
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    );

-- ----------------------------------------------------------------------------
-- 4. テナント整合性トリガー (created_by fail-closed検証)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_validate_rate_master_tenant()
RETURNS TRIGGER AS $$
DECLARE
    v_tu_exists BOOLEAN;
BEGIN
    IF NEW.created_by IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM tenant_users
            WHERE tenant_id = NEW.tenant_id AND user_id = NEW.created_by
        ) INTO v_tu_exists;

        IF NOT v_tu_exists THEN
            RAISE EXCEPTION 'created_by user % does not belong to tenant %',
                NEW.created_by, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_insurance_rate_tables_tenant ON insurance_rate_tables;
CREATE TRIGGER trg_validate_insurance_rate_tables_tenant
    BEFORE INSERT OR UPDATE ON insurance_rate_tables
    FOR EACH ROW EXECUTE FUNCTION fn_validate_rate_master_tenant();

DROP TRIGGER IF EXISTS trg_validate_tax_brackets_tenant ON income_tax_withholding_brackets;
CREATE TRIGGER trg_validate_tax_brackets_tenant
    BEFORE INSERT OR UPDATE ON income_tax_withholding_brackets
    FOR EACH ROW EXECUTE FUNCTION fn_validate_rate_master_tenant();

-- ----------------------------------------------------------------------------
-- 5. RBAC パーミッション登録およびロール割当
-- ----------------------------------------------------------------------------
INSERT INTO permissions (code, description) VALUES
    ('rate_master.create', '保険料率・税率マスタの登録'),
    ('rate_master.view', '保険料率・税率マスタの閲覧'),
    ('rate_master.edit', '保険料率・税率マスタの編集・更新')
ON CONFLICT (code) DO NOTHING;

-- owner: 全権限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'owner'
  AND p.code IN ('rate_master.create', 'rate_master.view', 'rate_master.edit')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- payroll_admin: 全権限 (労務・給与管理者)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'payroll_admin'
  AND p.code IN ('rate_master.create', 'rate_master.view', 'rate_master.edit')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- accounting_manager / approver: 閲覧のみ
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('accounting_manager', 'approver')
  AND p.code = 'rate_master.view'
ON CONFLICT (role_id, permission_id) DO NOTHING;
