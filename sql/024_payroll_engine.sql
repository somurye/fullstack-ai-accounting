-- ============================================================================
-- 024_payroll_engine.sql
-- Phase 3 Task 3 (P3-T3): 給与計算エンジン
--
-- 1. employee_payroll_profiles テーブル作成 (従業員給与・報酬プロファイル、有効期間・WORM不変性)
-- 2. payroll_periods テーブル作成 (給与計算対象期間)
-- 3. payroll_calculations テーブル作成 (給与計算結果・提案、金額スナップショット、計算根拠マスタID、確定後WORM不変性)
-- 4. 汎用承認エンジン (approval_rules / approval_requests) の target_type に 'payroll' を追加
-- 5. RLS (ENABLE + FORCE) による完全テナント分離
-- 6. テナント整合性トリガー (fail-closed)
-- 7. RBAC パーミッション定義およびロールへの割当
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. employee_payroll_profiles テーブル (従業員給与・報酬プロファイル)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_payroll_profiles (
    id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                     UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    employee_id                   UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    salary_type                   TEXT NOT NULL DEFAULT 'monthly',
    base_salary                   NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    hourly_wage                   NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    standard_monthly_remuneration NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    dependents_count              INTEGER NOT NULL DEFAULT 0,
    has_health_insurance          BOOLEAN NOT NULL DEFAULT TRUE,
    has_care_insurance            BOOLEAN NOT NULL DEFAULT FALSE,
    has_pension                   BOOLEAN NOT NULL DEFAULT TRUE,
    has_employment_insurance      BOOLEAN NOT NULL DEFAULT TRUE,
    resident_tax_amount           NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    prefecture                    TEXT,
    effective_from                DATE NOT NULL,
    effective_to                  DATE,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_payroll_profile_salary_type CHECK (salary_type IN ('monthly', 'hourly')),
    CONSTRAINT chk_payroll_profile_base_salary_nonneg CHECK (base_salary >= 0),
    CONSTRAINT chk_payroll_profile_hourly_wage_nonneg CHECK (hourly_wage >= 0),
    CONSTRAINT chk_payroll_profile_smr_nonneg CHECK (standard_monthly_remuneration >= 0),
    CONSTRAINT chk_payroll_profile_dependents_nonneg CHECK (dependents_count >= 0),
    CONSTRAINT chk_payroll_profile_resident_tax_nonneg CHECK (resident_tax_amount >= 0),
    CONSTRAINT chk_payroll_profile_period CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT excl_payroll_profile_period EXCLUDE USING gist (
        tenant_id WITH =,
        employee_id WITH =,
        daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
    )
);

CREATE INDEX IF NOT EXISTS ix_payroll_profiles_tenant_employee ON employee_payroll_profiles (tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS ix_payroll_profiles_effective_dates ON employee_payroll_profiles (tenant_id, effective_from, effective_to);

-- RLS
ALTER TABLE employee_payroll_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_payroll_profiles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_employee_payroll_profiles ON employee_payroll_profiles;
CREATE POLICY tenant_isolation_employee_payroll_profiles ON employee_payroll_profiles
    FOR ALL
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    );

-- テナント整合性トリガー
CREATE OR REPLACE FUNCTION fn_validate_payroll_profile_tenant()
RETURNS TRIGGER AS $$
DECLARE
    v_emp_tenant UUID;
BEGIN
    SELECT tenant_id INTO v_emp_tenant
    FROM employees
    WHERE id = NEW.employee_id;

    IF NOT FOUND OR v_emp_tenant != NEW.tenant_id THEN
        RAISE EXCEPTION 'employee % does not belong to tenant %',
            NEW.employee_id, NEW.tenant_id
            USING ERRCODE = '23503';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_payroll_profile_tenant ON employee_payroll_profiles;
CREATE TRIGGER trg_validate_payroll_profile_tenant
    BEFORE INSERT OR UPDATE ON employee_payroll_profiles
    FOR EACH ROW EXECUTE FUNCTION fn_validate_payroll_profile_tenant();

-- 過去データ改変防止トリガー (WORM / P3-T2踏襲)
CREATE OR REPLACE FUNCTION fn_enforce_payroll_profile_immutability()
RETURNS TRIGGER AS $$
DECLARE
    v_today_jst DATE;
BEGIN
    v_today_jst := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::date;

    IF TG_OP = 'UPDATE' THEN
        -- 適用開始日を過ぎている過去プロファイルの場合
        IF OLD.effective_from <= v_today_jst THEN
            -- 既に有効終了日が確定しているレコードは一切の変更を禁止
            IF OLD.effective_to IS NOT NULL THEN
                RAISE EXCEPTION 'Past payroll profile with fixed effective_to cannot be modified (id: %, effective_from: %, effective_to: %). Create a new profile instead.',
                    OLD.id, OLD.effective_from, OLD.effective_to
                    USING ERRCODE = '55000';
            END IF;

            -- 終了日未定の進行中レコードの場合: 終了日(effective_to)を設定するクローズ操作のみ許可
            IF OLD.effective_to IS NULL THEN
                IF NEW.effective_to IS NULL THEN
                    RAISE EXCEPTION 'Active payroll profile in effect cannot be modified in-place (id: %). To update salary details, set effective_to to close this record and insert a new profile.',
                        OLD.id
                        USING ERRCODE = '55000';
                END IF;

                IF NEW.effective_to < OLD.effective_from THEN
                    RAISE EXCEPTION 'effective_to (%) cannot be earlier than effective_from (%)',
                        NEW.effective_to, OLD.effective_from
                        USING ERRCODE = '23514';
                END IF;

                -- 終了日以外の業務値が変更されていないことを厳格に検証
                IF NEW.tenant_id != OLD.tenant_id OR
                   NEW.employee_id != OLD.employee_id OR
                   NEW.salary_type != OLD.salary_type OR
                   NEW.base_salary != OLD.base_salary OR
                   NEW.hourly_wage != OLD.hourly_wage OR
                   NEW.standard_monthly_remuneration != OLD.standard_monthly_remuneration OR
                   NEW.dependents_count != OLD.dependents_count OR
                   NEW.has_health_insurance != OLD.has_health_insurance OR
                   NEW.has_care_insurance != OLD.has_care_insurance OR
                   NEW.has_pension != OLD.has_pension OR
                   NEW.has_employment_insurance != OLD.has_employment_insurance OR
                   NEW.resident_tax_amount != OLD.resident_tax_amount OR
                   COALESCE(NEW.prefecture, '') != COALESCE(OLD.prefecture, '') OR
                   NEW.effective_from != OLD.effective_from THEN
                    RAISE EXCEPTION 'Cannot modify salary attributes when closing an active payroll profile (id: %). Only effective_to can be updated.',
                        OLD.id
                        USING ERRCODE = '55000';
                END IF;
            END IF;
        END IF;

        NEW.updated_at := now();
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.effective_from <= v_today_jst THEN
            RAISE EXCEPTION 'Past or currently effective payroll profile cannot be deleted (id: %, effective_from: %).',
                OLD.id, OLD.effective_from
                USING ERRCODE = '55000';
        END IF;
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_payroll_profile_immutability ON employee_payroll_profiles;
CREATE TRIGGER trg_enforce_payroll_profile_immutability
    BEFORE UPDATE OR DELETE ON employee_payroll_profiles
    FOR EACH ROW EXECUTE FUNCTION fn_enforce_payroll_profile_immutability();


-- ----------------------------------------------------------------------------
-- 2. payroll_periods テーブル (給与計算対象期間)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_periods (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    name         TEXT NOT NULL,
    period_start DATE NOT NULL,
    period_end   DATE NOT NULL,
    payment_date DATE NOT NULL,
    status       TEXT NOT NULL DEFAULT 'draft',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_payroll_periods_name_nonempty CHECK (length(trim(name)) > 0),
    CONSTRAINT chk_payroll_periods_dates CHECK (period_end >= period_start),
    CONSTRAINT chk_payroll_periods_status CHECK (status IN ('draft', 'calculating', 'calculated', 'approved', 'closed')),
    CONSTRAINT uq_payroll_periods_period UNIQUE (tenant_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS ix_payroll_periods_tenant_status ON payroll_periods (tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_payroll_periods_dates ON payroll_periods (tenant_id, period_start, period_end);

-- RLS
ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_periods FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_payroll_periods ON payroll_periods;
CREATE POLICY tenant_isolation_payroll_periods ON payroll_periods
    FOR ALL
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    );


-- ----------------------------------------------------------------------------
-- 3. payroll_calculations テーブル (給与計算結果・提案)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payroll_calculations (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                  UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    payroll_period_id          UUID NOT NULL REFERENCES payroll_periods(id) ON DELETE RESTRICT,
    employee_id                UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,

    -- 労働時間スナップショット
    regular_hours              NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
    overtime_hours             NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
    late_night_hours           NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
    holiday_hours              NUMERIC(6, 2) NOT NULL DEFAULT 0.00,

    -- 支給項目スナップショット
    salary_type                TEXT NOT NULL DEFAULT 'monthly',
    base_salary                NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    hourly_wage                NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    regular_pay                NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    overtime_pay               NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    late_night_pay             NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    holiday_pay                NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_gross_pay            NUMERIC(12, 2) NOT NULL DEFAULT 0.00,

    -- 控除項目スナップショット
    health_insurance_amount    NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    care_insurance_amount      NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    pension_amount             NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    employment_insurance_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    income_tax_amount          NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    resident_tax_amount        NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_deductions           NUMERIC(12, 2) NOT NULL DEFAULT 0.00,

    -- 差引支給額
    net_pay                    NUMERIC(12, 2) NOT NULL DEFAULT 0.00,

    -- 計算根拠マスタ参照 (追跡可能性: 参照した料率マスタID、源泉徴収税額表ID群)
    applied_rate_ids           JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- ステータスおよび承認監査情報
    status                     TEXT NOT NULL DEFAULT 'draft',
    created_by                 UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    approved_at                TIMESTAMPTZ,
    approval_request_id        UUID, -- 汎用承認リクエストへの参照 (SET NULL)
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_payroll_calc_status CHECK (status IN ('draft', 'pending_approval', 'active', 'rejected')),
    CONSTRAINT chk_payroll_calc_hours CHECK (regular_hours >= 0 AND overtime_hours >= 0 AND late_night_hours >= 0 AND holiday_hours >= 0),
    CONSTRAINT chk_payroll_calc_amounts CHECK (
        base_salary >= 0 AND regular_pay >= 0 AND overtime_pay >= 0 AND
        late_night_pay >= 0 AND holiday_pay >= 0 AND total_gross_pay >= 0 AND
        health_insurance_amount >= 0 AND care_insurance_amount >= 0 AND
        pension_amount >= 0 AND employment_insurance_amount >= 0 AND
        income_tax_amount >= 0 AND resident_tax_amount >= 0 AND
        total_deductions >= 0
    ),
    CONSTRAINT uq_payroll_calc_period_employee UNIQUE (tenant_id, payroll_period_id, employee_id)
);

CREATE INDEX IF NOT EXISTS ix_payroll_calc_tenant_period ON payroll_calculations (tenant_id, payroll_period_id);
CREATE INDEX IF NOT EXISTS ix_payroll_calc_tenant_employee ON payroll_calculations (tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS ix_payroll_calc_tenant_status ON payroll_calculations (tenant_id, status);

-- RLS
ALTER TABLE payroll_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_calculations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_payroll_calculations ON payroll_calculations;
CREATE POLICY tenant_isolation_payroll_calculations ON payroll_calculations
    FOR ALL
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    );

-- テナント整合性トリガー
CREATE OR REPLACE FUNCTION fn_validate_payroll_calculation_consistency()
RETURNS TRIGGER AS $$
DECLARE
    v_period_tenant UUID;
    v_emp_tenant    UUID;
    v_user_tenant   BOOLEAN;
    v_rate_elem     JSONB;
    v_rate_id_text  TEXT;
    v_rate_id       UUID;
    v_rate_type     TEXT;
    v_match_tenant  UUID;
BEGIN
    -- 1. payroll_period_id のテナント一致検証
    SELECT tenant_id INTO v_period_tenant
    FROM payroll_periods
    WHERE id = NEW.payroll_period_id;

    IF NOT FOUND OR v_period_tenant != NEW.tenant_id THEN
        RAISE EXCEPTION 'payroll_period % does not belong to tenant %',
            NEW.payroll_period_id, NEW.tenant_id
            USING ERRCODE = '23503';
    END IF;

    -- 2. employee_id のテナント一致検証
    SELECT tenant_id INTO v_emp_tenant
    FROM employees
    WHERE id = NEW.employee_id;

    IF NOT FOUND OR v_emp_tenant != NEW.tenant_id THEN
        RAISE EXCEPTION 'employee % does not belong to tenant %',
            NEW.employee_id, NEW.tenant_id
            USING ERRCODE = '23503';
    END IF;

    -- 3. created_by ユーザーのテナント所属検証
    SELECT EXISTS (
        SELECT 1 FROM tenant_users
        WHERE tenant_id = NEW.tenant_id AND user_id = NEW.created_by
    ) INTO v_user_tenant;

    IF NOT v_user_tenant THEN
        RAISE EXCEPTION 'user % does not belong to tenant %',
            NEW.created_by, NEW.tenant_id
            USING ERRCODE = '23503';
    END IF;

    -- 4. applied_rate_ids の各参照マスタが同一テナントに属していることの検証 (他テナント料率マスタ参照の遮断)
    IF NEW.applied_rate_ids IS NOT NULL AND jsonb_typeof(NEW.applied_rate_ids) = 'array' THEN
        FOR v_rate_elem IN SELECT * FROM jsonb_array_elements(NEW.applied_rate_ids)
        LOOP
            v_rate_id_text := v_rate_elem->>'rate_id';
            v_rate_type    := v_rate_elem->>'type';

            IF v_rate_id_text IS NOT NULL THEN
                v_rate_id := v_rate_id_text::uuid;
                IF v_rate_type = 'income_tax' THEN
                    SELECT tenant_id INTO v_match_tenant
                    FROM income_tax_withholding_brackets
                    WHERE id = v_rate_id;

                    IF FOUND AND v_match_tenant != NEW.tenant_id THEN
                        RAISE EXCEPTION 'Cross-tenant reference detected: tax bracket % belongs to tenant %, not %',
                            v_rate_id, v_match_tenant, NEW.tenant_id
                            USING ERRCODE = '23503';
                    END IF;
                ELSE
                    SELECT tenant_id INTO v_match_tenant
                    FROM insurance_rate_tables
                    WHERE id = v_rate_id;

                    IF FOUND AND v_match_tenant != NEW.tenant_id THEN
                        RAISE EXCEPTION 'Cross-tenant reference detected: insurance rate % belongs to tenant %, not %',
                            v_rate_id, v_match_tenant, NEW.tenant_id
                            USING ERRCODE = '23503';
                    END IF;
                END IF;
            END IF;
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_payroll_calculation_consistency ON payroll_calculations;
CREATE TRIGGER trg_validate_payroll_calculation_consistency
    BEFORE INSERT OR UPDATE ON payroll_calculations
    FOR EACH ROW EXECUTE FUNCTION fn_validate_payroll_calculation_consistency();

-- 確定境界・確定後改変禁止トリガー (WORM / fail-closed / DB最終防御: approval_requests実在確認)
CREATE OR REPLACE FUNCTION fn_enforce_payroll_calculation_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- 初期登録時に直接 active で作成することは禁止 (必ず draft 提案から開始し、承認完了レコードが必要)
        IF NEW.status = 'active' THEN
            IF NOT EXISTS (
                SELECT 1 FROM approval_requests
                WHERE target_type = 'payroll'
                  AND target_id = NEW.id
                  AND tenant_id = NEW.tenant_id
                  AND status = 'approved'
            ) THEN
                RAISE EXCEPTION 'Payroll calculation cannot be created directly as active (id: %, employee_id: %). Approved approval_request record does not exist.',
                    NEW.id, NEW.employee_id
                    USING ERRCODE = '55000';
            END IF;
        END IF;

        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        -- 確定済み (active) レコードに対する改変は一切禁止 (確定後WORM不変性)
        IF OLD.status = 'active' THEN
            RAISE EXCEPTION 'Active payroll calculation record cannot be modified (id: %, employee_id: %). Confirmed payroll records are immutable.',
                OLD.id, OLD.employee_id
                USING ERRCODE = '55000';
        END IF;

        -- 確定境界のDB最終防御 (誰がactiveにできるか / B案: approval_requests実在確認)
        -- draft / pending_approval / rejected から active への直接遷移をDB層で遮断
        -- 同一テナントかつ同一target_idの承認完了レコード (status = 'approved') が実在することを検証
        IF NEW.status = 'active' AND OLD.status IN ('draft', 'pending_approval', 'rejected') THEN
            IF NOT EXISTS (
                SELECT 1 FROM approval_requests
                WHERE target_type = 'payroll'
                  AND target_id = NEW.id
                  AND tenant_id = NEW.tenant_id
                  AND status = 'approved'
            ) THEN
                RAISE EXCEPTION 'Direct transition to active is prohibited (id: %, employee_id: %). Approved approval_request record does not exist.',
                    OLD.id, OLD.employee_id
                    USING ERRCODE = '55000';
            END IF;
        END IF;

        NEW.updated_at := now();
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        -- 確定済み (active) レコードの物理削除は一切禁止
        IF OLD.status = 'active' THEN
            RAISE EXCEPTION 'Active payroll calculation record cannot be deleted (id: %, employee_id: %).',
                OLD.id, OLD.employee_id
                USING ERRCODE = '55000';
        END IF;

        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_payroll_calculation_immutability ON payroll_calculations;
CREATE TRIGGER trg_enforce_payroll_calculation_immutability
    BEFORE INSERT OR UPDATE OR DELETE ON payroll_calculations
    FOR EACH ROW EXECUTE FUNCTION fn_enforce_payroll_calculation_immutability();


-- ----------------------------------------------------------------------------
-- 4. 汎用承認エンジン (approval_rules / approval_requests) target_type 拡張
-- ----------------------------------------------------------------------------
ALTER TABLE approval_rules
    DROP CONSTRAINT IF EXISTS approval_rules_target_type_check;

ALTER TABLE approval_rules
    ADD CONSTRAINT approval_rules_target_type_check
    CHECK (target_type IN ('journal_entry', 'expense_report', 'vendor_bill', 'contract', 'purchase_request', 'general_request', 'payroll'));

ALTER TABLE approval_requests
    DROP CONSTRAINT IF EXISTS approval_requests_target_type_check;

ALTER TABLE approval_requests
    ADD CONSTRAINT approval_requests_target_type_check
    CHECK (target_type IN ('journal_entry', 'expense_report', 'vendor_bill', 'contract', 'purchase_request', 'general_request', 'payroll'));


-- ----------------------------------------------------------------------------
-- 5. RBAC パーミッション登録およびロール割当
-- ----------------------------------------------------------------------------
INSERT INTO permissions (code, description) VALUES
    ('payroll.create', '給与計算・プロファイルの作成および計算実行'),
    ('payroll.view', '給与計算・プロファイル結果の閲覧'),
    ('payroll.approve', '給与計算の承認')
ON CONFLICT (code) DO NOTHING;

-- owner: 全権限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'owner'
  AND p.code IN ('payroll.create', 'payroll.view', 'payroll.approve')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- payroll_admin: 全権限 (労務・給与管理者)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'payroll_admin'
  AND p.code IN ('payroll.create', 'payroll.view', 'payroll.approve')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- accounting_manager: 全権限 (経理責任者)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'accounting_manager'
  AND p.code IN ('payroll.create', 'payroll.view', 'payroll.approve')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- approver: 閲覧および承認権限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'approver'
  AND p.code IN ('payroll.view', 'payroll.approve')
ON CONFLICT (role_id, permission_id) DO NOTHING;


-- ----------------------------------------------------------------------------
-- 6. ロール権限付与 (GRANT)
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON employee_payroll_profiles TO app_runtime;
GRANT SELECT ON employee_payroll_profiles TO app_readonly_external;

GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_periods TO app_runtime;
GRANT SELECT ON payroll_periods TO app_readonly_external;

GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_calculations TO app_runtime;
GRANT SELECT ON payroll_calculations TO app_readonly_external;

GRANT SELECT, INSERT, UPDATE, DELETE ON employees TO app_runtime;
GRANT SELECT ON employees TO app_readonly_external;

GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_records TO app_runtime;
GRANT SELECT ON attendance_records TO app_readonly_external;

GRANT SELECT, INSERT, UPDATE, DELETE ON insurance_rate_tables TO app_runtime;
GRANT SELECT ON insurance_rate_tables TO app_readonly_external;

GRANT SELECT, INSERT, UPDATE, DELETE ON income_tax_withholding_brackets TO app_runtime;
GRANT SELECT ON income_tax_withholding_brackets TO app_readonly_external;

