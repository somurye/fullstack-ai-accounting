-- ============================================================================
-- 002_bank_integration.sql
-- 銀行系オープンAPI(モック含む)連携: bank_transactions への冪等性列追加
--
-- 背景: CSV取込(bank-transactions.service.ts の importCsv)は
-- (bank_account_id, import_hash) の一意制約で重複取込を防止しているが、
-- 銀行API/アグリゲーションAPI経由の取込は取得元が発行する一意な取引ID
-- (externalTransactionId)を持つため、それをそのまま冪等性キーとして
-- 保持できるほうが実装・デバッグ双方にとって素直である。
-- 既存の import_hash 列・その一意制約はCSV経路の後方互換のためそのまま残し、
-- 新設の external_transaction_id 列は「銀行API経由で取り込んだ行にのみ設定される
-- 任意項目」として追加する(CSV経由の行はNULLのまま)。
-- ============================================================================

ALTER TABLE bank_transactions
    ADD COLUMN external_transaction_id TEXT;

COMMENT ON COLUMN bank_transactions.external_transaction_id IS
    '銀行API/アグリゲーションAPI経由で取得した場合の、取得元が発行する取引ユニークID。CSV取込の行はNULL。';

-- テナント×外部取引IDの複合一意性(部分インデックス。CSV経由のNULL行は対象外)。
-- `INSERT ... ON CONFLICT (tenant_id, external_transaction_id) WHERE external_transaction_id IS NOT NULL`
-- の推論ターゲットとして bank-sync.service.ts から参照される。
CREATE UNIQUE INDEX ux_bank_transactions_external_id
    ON bank_transactions (tenant_id, external_transaction_id)
    WHERE external_transaction_id IS NOT NULL;
