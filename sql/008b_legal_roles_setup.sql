-- ============================================================================
-- マイグレーション 008b: 法務ロールマスタ・契約権限マスタおよび紐付け登録 (Phase 0: P0-T4)
-- ============================================================================
-- 目的:
-- Phase 1 での契約書管理機能(contracts等)導入に先立ち、RBAC基盤へ
-- 法務担当向けロール('legal_admin', 'legal_viewer')および
-- 契約書ドメインの権限('contract.*')を追加・整備する。
--
-- 権限方針 (MAJOR-01 方針 a):
-- - legal_admin / legal_viewer の新設に加え、Phase 1 での契約承認・経理突合業務を想定し、
--   既存の管理者(owner)・承認者(approver)・経理担当(accounting_manager, accountant)にも
--   業務上必要な契約閲覧・承認権限を付与する。
-- - 一般従業員(employee)、給与担当(payroll_admin)、外部税理士(viewer_external)には
--   契約権限を付与せず、fail-closed (未設定・不一致時はアクセス不可) を維持する。
-- ============================================================================

-- 1. roles テーブルへロールマスタ登録
INSERT INTO roles (code, name) VALUES
    ('legal_admin', '法務管理者(契約書作成・承認・管理)'),
    ('legal_viewer', '法務閲覧者(契約書閲覧専用)')
ON CONFLICT (code) DO NOTHING;

-- 2. permissions テーブルへ契約書関連パーミッション登録
-- 既存の命名規則 (例: journal_entry.create, expense_report.approve, external.view) に準拠
INSERT INTO permissions (code, description) VALUES
    ('contract.create', '契約書の作成・登録(draft)'),
    ('contract.view', '契約書の閲覧'),
    ('contract.edit', '契約書の編集・更新'),
    ('contract.approve', '契約書の承認'),
    ('contract.terminate', '契約書の終了・解約処理')
ON CONFLICT (code) DO NOTHING;

-- 3. role_permissions でロールと権限を紐付け
-- owner: 全契約権限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'owner'
  AND p.code IN ('contract.create', 'contract.view', 'contract.edit', 'contract.approve', 'contract.terminate')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- legal_admin: 契約書の作成・閲覧・編集・承認・解約処理
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'legal_admin'
  AND p.code IN ('contract.create', 'contract.view', 'contract.edit', 'contract.approve', 'contract.terminate')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- legal_viewer: 契約書の閲覧のみ
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'legal_viewer'
  AND p.code IN ('contract.view')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- approver: 契約書の閲覧・承認
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'approver'
  AND p.code IN ('contract.view', 'contract.approve')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- accounting_manager / accountant: 経理業務上の契約書参照
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('accounting_manager', 'accountant')
  AND p.code IN ('contract.view')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================================
-- Down Migration (ロールバック手順):
-- 1. DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code LIKE 'contract.%');
-- 2. DELETE FROM permissions WHERE code LIKE 'contract.%';
-- 3. DELETE FROM user_roles WHERE role_id IN (SELECT id FROM roles WHERE code IN ('legal_admin', 'legal_viewer'));
-- 4. DELETE FROM roles WHERE code IN ('legal_admin', 'legal_viewer');
-- (PostgreSQL では ENUM からの個別値削除は直接サポートされないため、ENUM値は残存可)
-- ============================================================================
