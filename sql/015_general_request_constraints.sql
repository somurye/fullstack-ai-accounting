-- ============================================================================
-- 015_general_request_constraints.sql
-- Phase 1: P1-T5-FIX3 汎用稟議テーブル 制約追加 (amount非負, category enum)
--
-- 目的:
--   既存の general_requests テーブルに対し、ALTER TABLE で以下の CHECK 制約を追加する:
--   1. ck_general_requests_amount_nonnegative: amount IS NULL OR amount >= 0
--   2. ck_general_requests_category: category IN ('general','equipment','rule_change','business_trip','other')
--
-- fail-closed 原則 (0.4節):
--   既存データに制約違反（amount < 0 または 未定義category）が存在する場合、
--   データを自動クレンジング（UPDATE/DELETE）せず、RAISE EXCEPTION で migration を停止し
--   手動修正を促す。
--
-- 冪等性:
--   DO ブロックにより pg_constraint を確認し、複数回実行しても安全に適用可能 (IF NOT EXISTS相当)。
-- ============================================================================

-- 1. 既存データの制約違反チェック (fail-closed 検証)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM general_requests WHERE amount < 0) THEN
        RAISE EXCEPTION 'general_requests contains negative amount values; manual remediation required (amount must be NULL or >= 0)';
    END IF;

    IF EXISTS (
        SELECT 1 FROM general_requests
        WHERE category NOT IN ('general', 'equipment', 'rule_change', 'business_trip', 'other')
    ) THEN
        RAISE EXCEPTION 'general_requests contains invalid category values; manual remediation required (category must be one of: general, equipment, rule_change, business_trip, other)';
    END IF;
END $$;

-- 2. amount 非負 CHECK 制約の追加 (冪等)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_general_requests_amount_nonnegative'
          AND conrelid = 'general_requests'::regclass
    ) THEN
        ALTER TABLE general_requests
            ADD CONSTRAINT ck_general_requests_amount_nonnegative
            CHECK (amount IS NULL OR amount >= 0);
    END IF;
END $$;

-- 3. category enum CHECK 制約の追加 (冪等)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ck_general_requests_category'
          AND conrelid = 'general_requests'::regclass
    ) THEN
        ALTER TABLE general_requests
            ADD CONSTRAINT ck_general_requests_category
            CHECK (category IN ('general', 'equipment', 'rule_change', 'business_trip', 'other'));
    END IF;
END $$;
