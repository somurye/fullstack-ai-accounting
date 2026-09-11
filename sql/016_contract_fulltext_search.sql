-- ============================================================================
-- 016_contract_fulltext_search.sql
-- Phase 1: P1-T6 契約書全文検索基盤 (pgvector活用)
--
-- 目的:
--   1. contracts テーブルに抽出済み契約書本文列 (extracted_text TEXT) を追加。
--   2. 契約書の条項チャンクをベクトル化して格納する contract_embeddings テーブルを新設。
--   3. pgvector によるコサイン類似度検索インデックス (ivfflat) を構築。
--   4. 行レベルセキュリティ (RLS ENABLE + FORCE) およびテナント整合性トリガーを適用し、
--      他テナントの契約書・embedding との越境を DB 層で完全に遮断。
--
-- 原則遵守 (0.4節):
--   - migration 不変原則 (append-only): 既存 migration を書き換えずに新規番号で追加。
--   - fail-closed 原則: 整合性検証トリガーによる不正 INSERT/UPDATE の拒否。
-- ============================================================================

-- 1. contracts テーブルに本文列を追加 (append-only)
ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS extracted_text TEXT;

-- 2. 契約書ベクトルテーブル (contract_embeddings) の新規作成
CREATE TABLE IF NOT EXISTS contract_embeddings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id),
    contract_id       UUID NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    chunk_index       INTEGER NOT NULL,
    chunk_text        TEXT NOT NULL,
    embedding         VECTOR(1536) NOT NULL,
    model_name        TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (contract_id, chunk_index)
);

-- 3. インデックス作成
CREATE INDEX IF NOT EXISTS ix_contract_embeddings_tenant
    ON contract_embeddings(tenant_id);

CREATE INDEX IF NOT EXISTS ix_contract_embeddings_contract
    ON contract_embeddings(contract_id);

-- pgvector コサイン距離用 ivfflat インデックス (既存 journal_entry_embeddings と同一設計)
CREATE INDEX IF NOT EXISTS ix_contract_embeddings_ivfflat
    ON contract_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 4. 行レベルセキュリティ (RLS) の有効化 ＆ 強制
ALTER TABLE contract_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_embeddings FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'contract_embeddings'
          AND policyname = 'contract_embeddings_tenant_isolation'
    ) THEN
        CREATE POLICY contract_embeddings_tenant_isolation ON contract_embeddings
            FOR ALL
            USING (tenant_id = fn_current_tenant_id())
            WITH CHECK (tenant_id = fn_current_tenant_id());
    END IF;
END $$;

-- 5. テナント整合性ガードトリガー (P1-T1/P1-T3 パターン)
-- contract_id が同一テナントの contracts レコードを参照していることを DB 層で強制
CREATE OR REPLACE FUNCTION fn_validate_contract_embedding_tenant_consistency()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM contracts
        WHERE id = NEW.contract_id AND tenant_id = NEW.tenant_id
    ) THEN
        RAISE EXCEPTION 'contract % does not belong to tenant %',
            NEW.contract_id, NEW.tenant_id
            USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_contract_embedding_tenant_consistency ON contract_embeddings;
CREATE TRIGGER trg_validate_contract_embedding_tenant_consistency
    BEFORE INSERT OR UPDATE ON contract_embeddings
    FOR EACH ROW EXECUTE FUNCTION fn_validate_contract_embedding_tenant_consistency();

-- 6. ロール権限付与 (app_runtime, app_readonly_external)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON contract_embeddings TO app_runtime;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly_external') THEN
        GRANT SELECT ON contract_embeddings TO app_readonly_external;
    END IF;
END $$;
