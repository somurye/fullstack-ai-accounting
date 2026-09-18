-- =========================================================================
-- 032_sales_dashboard.sql
-- Phase 4 Task 4 (P4-T4): 営業ダッシュボード・レポート RBAC権限追加
--
-- 変更内容:
-- 1. permissions テーブルへの dashboard.view 登録
-- 2. role_permissions への権限マッピング
-- =========================================================================

-- 1. RBAC 権限の追加 (dashboard.view)
INSERT INTO permissions (code, description) VALUES
    ('dashboard.view', '営業ダッシュボードおよび集計レポートの閲覧権限')
ON CONFLICT (code) DO NOTHING;

-- 2. ロールと権限の紐付け (role_permissions)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE p.code = 'dashboard.view'
  AND r.code IN (
    'owner',
    'accounting_manager',
    'accountant',
    'legal_admin',
    'legal_viewer',
    'approver',
    'bookkeeper',
    'employee'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;
