-- ============================================================================
-- 019_purchase_receipts_and_billing.sql
-- 発注〜検収〜請求の連携 (Phase 2: P2-T3)
--
-- 背景・目的:
--   P2-T1でpurchase_requestsの承認（active化）まで、P2-T2でサプライヤーマスタとの
--   正式な紐付けまで実装した。本マイグレーションでは、activeになった発注申請に対する
--   「検収（納品受領記録：purchase_receipts）」と、既存の経理会計基盤にある
--   「仕入請求書管理（vendor_bills）との紐付け」を実装し、発注から支払いまでの一連の
--   業務フローを完成させる。
--
-- 確立された設計原則の遵守:
--   1. 確定済み経理会計ロジックの非破壊性:
--      既存vendor_billsテーブル・仕訳生成等の会計ロジックに影響を与えないよう、
--      nullableな参照列 (purchase_request_id) の追加とテナント整合性トリガーのみ実装。
--   2. WORM特性（改ざん防止）の維持:
--      検収記録 (purchase_receipts) は追記専用 (append-only) とし、UPDATEをDBトリガーで遮断。
--      purchase_requests本体の数量・金額等の改変は引き続き禁止。
--   3. 部分納品対応 & 数量超過防止・並行実行排他 (Advisory Lock):
--      検収合計数量 <= 発注数量 をDBトリガーで強制検証。
--      同一 purchase_request_id に対する transaction advisory lock を取得し、
--      並行実行時の race condition を完全に防止 (P1-T3/P2-T2と同型パターン)。
--   4. 完全テナント分離 (RLS):
--      ENABLE + FORCE ROW LEVEL SECURITY (fail-closed)。
--   5. RBAC二重防御:
--      purchase_request.receive (検収記録), purchase_request.link_bill (請求書紐付け) を新設。
-- ============================================================================

-- 1. purchase_receipts テーブル作成 (検収記録)
CREATE TABLE IF NOT EXISTS purchase_receipts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),
    purchase_request_id UUID NOT NULL REFERENCES purchase_requests(id),
    received_quantity   NUMERIC(12, 2) NOT NULL,
    received_date       DATE NOT NULL,
    notes               TEXT,
    received_by         UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_purchase_receipts_quantity_positive CHECK (received_quantity > 0)
);

COMMENT ON TABLE purchase_receipts IS '発注検収記録テーブル (納品物の受領記録・部分納品履歴)';
COMMENT ON COLUMN purchase_receipts.purchase_request_id IS '対象の発注申請ID (active状態必須)';
COMMENT ON COLUMN purchase_receipts.received_quantity IS '受領数量 (0超必須, 合計が発注数量を超過不可)';
COMMENT ON COLUMN purchase_receipts.received_date IS '検収・受領日';
COMMENT ON COLUMN purchase_receipts.notes IS '検収時メモ・検品結果等';
COMMENT ON COLUMN purchase_receipts.received_by IS '検収担当者ユーザーID (当該テナント所属必須)';

-- 2. インデックス作成
CREATE INDEX IF NOT EXISTS ix_purchase_receipts_tenant_pr
    ON purchase_receipts (tenant_id, purchase_request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_purchase_receipts_received_by
    ON purchase_receipts (tenant_id, received_by);

-- 3. 行レベルセキュリティ (RLS)
ALTER TABLE purchase_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_receipts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_purchase_receipts ON purchase_receipts;
CREATE POLICY tenant_isolation_purchase_receipts ON purchase_receipts
    FOR ALL
    USING (tenant_id = fn_current_tenant_id())
    WITH CHECK (tenant_id = fn_current_tenant_id());

-- 4. 検収記録のテナント整合性・発注申請ステータス検証トリガー
CREATE OR REPLACE FUNCTION fn_validate_purchase_receipt_consistency()
RETURNS TRIGGER AS $$
DECLARE
    v_pr_tenant UUID;
    v_pr_status TEXT;
    v_pr_quantity NUMERIC(12, 2);
    v_current_total NUMERIC(12, 2);
BEGIN
    -- 4.1 received_by ユーザーが当該テナントに所属していることを検証 (23503)
    IF NOT EXISTS (
        SELECT 1 FROM tenant_users
        WHERE tenant_id = NEW.tenant_id AND user_id = NEW.received_by
    ) THEN
        RAISE EXCEPTION 'received_by user % is not a member of tenant %',
            NEW.received_by, NEW.tenant_id
            USING ERRCODE = '23503';
    END IF;

    -- 4.2 purchase_request_id のロック取得 (並行実行時の数量超過レースコンディション防止)
    PERFORM pg_advisory_xact_lock(hashtextextended('purchase_receipt:' || NEW.purchase_request_id::text, 0));

    -- 4.3 対象発注申請の存在・テナント整合性・ステータスを取得
    SELECT tenant_id, status, quantity
    INTO v_pr_tenant, v_pr_status, v_pr_quantity
    FROM purchase_requests
    WHERE id = NEW.purchase_request_id;

    IF NOT FOUND OR v_pr_tenant != NEW.tenant_id THEN
        RAISE EXCEPTION 'purchase_request % does not belong to tenant %',
            NEW.purchase_request_id, NEW.tenant_id
            USING ERRCODE = '23503';
    END IF;

    -- 4.4 発注申請が active 状態であることを検証 (draft, pending_approval, terminated 等は拒否)
    IF v_pr_status != 'active' THEN
        RAISE EXCEPTION 'cannot add purchase receipt to purchase_request with status "%" (must be "active")',
            v_pr_status
            USING ERRCODE = '23514';
    END IF;

    -- 4.5 部分納品の合計数量チェック (発注数量の超過防止)
    SELECT COALESCE(SUM(received_quantity), 0)
    INTO v_current_total
    FROM purchase_receipts
    WHERE purchase_request_id = NEW.purchase_request_id
      AND (TG_OP = 'INSERT' OR id != NEW.id);

    IF (v_current_total + NEW.received_quantity) > v_pr_quantity THEN
        RAISE EXCEPTION 'total received quantity (%) exceeds purchase request order quantity (%)',
            (v_current_total + NEW.received_quantity), v_pr_quantity
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_purchase_receipt_consistency ON purchase_receipts;
CREATE TRIGGER trg_validate_purchase_receipt_consistency
    BEFORE INSERT OR UPDATE ON purchase_receipts
    FOR EACH ROW EXECUTE FUNCTION fn_validate_purchase_receipt_consistency();

-- 5. 検収記録の改ざん防止トリガー (追記専用 WORM)
CREATE OR REPLACE FUNCTION fn_prevent_purchase_receipt_update()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'purchase_receipts records cannot be modified once created'
        USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_purchase_receipt_update ON purchase_receipts;
CREATE TRIGGER trg_prevent_purchase_receipt_update
    BEFORE UPDATE ON purchase_receipts
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_purchase_receipt_update();

-- 6. vendor_bills への purchase_request_id 列追加
ALTER TABLE vendor_bills
    ADD COLUMN IF NOT EXISTS purchase_request_id UUID REFERENCES purchase_requests(id);

COMMENT ON COLUMN vendor_bills.purchase_request_id IS '紐付けられた発注申請ID (同一テナント・active状態必須)';

-- インデックス作成
CREATE INDEX IF NOT EXISTS ix_vendor_bills_purchase_request
    ON vendor_bills (tenant_id, purchase_request_id)
    WHERE purchase_request_id IS NOT NULL;

-- 7. vendor_bills の purchase_request_id テナント整合性トリガー
CREATE OR REPLACE FUNCTION fn_validate_vendor_bill_purchase_request_consistency()
RETURNS TRIGGER AS $$
DECLARE
    v_pr_tenant UUID;
    v_pr_status TEXT;
BEGIN
    IF NEW.purchase_request_id IS NOT NULL THEN
        SELECT tenant_id, status
        INTO v_pr_tenant, v_pr_status
        FROM purchase_requests
        WHERE id = NEW.purchase_request_id;

        IF NOT FOUND OR v_pr_tenant != NEW.tenant_id THEN
            RAISE EXCEPTION 'purchase_request % does not belong to tenant %',
                NEW.purchase_request_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;

        -- 紐付け対象の発注申請は承認済み (active) であること
        IF v_pr_status != 'active' THEN
            RAISE EXCEPTION 'cannot link vendor_bill to purchase_request with status "%" (must be "active")',
                v_pr_status
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_vendor_bill_purchase_request_consistency ON vendor_bills;
CREATE TRIGGER trg_validate_vendor_bill_purchase_request_consistency
    BEFORE INSERT OR UPDATE ON vendor_bills
    FOR EACH ROW EXECUTE FUNCTION fn_validate_vendor_bill_purchase_request_consistency();

-- 8. RBAC: パーミッション登録およびロールへの割当
INSERT INTO permissions (code, description) VALUES
    ('purchase_request.receive', '発注申請の検収記録登録・閲覧'),
    ('purchase_request.link_bill', '発注申請と仕入請求書(vendor_bills)の紐付け・解除')
ON CONFLICT (code) DO NOTHING;

-- owner, accounting_manager, accountant: 検収 & 請求紐付けの両方を付与
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('owner', 'accounting_manager', 'accountant')
  AND p.code IN ('purchase_request.receive', 'purchase_request.link_bill')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- employee, approver: 検収記録のみを付与 (起票者・現場承認者が検収可能)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('employee', 'approver')
  AND p.code IN ('purchase_request.receive')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 9. 権限付与
GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_receipts TO app_runtime;
GRANT SELECT ON purchase_receipts TO app_readonly_external;
