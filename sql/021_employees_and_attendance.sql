-- ============================================================================
-- 021_employees_and_attendance.sql
-- Phase 3 Task 1 (P3-T1): 従業員マスタ・勤怠管理
--
-- 1. employees テーブル作成 (従業員マスタ)
-- 2. attendance_records テーブル作成 (打刻・労働時間集計)
-- 3. RLS (ENABLE + FORCE) による完全テナント分離
-- 4. DB レベルの tenant 整合性トリガー (fail-closed)
-- 5. RBAC パーミッション定義およびロールへの割当
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. employees テーブル (従業員マスタ)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    employee_no     TEXT NOT NULL,
    name            TEXT NOT NULL,
    department_id   UUID REFERENCES departments(id) ON DELETE SET NULL,
    hire_date       DATE NOT NULL,
    employment_type TEXT NOT NULL DEFAULT 'full_time',
    status          TEXT NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_employees_tenant_employee_no UNIQUE (tenant_id, employee_no),
    CONSTRAINT chk_employees_name_nonempty CHECK (length(trim(name)) > 0),
    CONSTRAINT chk_employees_employee_no_nonempty CHECK (length(trim(employee_no)) > 0),
    CONSTRAINT chk_employees_employment_type CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'temporary')),
    CONSTRAINT chk_employees_status CHECK (status IN ('active', 'inactive'))
);

CREATE INDEX IF NOT EXISTS ix_employees_tenant_status ON employees (tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_employees_tenant_user_id ON employees (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS ix_employees_tenant_department ON employees (tenant_id, department_id);

-- RLS
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_employees ON employees;
CREATE POLICY tenant_isolation_employees ON employees
    FOR ALL
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    );

-- ----------------------------------------------------------------------------
-- 2. employees テナント整合性トリガー
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_validate_employee_tenant()
RETURNS TRIGGER AS $$
DECLARE
    v_dept_tenant UUID;
    v_tu_exists   BOOLEAN;
BEGIN
    -- user_id が指定されている場合、該当ユーザーが同一テナントに所属しているかを検証
    IF NEW.user_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM tenant_users
            WHERE tenant_id = NEW.tenant_id AND user_id = NEW.user_id
        ) INTO v_tu_exists;

        IF NOT v_tu_exists THEN
            RAISE EXCEPTION 'user % does not belong to tenant %',
                NEW.user_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    -- department_id が指定されている場合、部門が同一テナントに属しているかを検証
    IF NEW.department_id IS NOT NULL THEN
        SELECT tenant_id INTO v_dept_tenant
        FROM departments
        WHERE id = NEW.department_id;

        IF NOT FOUND OR v_dept_tenant != NEW.tenant_id THEN
            RAISE EXCEPTION 'department % does not belong to tenant %',
                NEW.department_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_employee_tenant ON employees;
CREATE TRIGGER trg_validate_employee_tenant
    BEFORE INSERT OR UPDATE ON employees
    FOR EACH ROW EXECUTE FUNCTION fn_validate_employee_tenant();

-- ----------------------------------------------------------------------------
-- 3. attendance_records テーブル (勤怠・打刻記録)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_records (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    employee_id       UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
    work_date         DATE NOT NULL,
    clock_in          TIMESTAMPTZ,
    clock_out         TIMESTAMPTZ,
    break_minutes     INTEGER NOT NULL DEFAULT 0,
    regular_hours     NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    overtime_hours    NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    late_night_hours  NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    holiday_hours     NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    is_holiday        BOOLEAN NOT NULL DEFAULT FALSE,
    note              TEXT,
    status            TEXT NOT NULL DEFAULT 'draft',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT uq_attendance_records_tenant_employee_date UNIQUE (tenant_id, employee_id, work_date),
    CONSTRAINT chk_attendance_clock_order CHECK (clock_out IS NULL OR clock_in IS NULL OR clock_out >= clock_in),
    CONSTRAINT chk_attendance_break_nonneg CHECK (break_minutes >= 0),
    CONSTRAINT chk_attendance_hours_nonneg CHECK (
        regular_hours >= 0 AND overtime_hours >= 0 AND late_night_hours >= 0 AND holiday_hours >= 0
    ),
    CONSTRAINT chk_attendance_status CHECK (status IN ('draft', 'submitted', 'approved'))
);

CREATE INDEX IF NOT EXISTS ix_attendance_records_tenant_employee ON attendance_records (tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS ix_attendance_records_tenant_date ON attendance_records (tenant_id, work_date);

-- RLS
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_attendance_records ON attendance_records;
CREATE POLICY tenant_isolation_attendance_records ON attendance_records
    FOR ALL
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    )
    WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    );

-- ----------------------------------------------------------------------------
-- 4. attendance_records テナント整合性・ステータス整合性トリガー
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_validate_attendance_record_consistency()
RETURNS TRIGGER AS $$
DECLARE
    v_emp_tenant UUID;
    v_emp_status TEXT;
BEGIN
    SELECT tenant_id, status
    INTO v_emp_tenant, v_emp_status
    FROM employees
    WHERE id = NEW.employee_id;

    IF NOT FOUND OR v_emp_tenant != NEW.tenant_id THEN
        RAISE EXCEPTION 'employee % does not belong to tenant %',
            NEW.employee_id, NEW.tenant_id
            USING ERRCODE = '23503';
    END IF;

    IF v_emp_status != 'active' THEN
        RAISE EXCEPTION 'cannot record attendance for inactive employee %',
            NEW.employee_id
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_attendance_record_consistency ON attendance_records;
CREATE TRIGGER trg_validate_attendance_record_consistency
    BEFORE INSERT OR UPDATE ON attendance_records
    FOR EACH ROW EXECUTE FUNCTION fn_validate_attendance_record_consistency();

-- ----------------------------------------------------------------------------
-- 5. RBAC パーミッション登録およびロール割当
-- ----------------------------------------------------------------------------
INSERT INTO permissions (code, description) VALUES
    ('employee.create', '従業員の登録'),
    ('employee.view', '従業員情報の閲覧'),
    ('employee.edit', '従業員情報の編集・更新'),
    ('attendance.create', '勤怠打刻・新規登録'),
    ('attendance.view', '勤怠記録の閲覧'),
    ('attendance.edit', '勤怠記録の編集・修正')
ON CONFLICT (code) DO NOTHING;

-- owner: 全権限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'owner'
  AND p.code IN (
      'employee.create', 'employee.view', 'employee.edit',
      'attendance.create', 'attendance.view', 'attendance.edit'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- payroll_admin: 全権限 (労務・給与担当)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'payroll_admin'
  AND p.code IN (
      'employee.create', 'employee.view', 'employee.edit',
      'attendance.create', 'attendance.view', 'attendance.edit'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- employee: 自身の照会、打刻、勤怠閲覧、勤怠編集
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'employee'
  AND p.code IN (
      'employee.view',
      'attendance.create', 'attendance.view', 'attendance.edit'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- accounting_manager / approver: 閲覧のみ
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('accounting_manager', 'approver')
  AND p.code IN ('employee.view', 'attendance.view')
ON CONFLICT (role_id, permission_id) DO NOTHING;
