-- ============================================================================
-- 025_payslips_and_year_end_adjustments.sql
-- Phase 3 Task 4 (P3-T4): 給与明細発行・年末調整
--
-- 1. payslips テーブル作成 (確定給与からの明細発行、スナップショット、WORM不変性)
-- 2. year_end_adjustments テーブル作成 (年末調整、還付/追徴計算、確定境界DB最終防御、WORM不変性)
-- 3. 汎用承認エンジン (approval_rules / approval_requests) の target_type に 'year_end_adjustment' を追加
-- 4. approval_history 承認権限検証トリガーの拡張
-- 5. RLS (ENABLE + FORCE) による完全テナント分離
-- 6. テナント整合性トリガー (fail-closed)
-- 7. RBAC パーミッション定義およびロールへの割当
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. payslips テーブル (給与明細)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payslips (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    payroll_calculation_id UUID NOT NULL REFERENCES payroll_calculations(id) ON DELETE RESTRICT,
    employee_id            UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    payroll_period         TEXT NOT NULL,
    payment_date           DATE NOT NULL,
    snapshot_data          JSONB NOT NULL DEFAULT '{}'::jsonb,
    status                 TEXT NOT NULL DEFAULT 'draft',
    issued_at              TIMESTAMPTZ,
    created_by             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_payslips_status CHECK (status IN ('draft', 'confirmed')),
    CONSTRAINT chk_payslips_period_nonempty CHECK (length(trim(payroll_period)) > 0),
    CONSTRAINT uq_payslips_calculation UNIQUE (tenant_id, payroll_calculation_id)
);

CREATE INDEX IF NOT EXISTS ix_payslips_tenant_employee ON payslips (tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS ix_payslips_tenant_period ON payslips (tenant_id, payroll_period);
CREATE INDEX IF NOT EXISTS ix_payslips_tenant_status ON payslips (tenant_id, status);

-- RLS
ALTER TABLE payslips ENABLE ROW LEVEL SECURITY;
ALTER TABLE payslips FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_payslips ON payslips;
CREATE POLICY tenant_isolation_payslips ON payslips
    FOR ALL
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    );

-- テナント整合性トリガー (payroll_calculations および employees とのテナント一致)
CREATE OR REPLACE FUNCTION fn_validate_payslip_tenant()
RETURNS TRIGGER AS $$
DECLARE
    v_calc_tenant UUID;
    v_calc_status TEXT;
    v_emp_tenant UUID;
BEGIN
    -- 1. payroll_calculations のテナントおよびステータス検証
    SELECT tenant_id, status INTO v_calc_tenant, v_calc_status
    FROM payroll_calculations
    WHERE id = NEW.payroll_calculation_id;

    IF NOT FOUND OR v_calc_tenant != NEW.tenant_id THEN
        RAISE EXCEPTION 'payroll_calculation % does not belong to tenant %',
            NEW.payroll_calculation_id, NEW.tenant_id
            USING ERRCODE = '23503';
    END IF;

    -- confirmed(確定発行)へ遷移または登録する場合、元となる給与計算が active であることをDB層で強制検証
    IF NEW.status = 'confirmed' AND v_calc_status != 'active' THEN
        RAISE EXCEPTION 'Cannot confirm payslip for non-active payroll_calculation (id: %, status: %). Payroll calculation must be approved and active.',
            NEW.payroll_calculation_id, v_calc_status
            USING ERRCODE = '55000';
    END IF;

    -- 2. employees のテナント検証
    SELECT tenant_id INTO v_emp_tenant
    FROM employees
    WHERE id = NEW.employee_id;

    IF NOT FOUND OR v_emp_tenant != NEW.tenant_id THEN
        RAISE EXCEPTION 'employee % does not belong to tenant %',
            NEW.employee_id, NEW.tenant_id
            USING ERRCODE = '23503';
    END IF;

    -- 3. created_by のテナント検証 (tenant_users 所属チェック)
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

DROP TRIGGER IF EXISTS trg_validate_payslip_tenant ON payslips;
CREATE TRIGGER trg_validate_payslip_tenant
    BEFORE INSERT OR UPDATE ON payslips
    FOR EACH ROW EXECUTE FUNCTION fn_validate_payslip_tenant();

-- WORM不変性トリガー (confirmed後の改変・削除禁止)
CREATE OR REPLACE FUNCTION fn_enforce_payslip_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'confirmed' THEN
            RAISE EXCEPTION 'Confirmed payslip cannot be modified (id: %, employee_id: %). Record is immutable.',
                OLD.id, OLD.employee_id
                USING ERRCODE = '55000';
        END IF;

        IF NEW.status = 'confirmed' AND OLD.status = 'draft' THEN
            NEW.issued_at := COALESCE(NEW.issued_at, now());
        END IF;

        NEW.updated_at := now();
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.status = 'confirmed' THEN
            RAISE EXCEPTION 'Confirmed payslip cannot be deleted (id: %, employee_id: %). Record is immutable.',
                OLD.id, OLD.employee_id
                USING ERRCODE = '55000';
        END IF;
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_payslip_immutability ON payslips;
CREATE TRIGGER trg_enforce_payslip_immutability
    BEFORE UPDATE OR DELETE ON payslips
    FOR EACH ROW EXECUTE FUNCTION fn_enforce_payslip_immutability();


-- ----------------------------------------------------------------------------
-- 2. year_end_adjustments テーブル (年末調整)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS year_end_adjustments (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    employee_id                     UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    tax_year                        INTEGER NOT NULL,

    -- 年間給与・社保・源泉税集計
    annual_gross_pay                NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    annual_taxable_pay              NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    annual_social_insurance         NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    annual_withheld_tax             NUMERIC(12, 2) NOT NULL DEFAULT 0.00,

    -- 所得控除スナップショット
    deductions                      JSONB NOT NULL DEFAULT '{}'::jsonb,
    total_deductions                NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    taxable_income_after_deductions NUMERIC(12, 2) NOT NULL DEFAULT 0.00,

    -- 年税額および過不足税額 (還付: 正, 追徴: 負)
    final_annual_tax                NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    adjustment_amount               NUMERIC(12, 2) NOT NULL DEFAULT 0.00,

    -- 計算根拠マスタID
    applied_rate_ids                JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- 状態遷移・承認・監査情報
    status                          TEXT NOT NULL DEFAULT 'draft',
    approval_request_id             UUID,
    approved_at                     TIMESTAMPTZ,
    created_by                      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_yea_tax_year CHECK (tax_year >= 2020 AND tax_year <= 2100),
    CONSTRAINT chk_yea_status CHECK (status IN ('draft', 'pending_approval', 'active', 'rejected')),
    CONSTRAINT chk_yea_amounts CHECK (
        annual_gross_pay >= 0 AND annual_taxable_pay >= 0 AND
        annual_social_insurance >= 0 AND annual_withheld_tax >= 0 AND
        total_deductions >= 0 AND taxable_income_after_deductions >= 0 AND
        final_annual_tax >= 0
    ),
    CONSTRAINT uq_year_end_adj_employee_year UNIQUE (tenant_id, employee_id, tax_year)
);

CREATE INDEX IF NOT EXISTS ix_yea_tenant_year ON year_end_adjustments (tenant_id, tax_year);
CREATE INDEX IF NOT EXISTS ix_yea_tenant_employee ON year_end_adjustments (tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS ix_yea_tenant_status ON year_end_adjustments (tenant_id, status);

-- RLS
ALTER TABLE year_end_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE year_end_adjustments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_year_end_adjustments ON year_end_adjustments;
CREATE POLICY tenant_isolation_year_end_adjustments ON year_end_adjustments
    FOR ALL
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    );

-- テナント整合性トリガー
CREATE OR REPLACE FUNCTION fn_validate_yea_tenant()
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

    -- created_by のテナント検証 (tenant_users 所属チェック)
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

DROP TRIGGER IF EXISTS trg_validate_yea_tenant ON year_end_adjustments;
CREATE TRIGGER trg_validate_yea_tenant
    BEFORE INSERT OR UPDATE ON year_end_adjustments
    FOR EACH ROW EXECUTE FUNCTION fn_validate_yea_tenant();

-- 確定境界DB最終防御およびWORM不変性トリガー (P3-T3パターン踏襲)
CREATE OR REPLACE FUNCTION fn_enforce_yea_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- 新規作成は必ず draft または pending_approval でなければならず、active直接INSERTは禁止
        IF NEW.status = 'active' THEN
            RAISE EXCEPTION 'Direct creation with status active is prohibited for year_end_adjustments. Approval process is required.'
                USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        -- 確定済み (active) レコードの通常UPDATEは一切禁止
        IF OLD.status = 'active' THEN
            RAISE EXCEPTION 'Active year_end_adjustments record cannot be modified (id: %, employee_id: %, tax_year: %). Record is immutable.',
                OLD.id, OLD.employee_id, OLD.tax_year
                USING ERRCODE = '55000';
        END IF;

        -- 確定境界のDB最終防御 (approval_requests 実在確認)
        -- draft / pending_approval / rejected から active への遷移時、
        -- status = 'approved' の approval_requests 実在レコードを強制検証
        IF NEW.status = 'active' AND OLD.status IN ('draft', 'pending_approval', 'rejected') THEN
            IF NOT EXISTS (
                SELECT 1 FROM approval_requests
                WHERE target_type = 'year_end_adjustment'
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
            RAISE EXCEPTION 'Active year_end_adjustments record cannot be deleted (id: %, employee_id: %, tax_year: %). Record is immutable.',
                OLD.id, OLD.employee_id, OLD.tax_year
                USING ERRCODE = '55000';
        END IF;
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_yea_immutability ON year_end_adjustments;
CREATE TRIGGER trg_enforce_yea_immutability
    BEFORE INSERT OR UPDATE OR DELETE ON year_end_adjustments
    FOR EACH ROW EXECUTE FUNCTION fn_enforce_yea_immutability();


-- ----------------------------------------------------------------------------
-- 3. 汎用承認エンジン (approval_rules / approval_requests) target_type 拡張
-- ----------------------------------------------------------------------------
ALTER TABLE approval_rules
    DROP CONSTRAINT IF EXISTS approval_rules_target_type_check;

ALTER TABLE approval_rules
    ADD CONSTRAINT approval_rules_target_type_check
    CHECK (target_type IN (
        'journal_entry', 'expense_report', 'vendor_bill', 'contract',
        'purchase_request', 'general_request', 'payroll', 'year_end_adjustment'
    ));

ALTER TABLE approval_requests
    DROP CONSTRAINT IF EXISTS approval_requests_target_type_check;

ALTER TABLE approval_requests
    ADD CONSTRAINT approval_requests_target_type_check
    CHECK (target_type IN (
        'journal_entry', 'expense_report', 'vendor_bill', 'contract',
        'purchase_request', 'general_request', 'payroll', 'year_end_adjustment'
    ));


-- ----------------------------------------------------------------------------
-- 4. approval_history 承認権限検証トリガーの拡張
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_enforce_approval_history_authority()
RETURNS TRIGGER AS $$
DECLARE
    v_req RECORD;
    v_required_permission TEXT;
    v_has_permission BOOLEAN;
BEGIN
    -- 1. approval_requests の取得
    SELECT id, tenant_id, target_type, submitted_by, current_step, total_steps, status
    INTO v_req
    FROM approval_requests
    WHERE id = NEW.approval_request_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'approval_request % does not exist', NEW.approval_request_id
            USING ERRCODE = '23503';
    END IF;

    -- テナント一致検証
    IF NEW.tenant_id != v_req.tenant_id THEN
        RAISE EXCEPTION 'Tenant mismatch: approval_history (%) vs approval_request (%)',
            NEW.tenant_id, v_req.tenant_id
            USING ERRCODE = '23503';
    END IF;

    -- 承認操作(action = 'approve')時の自己承認禁止 (既存トリガーに加えDB二重防御)
    IF NEW.action = 'approve' AND NEW.approver_id = v_req.submitted_by THEN
        RAISE EXCEPTION 'Self-approval is not permitted (submitter=%, approver=%)',
            v_req.submitted_by, NEW.approver_id
            USING ERRCODE = '23514';
    END IF;

    -- 2. target_type に応じた承認権限コードの特定
    CASE v_req.target_type
        WHEN 'payroll' THEN v_required_permission := 'payroll.approve';
        WHEN 'year_end_adjustment' THEN v_required_permission := 'year_end_adjustment.approve';
        WHEN 'contract' THEN v_required_permission := 'contract.approve';
        WHEN 'general_request' THEN v_required_permission := 'general_request.approve';
        WHEN 'purchase_request' THEN v_required_permission := 'purchase_request.approve';
        WHEN 'vendor_bill' THEN v_required_permission := 'vendor_bill.approve';
        WHEN 'journal_entry' THEN v_required_permission := 'journal_entry.post';
        WHEN 'expense_report' THEN v_required_permission := 'expense_report.approve';
        ELSE v_required_permission := NULL;
    END CASE;

    -- 3. 権限保有の検証 (user_roles / role_permissions / permissions 実データによる検証)
    IF v_required_permission IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1
            FROM user_roles ur
            JOIN role_permissions rp ON rp.role_id = ur.role_id
            JOIN permissions p ON p.id = rp.permission_id
            WHERE ur.tenant_id = NEW.tenant_id
              AND ur.user_id = NEW.approver_id
              AND p.code = v_required_permission
        ) INTO v_has_permission;

        IF NOT v_has_permission THEN
            RAISE EXCEPTION 'Approver % does not hold required permission % for target %',
                NEW.approver_id, v_required_permission, v_req.target_type
                USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ----------------------------------------------------------------------------
-- 5. RBAC パーミッション定義およびロール割当
-- ----------------------------------------------------------------------------
INSERT INTO permissions (code, description)
VALUES
    ('payslip.view', '給与明細閲覧: 給与明細を閲覧する権限'),
    ('payslip.create', '給与明細発行: 確定給与から給与明細を発行・PDF出力する権限'),
    ('year_end_adjustment.view', '年末調整閲覧: 年末調整計算結果を閲覧する権限'),
    ('year_end_adjustment.create', '年末調整計算・申請: 年末調整の年税額集計・控除計算を実行し承認申請する権限'),
    ('year_end_adjustment.approve', '年末調整承認: 年末調整の承認・却下を行う権限')
ON CONFLICT (code) DO NOTHING;

-- ロールへのパーミッション付与 (owner, payroll_admin, accounting_manager, employee)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'owner'
  AND p.code IN (
      'payslip.view', 'payslip.create',
      'year_end_adjustment.view', 'year_end_adjustment.create', 'year_end_adjustment.approve'
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'payroll_admin'
  AND p.code IN (
      'payslip.view', 'payslip.create',
      'year_end_adjustment.view', 'year_end_adjustment.create', 'year_end_adjustment.approve'
  )
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'accounting_manager'
  AND p.code IN (
      'payslip.view',
      'year_end_adjustment.view', 'year_end_adjustment.approve'
  )
ON CONFLICT DO NOTHING;

-- employee は自身の給与明細と年末調整の閲覧のみ許可
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'employee'
  AND p.code IN (
      'payslip.view',
      'year_end_adjustment.view'
  )
ON CONFLICT DO NOTHING;
