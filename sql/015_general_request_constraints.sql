-- ============================================================================
-- 015_general_request_constraints.sql
-- Phase 1: P1-T5-FIX2 汎用稟議テーブル 制約追加 (amount非負, category enum)
--
-- 目的:
--   既存の general_requests テーブルに対し、ALTER TABLE で以下の CHECK 制約を追加する:
--   1. ck_general_requests_amount_nonnegative: amount IS NULL OR amount >= 0
--   2. ck_general_requests_category: category IN ('general','equipment','rule_change','business_trip','other')
--
-- 冪等性:
--   DO ブロックにより pg_constraint を確認し、複数回実行しても安全に適用可能 (IF NOT EXISTS相当)。
--
-- 既存データ保護・クレンジング:
--   万一負の金額や未定義カテゴリが存在した場合にマイグレーションが失敗しないよう、
--   制約追加前に安全な正規化を実施。
-- ============================================================================

-- 1. 既存データクレンジング (フェイルセーフ)
UPDATE general_requests
SET amount = NULL
WHERE amount < 0;

UPDATE general_requests
SET category = 'general'
WHERE category NOT IN ('general', 'equipment', 'rule_change', 'business_trip', 'other');

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
