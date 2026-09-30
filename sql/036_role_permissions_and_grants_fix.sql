-- ==============================================================================
-- 036_role_permissions_and_grants_fix.sql
--
-- 目的:
--   1. 001_initial_schema_all_in_one.sql で定義された初期パーミッション
--      (expense_report.approve, journal_entry.*, vendor_bill.approve 等) について、
--      role_permissions テーブルへの紐付けが欠落していた製品バグを修正する。
--      これにより、024/025で導入されたDB承認権限ガードトリガー
--      (trg_enforce_approval_history_authority) での認可が正常に成立する。
--   2. 025_payslips_and_year_end_adjustments.sql において作成された
--      `payslips` および `year_end_adjustments` テーブルに対して、
--      app_runtime および app_readonly_external への GRANT を付与する (025でのGRANT漏れ修正)。
--
-- 設計原則:
--   - 追記専用マイグレーション (append-only)
--   - fail-closed (想定行数・前提条件の不一致時は即座に例外送出・ロールバック)
--   - 職務分掌 (SoD) および 最小権限の原則
-- ==============================================================================

DO $$
DECLARE
    v_expected_pairs CONSTANT int := 25;
    v_actual_count int;
    v_missing_roles text;
    v_missing_perms text;
BEGIN
    -- 1. 事前検証: 必要なロールコードが存在するか確認 (fail-closed)
    SELECT string_agg(expected_role, ', ')
    INTO v_missing_roles
    FROM (
        VALUES ('owner'), ('accounting_manager'), ('accountant'), ('bookkeeper'), ('approver'), ('payroll_admin')
    ) AS t(expected_role)
    WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.code::text = t.expected_role);

    IF v_missing_roles IS NOT NULL THEN
        RAISE EXCEPTION 'Migration 036 fail-closed: 必要なロールがDBに存在しません (missing: %)', v_missing_roles
            USING ERRCODE = '23514';
    END IF;

    -- 2. 事前検証: 必要なパーミッションコードが存在するか確認 (fail-closed)
    SELECT string_agg(expected_perm, ', ')
    INTO v_missing_perms
    FROM (
        VALUES
            ('journal_entry.create'), ('journal_entry.post'), ('journal_entry.void'),
            ('invoice.issue'), ('vendor_bill.approve'), ('payment_batch.export'),
            ('expense_report.approve'), ('payroll.import'), ('tax_return.finalize')
    ) AS t(expected_perm)
    WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = t.expected_perm);

    IF v_missing_perms IS NOT NULL THEN
        RAISE EXCEPTION 'Migration 036 fail-closed: 必要な初期パーミッションがDBに存在しません (missing: %)', v_missing_perms
            USING ERRCODE = '23514';
    END IF;

    -- 3. role_permissions への初期パーミッション紐付け登録 (計25組)

    -- owner (9件)
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
    WHERE r.code = 'owner' AND p.code IN (
        'journal_entry.create', 'journal_entry.post', 'journal_entry.void',
        'invoice.issue', 'vendor_bill.approve', 'payment_batch.export',
        'expense_report.approve', 'payroll.import', 'tax_return.finalize'
    )
    ON CONFLICT (role_id, permission_id) DO NOTHING;

    -- accounting_manager (9件)
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
    WHERE r.code = 'accounting_manager' AND p.code IN (
        'journal_entry.create', 'journal_entry.post', 'journal_entry.void',
        'invoice.issue', 'vendor_bill.approve', 'payment_batch.export',
        'expense_report.approve', 'payroll.import', 'tax_return.finalize'
    )
    ON CONFLICT (role_id, permission_id) DO NOTHING;

    -- accountant (3件)
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
    WHERE r.code = 'accountant' AND p.code IN (
        'journal_entry.create', 'invoice.issue', 'payment_batch.export'
    )
    ON CONFLICT (role_id, permission_id) DO NOTHING;

    -- bookkeeper (1件)
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
    WHERE r.code = 'bookkeeper' AND p.code IN ('journal_entry.create')
    ON CONFLICT (role_id, permission_id) DO NOTHING;

    -- approver (2件)
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
    WHERE r.code = 'approver' AND p.code IN ('expense_report.approve', 'vendor_bill.approve')
    ON CONFLICT (role_id, permission_id) DO NOTHING;

    -- payroll_admin (1件)
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
    WHERE r.code = 'payroll_admin' AND p.code IN ('payroll.import')
    ON CONFLICT (role_id, permission_id) DO NOTHING;

    -- 4. 事後検証: 想定される25組が厳密に登録されたことを検証 (fail-closed)
    SELECT COUNT(*)
    INTO v_actual_count
    FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE (
        (r.code = 'owner' AND p.code IN ('journal_entry.create', 'journal_entry.post', 'journal_entry.void', 'invoice.issue', 'vendor_bill.approve', 'payment_batch.export', 'expense_report.approve', 'payroll.import', 'tax_return.finalize'))
        OR (r.code = 'accounting_manager' AND p.code IN ('journal_entry.create', 'journal_entry.post', 'journal_entry.void', 'invoice.issue', 'vendor_bill.approve', 'payment_batch.export', 'expense_report.approve', 'payroll.import', 'tax_return.finalize'))
        OR (r.code = 'accountant' AND p.code IN ('journal_entry.create', 'invoice.issue', 'payment_batch.export'))
        OR (r.code = 'bookkeeper' AND p.code IN ('journal_entry.create'))
        OR (r.code = 'approver' AND p.code IN ('expense_report.approve', 'vendor_bill.approve'))
        OR (r.code = 'payroll_admin' AND p.code IN ('payroll.import'))
    );

    IF v_actual_count != v_expected_pairs THEN
        RAISE EXCEPTION 'Migration 036 fail-closed: 登録後のrole_permissions件数が想定と一致しません (expected: %, actual: %)',
            v_expected_pairs, v_actual_count
            USING ERRCODE = '23514';
    END IF;

    RAISE NOTICE 'Migration 036: % 件の初期パーミッション紐付けが正常に検証されました', v_actual_count;
END;
$$ LANGUAGE plpgsql;

-- 5. テーブル権限付与 (GRANT)
GRANT SELECT, INSERT, UPDATE, DELETE ON payslips TO app_runtime;
GRANT SELECT ON payslips TO app_readonly_external;

GRANT SELECT, INSERT, UPDATE, DELETE ON year_end_adjustments TO app_runtime;
GRANT SELECT ON year_end_adjustments TO app_readonly_external;
