-- ============================================================================
-- 028_invoice_source_quotation_guard.sql
-- 売上請求書 source_quotation_id のWORM不変性ガードおよび部分UNIQUE制約 (Phase 4: P4-T1-FIX4)
--
-- 背景・目的 (BLOCKER対応):
--   1. invoices.source_quotation_id のWORM不変性DB保証:
--      quotations.converted_invoice_id と対をなす逆参照列 source_quotation_id について、
--      一度設定された後は、別quotationへの付け替えやNULLへの巻き戻し (改変) を
--      DBトリガーで機械的・fail-closed (ERRCODE: 55000) に一切禁止する。
--      これにより、双方向リンクの片側だけが後から書き換えられて整合性が破壊される脆弱性を
--      完全に排除する。
--   2. invoices.source_quotation_id の部分UNIQUEインデックス (NULL除外):
--      複数の請求書が同一の見積書を参照する不正状態 (1:N矛盾) を構造的に排除する。
--   3. 既存データへの安全性 (後方互換性):
--      source_quotation_id は nullable 列として追加されており、既存の通常請求書
--      (見積を経由しない直接発行等) は source_quotation_id = NULL のまま安全に共存可能。
--      本トリガーは OLD.source_quotation_id IS NOT NULL のレコードのみ不変性を強制するため、
--      既存請求書の通常の更新操作 (入金消込・ステータス更新等) には一切干渉しない。
-- ============================================================================

-- 1. invoices.source_quotation_id 部分UNIQUEインデックス作成 (NULL除外)
CREATE UNIQUE INDEX IF NOT EXISTS ix_invoices_source_quotation_unique
    ON invoices (source_quotation_id)
    WHERE source_quotation_id IS NOT NULL;

-- 2. invoices.source_quotation_id のWORM不変性ガードトリガー関数作成
CREATE OR REPLACE FUNCTION fn_guard_invoice_source_quotation_immutability()
RETURNS TRIGGER AS $$
BEGIN
    -- 一度 source_quotation_id が設定された後、その値を別quotationに変更したりNULLへ巻き戻すことは禁止
    IF OLD.source_quotation_id IS NOT NULL AND NEW.source_quotation_id IS DISTINCT FROM OLD.source_quotation_id THEN
        RAISE EXCEPTION 'invoice (%) source_quotation_id is immutable once set; cannot modify or reset to NULL (current: %, attempted: %)',
            OLD.invoice_no, OLD.source_quotation_id, NEW.source_quotation_id
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. トリガー登録
DROP TRIGGER IF EXISTS trg_guard_invoice_source_quotation_immutability ON invoices;
CREATE TRIGGER trg_guard_invoice_source_quotation_immutability
    BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION fn_guard_invoice_source_quotation_immutability();
