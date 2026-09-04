-- ============================================================================
-- 013_notifications.sql
-- 通知テーブルおよび契約期限アラート基盤 (Phase 1: P1-T4)
--
-- 目的:
--   契約書の満了・自動更新通知をはじめとする、テナント内ユーザーへのシステム通知を
--   永続化・管理する notifications テーブルを新設する。
--
-- 設計原則:
--   1. 完全テナント分離: ENABLE / FORCE ROW LEVEL SECURITY (fail-closed)
--   2. 多層重複防止: 同一対象に対する未読通知の部分ユニークインデックス
--      (uq_notifications_unread_target: WHERE status = 'unread')
--   3. 全テナント横断バッチ適合: RLSバイパスを行わず、テナントごとの
--      SET LOCAL app.current_tenant_id で安全に書き込み可能
-- ============================================================================

CREATE TABLE IF NOT EXISTS notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id),
    type        TEXT NOT NULL,                           -- 'contract_expiry' 等
    target_type TEXT NOT NULL,                           -- 'contract', 'expense_report' 等
    target_id   UUID NOT NULL,                           -- 対象リソースのID
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read')),
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE notifications IS 'テナント内ユーザー向け通知テーブル (契約期限アラート等)';
COMMENT ON COLUMN notifications.type IS '通知種別 (contract_expiry, approval_requested等)';
COMMENT ON COLUMN notifications.target_type IS '通知対象リソース種別 (contract等)';
COMMENT ON COLUMN notifications.target_id IS '通知対象リソースの主キー';
COMMENT ON COLUMN notifications.status IS '閲覧状態 (unread: 未読, read: 既読)';

-- ----------------------------------------------------------------------------
-- インデックス
-- ----------------------------------------------------------------------------

-- 1. テナント別の状態・作成日時降順検索 (一覧取得用)
CREATE INDEX IF NOT EXISTS ix_notifications_tenant_status_created
    ON notifications (tenant_id, status, created_at DESC);

-- 2. 対象リソース検索用
CREATE INDEX IF NOT EXISTS ix_notifications_target
    ON notifications (tenant_id, target_type, target_id);

-- 3. 未読重複防止用部分ユニークインデックス (多層防御)
--    同一リソース・同一通知種別の未読通知が同一テナントに複数存在することをDB制約で禁止
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_unread_target
    ON notifications (tenant_id, target_type, target_id, type)
    WHERE status = 'unread';

-- ----------------------------------------------------------------------------
-- 行レベルセキュリティ (RLS)
-- ----------------------------------------------------------------------------

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_notifications ON notifications;
CREATE POLICY tenant_isolation_notifications ON notifications
    USING (tenant_id = fn_current_tenant_id())
    WITH CHECK (tenant_id = fn_current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO app_runtime;
GRANT SELECT ON notifications TO app_readonly_external;

-- ----------------------------------------------------------------------------
-- RBAC: 全テナント横断バッチ実行パーミッション (P1-T4-FIX)
-- ----------------------------------------------------------------------------

-- 1. permissions テーブルへパーミッション登録
INSERT INTO permissions (code, description) VALUES
    ('notification.batch_execute', '契約期限アラート・全テナント横断バッチの実行権限')
ON CONFLICT (code) DO NOTHING;

-- 2. role_permissions でロールと権限を紐付け
-- 全テナント横断バッチはシステム管理者向け特殊機能のため、owner ロールにのみ付与する
-- (一般ロール、legal_admin, legal_viewer, accountant 等には付与しない)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'owner'
  AND p.code = 'notification.batch_execute'
ON CONFLICT (role_id, permission_id) DO NOTHING;

