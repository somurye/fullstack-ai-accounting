-- ============================================================================
-- 007_attachments_document_category.sql
-- 証憑・添付ファイルの汎用化: document_category (文書種別) の追加
--
-- 背景・目的:
-- 現行の attachments テーブルはレシート・請求書等の証憑(電帳法対応)を前提にした
-- 列構成になっている。契約書PDF等の新ドメイン文書も同じテーブル・同じ添付UIで
-- 扱えるよう、document_category 列を追加する。
--
-- 【設計上の考慮点】
-- 1. 既存データ互換性:
--    DEFAULT 'receipt' を設定することで既存の証憑レコードには 'receipt' が適用され、
--    NULL埋めによる検索漏れ・不整合を防ぐ。
-- 2. 契約書特有メタデータの責務分離:
--    契約期間(開始日/終了日)や自動更新フラグ等の契約ドメイン固有データは attachments には
--    持たせず、Phase 1 の contracts テーブルに持たせる。
-- 3. 電帳法検索性の維持:
--    既存の 3項目検索インデックス (ix_attachments_search) および pg_trgm インデックス
--    (ix_attachments_counterparty_trgm) はそのまま維持し、WORM (追記専用) 特性も維持する。
-- ============================================================================

-- 1. attachments テーブルに document_category 列を追加
ALTER TABLE attachments
    ADD COLUMN IF NOT EXISTS document_category TEXT NOT NULL DEFAULT 'receipt';

-- 2. document_category の CHECK 制約を追加
ALTER TABLE attachments
    DROP CONSTRAINT IF EXISTS attachments_document_category_check;

ALTER TABLE attachments
    ADD CONSTRAINT attachments_document_category_check
    CHECK (document_category IN ('receipt', 'invoice', 'contract', 'purchase_order', 'other'));

-- 3. テナント・カテゴリ複合インデックスの作成 (カテゴリ絞り込み高速化)
CREATE INDEX IF NOT EXISTS ix_attachments_tenant_category
    ON attachments(tenant_id, document_category);

-- ============================================================================
-- ロールバック手順 (Down Migration):
--
-- DROP INDEX IF EXISTS ix_attachments_tenant_category;
-- ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_document_category_check;
-- ALTER TABLE attachments DROP COLUMN IF EXISTS document_category;
-- ============================================================================
