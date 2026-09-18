-- =========================================================================
-- 033_executive_dashboard.sql
-- Phase 5 Task 1 (P5-T1): 横断KPIダッシュボード基盤 RBAC権限追加
--
-- 変更内容:
-- 1. permissions テーブルへの dashboard.executive_view 登録
-- 2. role_permissions への権限マッピング (経営・管理者ロール限定)
-- =========================================================================

-- 1. RBAC 権限の追加 (dashboard.executive_view)
INSERT INTO permissions (code, description) VALUES
    ('dashboard.executive_view', '全社横断KPIエグゼクティブダッシュボードの閲覧権限')
ON CONFLICT (code) DO NOTHING;

-- 2. ロールと権限の紐付け (role_permissions)
-- 対象: 経営者および各ドメインの管理職ロール
-- (employee, bookkeeper, viewer_external などの一般・外部ロールは除外)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE p.code = 'dashboard.executive_view'
  AND r.code IN (
    'owner',
    'accounting_manager',
    'legal_admin',
    'approver',
    'accountant',
    'payroll_admin'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;
