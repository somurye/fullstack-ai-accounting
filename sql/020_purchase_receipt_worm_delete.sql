-- ============================================================================
-- 020: purchase_receipts の DELETE に対する WORM 改ざん防止トリガー追加
--      および app_runtime ロールからの DELETE 権限剥奪 (P2-T3-FIX)
-- ============================================================================

-- 1. DELETE 禁止トリガー関数の作成 (WORM原則の完全保証)
CREATE OR REPLACE FUNCTION fn_prevent_purchase_receipt_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'purchase_receipts records cannot be deleted once created (WORM violation: %)', OLD.id
        USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

-- 2. BEFORE DELETE トリガーの登録
DROP TRIGGER IF EXISTS trg_prevent_purchase_receipt_delete ON purchase_receipts;
CREATE TRIGGER trg_prevent_purchase_receipt_delete
    BEFORE DELETE ON purchase_receipts
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_purchase_receipt_delete();

-- 3. app_runtime ロールから purchase_receipts の DELETE 権限を剥奪 (最小権限の原則)
REVOKE DELETE ON purchase_receipts FROM app_runtime;
