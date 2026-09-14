-- ============================================================================
-- 023_rate_master_immutability.sql
-- Phase 3 Task 2 (P3-T2-FIX): 過去マスタデータ改ざん防止トリガー (WORM / 不変性強制)
--
-- 1. 適用開始日 (effective_from) が到来済みのマスタについて、業務値・開始日の変更を禁止
-- 2. 過去確定済みレコード (effective_to 設定済み) について、終了日の事後変更も禁止
-- 3. 現在有効 (effective_to IS NULL) なレコードに対する終了日設定 (クローズ) は法改正運用のために許可
-- 4. 未来適用予定 (effective_from > 今日) のレコードは入力訂正のため変更を許可
-- 5. 適用開始日到来済みのマスタの物理削除 (DELETE) を禁止
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 保険料率マスタ (insurance_rate_tables) 改ざん防止トリガー関数
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_prevent_insurance_rate_past_update()
RETURNS TRIGGER AS $$
DECLARE
    v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
    -- 適用開始日が到来している過去・現在のレコードに対する変更制御
    IF OLD.effective_from <= v_today THEN
        -- コア業務値および開始日の変更を拒否 (fail-closed)
        IF (OLD.rate_type IS DISTINCT FROM NEW.rate_type) OR
           (OLD.prefecture IS DISTINCT FROM NEW.prefecture) OR
           (OLD.rate_employee IS DISTINCT FROM NEW.rate_employee) OR
           (OLD.rate_employer IS DISTINCT FROM NEW.rate_employer) OR
           (OLD.effective_from IS DISTINCT FROM NEW.effective_from) OR
           (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id) THEN
            RAISE EXCEPTION 'Cannot update business values of insurance rate master after effective_from has arrived (effective_from: %, today: %)',
                OLD.effective_from, v_today
                USING ERRCODE = '23514';
        END IF;

        -- 有効期間終了日 (effective_to) の変更制御
        IF OLD.effective_to IS NOT NULL AND (OLD.effective_to IS DISTINCT FROM NEW.effective_to) THEN
            -- 既に終了日が確定している過去レコードの終了日変更は不可
            RAISE EXCEPTION 'Cannot modify effective_to of historical insurance rate master (old effective_to: %, new effective_to: %)',
                OLD.effective_to, NEW.effective_to
                USING ERRCODE = '23514';
        ELSIF OLD.effective_to IS NULL AND NEW.effective_to IS NOT NULL THEN
            -- 現在有効なレコードへの終了日設定 (クローズ) は許可。ただし開始日以降であること
            IF NEW.effective_to < OLD.effective_from THEN
                RAISE EXCEPTION 'effective_to must be on or after effective_from (effective_from: %, effective_to: %)',
                    OLD.effective_from, NEW.effective_to
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;

    -- 未来適用予定 (OLD.effective_from > v_today) のレコードは入力誤り訂正のため編集許可
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_prevent_insurance_rate_past_delete()
RETURNS TRIGGER AS $$
DECLARE
    v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
    IF OLD.effective_from <= v_today THEN
        RAISE EXCEPTION 'Cannot delete insurance rate master after effective_from has arrived (effective_from: %, today: %)',
            OLD.effective_from, v_today
            USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_insurance_rate_past_update ON insurance_rate_tables;
CREATE TRIGGER trg_prevent_insurance_rate_past_update
    BEFORE UPDATE ON insurance_rate_tables
    FOR EACH ROW
    EXECUTE FUNCTION fn_prevent_insurance_rate_past_update();

DROP TRIGGER IF EXISTS trg_prevent_insurance_rate_past_delete ON insurance_rate_tables;
CREATE TRIGGER trg_prevent_insurance_rate_past_delete
    BEFORE DELETE ON insurance_rate_tables
    FOR EACH ROW
    EXECUTE FUNCTION fn_prevent_insurance_rate_past_delete();

-- ----------------------------------------------------------------------------
-- 2. 所得税源泉徴収税額表 (income_tax_withholding_brackets) 改ざん防止トリガー関数
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_prevent_tax_bracket_past_update()
RETURNS TRIGGER AS $$
DECLARE
    v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
    -- 適用開始日が到来している過去・現在のレコードに対する変更制御
    IF OLD.effective_from <= v_today THEN
        -- コア業務値および開始日の変更を拒否 (fail-closed)
        IF (OLD.dependents_count IS DISTINCT FROM NEW.dependents_count) OR
           (OLD.income_min IS DISTINCT FROM NEW.income_min) OR
           (OLD.income_max IS DISTINCT FROM NEW.income_max) OR
           (OLD.tax_amount IS DISTINCT FROM NEW.tax_amount) OR
           (OLD.effective_from IS DISTINCT FROM NEW.effective_from) OR
           (OLD.tenant_id IS DISTINCT FROM NEW.tenant_id) THEN
            RAISE EXCEPTION 'Cannot update business values of tax bracket after effective_from has arrived (effective_from: %, today: %)',
                OLD.effective_from, v_today
                USING ERRCODE = '23514';
        END IF;

        -- 有効期間終了日 (effective_to) の変更制御
        IF OLD.effective_to IS NOT NULL AND (OLD.effective_to IS DISTINCT FROM NEW.effective_to) THEN
            -- 既に終了日が確定している過去レコードの終了日変更は不可
            RAISE EXCEPTION 'Cannot modify effective_to of historical tax bracket (old effective_to: %, new effective_to: %)',
                OLD.effective_to, NEW.effective_to
                USING ERRCODE = '23514';
        ELSIF OLD.effective_to IS NULL AND NEW.effective_to IS NOT NULL THEN
            -- 現在有効なレコードへの終了日設定 (クローズ) は許可。ただし開始日以降であること
            IF NEW.effective_to < OLD.effective_from THEN
                RAISE EXCEPTION 'effective_to must be on or after effective_from (effective_from: %, effective_to: %)',
                    OLD.effective_from, NEW.effective_to
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;

    -- 未来適用予定 (OLD.effective_from > v_today) のレコードは入力誤り訂正のため編集許可
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_prevent_tax_bracket_past_delete()
RETURNS TRIGGER AS $$
DECLARE
    v_today DATE := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
    IF OLD.effective_from <= v_today THEN
        RAISE EXCEPTION 'Cannot delete tax bracket after effective_from has arrived (effective_from: %, today: %)',
            OLD.effective_from, v_today
            USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_tax_bracket_past_update ON income_tax_withholding_brackets;
CREATE TRIGGER trg_prevent_tax_bracket_past_update
    BEFORE UPDATE ON income_tax_withholding_brackets
    FOR EACH ROW
    EXECUTE FUNCTION fn_prevent_tax_bracket_past_update();

DROP TRIGGER IF EXISTS trg_prevent_tax_bracket_past_delete ON income_tax_withholding_brackets;
CREATE TRIGGER trg_prevent_tax_bracket_past_delete
    BEFORE DELETE ON income_tax_withholding_brackets
    FOR EACH ROW
    EXECUTE FUNCTION fn_prevent_tax_bracket_past_delete();
