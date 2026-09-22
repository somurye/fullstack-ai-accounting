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
--   - 職務分掌 (SoD) および 最小権限の原則
-- ==============================================================================

-- 1. role_permissions への初期パーミッション紐付け

-- owner: 全権限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'owner'
  AND p.code IN (
      'journal_entry.create', 'journal_entry.post', 'journal_entry.void',
      'invoice.issue', 'vendor_bill.approve', 'payment_batch.export',
      'expense_report.approve', 'payroll.import', 'tax_return.finalize'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- accounting_manager: 経理統括・月次決算・承認・税務申告
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'accounting_manager'
  AND p.code IN (
      'journal_entry.create', 'journal_entry.post', 'journal_entry.void',
      'invoice.issue', 'vendor_bill.approve', 'payment_batch.export',
      'expense_report.approve', 'payroll.import', 'tax_return.finalize'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- accountant: 日常経理・仕訳起票・請求書発行・FBデータ出力
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'accountant'
  AND p.code IN (
      'journal_entry.create', 'invoice.issue', 'payment_batch.export'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- bookkeeper: 記帳補助・仕訳ドラフト起票
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'bookkeeper'
  AND p.code IN (
      'journal_entry.create'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- approver: 経費承認・仕入請求書承認
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'approver'
  AND p.code IN (
      'expense_report.approve', 'vendor_bill.approve'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- payroll_admin: 給与CSV取込
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'payroll_admin'
  AND p.code IN (
      'payroll.import'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ※ viewer_external は意図的に静的パーミッションを持たず、external_access_grants で時限制御される。

-- 2. テーブル権限付与 (GRANT)
GRANT SELECT, INSERT, UPDATE, DELETE ON payslips TO app_runtime;
GRANT SELECT ON payslips TO app_readonly_external;

GRANT SELECT, INSERT, UPDATE, DELETE ON year_end_adjustments TO app_runtime;
GRANT SELECT ON year_end_adjustments TO app_readonly_external;
