-- ============================================================================
-- 009_contracts.sql
-- 契約書管理テーブル (Phase 1: P1-T1)
--
-- 目的:
--   Phase 0 で汎用化した承認ワークフロー(approval_requests target_type='contract')と
--   attachments(document_category='contract')を紐付ける契約書本体テーブルを構築する。
--
-- 設計原則:
--   1. 完全テナント分離: ENABLE / FORCE ROW LEVEL SECURITY (fail-closed)
--   2. WORM/改ざん防止: active 化後の重要項目(金額、期間、取引先名等)は直接UPDATE不可
--   3. 物理削除制限: draft のみ物理削除可。active/pending 以降は物理削除禁止
--   4. 柔軟性: 金額なし契約(NDA等)・期間の定めがない契約に対応(NULL許容)
-- ============================================================================

-- 1. ENUM 定義
CREATE TYPE contract_status_enum AS ENUM (
    'draft',
    'pending_approval',
    'active',
    'rejected',
    'expired',
    'terminated'
);

-- 2. contracts テーブル
CREATE TABLE contracts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),
    contract_no         TEXT NOT NULL,
    title               TEXT NOT NULL,
    counterparty_name   TEXT NOT NULL,
    contract_type       TEXT NOT NULL CHECK (contract_type IN (
                            'nda', 'service', 'lease', 'sales',
                            'outsourcing', 'license', 'employment', 'other'
                        )),
    contract_amount     NUMERIC(18, 2) CHECK (contract_amount IS NULL OR contract_amount >= 0),
    currency            CHAR(3) NOT NULL DEFAULT 'JPY',
    start_date          DATE NOT NULL,
    end_date            DATE,
    auto_renewal        BOOLEAN NOT NULL DEFAULT FALSE,
    renewal_notice_days SMALLINT NOT NULL DEFAULT 30 CHECK (renewal_notice_days >= 0),
    status              contract_status_enum NOT NULL DEFAULT 'draft',
    attachment_id       UUID REFERENCES attachments(id),
    description         TEXT,
    approved_at         TIMESTAMPTZ,
    created_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_date IS NULL OR end_date >= start_date),
    UNIQUE (tenant_id, contract_no)
);

-- 3. インデックス
CREATE INDEX ix_contracts_status ON contracts(tenant_id, status);
CREATE INDEX ix_contracts_dates ON contracts(tenant_id, start_date, end_date);
CREATE INDEX ix_contracts_counterparty_trgm ON contracts USING gin (counterparty_name gin_trgm_ops);
CREATE INDEX ix_contracts_title_trgm ON contracts USING gin (title gin_trgm_ops);
CREATE INDEX ix_contracts_attachment ON contracts(attachment_id) WHERE attachment_id IS NOT NULL;

-- 4. 行レベルセキュリティ (RLS)
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts FORCE ROW LEVEL SECURITY;

CREATE POLICY contracts_tenant_isolation ON contracts
    FOR ALL
    USING (tenant_id = fn_current_tenant_id())
    WITH CHECK (tenant_id = fn_current_tenant_id());

-- 5. トリガー関数: ステータス遷移ガード ＆ 重要項目改ざん防止
CREATE OR REPLACE FUNCTION fn_guard_contract_transition()
RETURNS TRIGGER AS $$
BEGIN
    -- 5.1 物理削除ガード: draft のみ物理削除を許可。それ以外は禁止
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'draft' THEN
            RAISE EXCEPTION 'contracts in status % cannot be physically deleted; only draft contracts can be deleted',
                OLD.status USING ERRCODE = '23001';
        END IF;
        RETURN OLD;
    END IF;

    -- 5.2 終端状態ガード: expired / terminated からの変更は不可
    IF OLD.status IN ('expired', 'terminated') THEN
        RAISE EXCEPTION 'contracts in status % are final and immutable', OLD.status
            USING ERRCODE = '23001';
    END IF;

    -- 5.3 ステータス遷移許可パスの検証
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        -- draft からの遷移
        IF OLD.status = 'draft' AND NEW.status NOT IN ('pending_approval', 'active', 'terminated') THEN
            RAISE EXCEPTION 'invalid contract status transition from % to %', OLD.status, NEW.status
                USING ERRCODE = '23001';
        END IF;

        -- pending_approval からの遷移
        IF OLD.status = 'pending_approval' AND NEW.status NOT IN ('active', 'rejected', 'draft') THEN
            RAISE EXCEPTION 'invalid contract status transition from % to %', OLD.status, NEW.status
                USING ERRCODE = '23001';
        END IF;

        -- active からの遷移
        IF OLD.status = 'active' AND NEW.status NOT IN ('expired', 'terminated') THEN
            RAISE EXCEPTION 'invalid contract status transition from % to %', OLD.status, NEW.status
                USING ERRCODE = '23001';
        END IF;

        -- rejected からの遷移
        IF OLD.status = 'rejected' AND NEW.status NOT IN ('draft') THEN
            RAISE EXCEPTION 'invalid contract status transition from % to %', OLD.status, NEW.status
                USING ERRCODE = '23001';
        END IF;
    END IF;

    -- 5.4 active 状態維持時の重要列改ざん防止 (WORM特性)
    IF OLD.status = 'active' AND NEW.status = 'active' THEN
        IF OLD.contract_amount IS DISTINCT FROM NEW.contract_amount
           OR OLD.currency IS DISTINCT FROM NEW.currency
           OR OLD.counterparty_name IS DISTINCT FROM NEW.counterparty_name
           OR OLD.contract_type IS DISTINCT FROM NEW.contract_type
           OR OLD.start_date IS DISTINCT FROM NEW.start_date
           OR OLD.end_date IS DISTINCT FROM NEW.end_date
        THEN
            RAISE EXCEPTION 'active contracts are immutable for critical fields (amount, currency, counterparty, type, dates); create a new version or amendment instead'
                USING ERRCODE = '23001';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. トリガー適用
CREATE TRIGGER trg_set_contracts_updated_at
    BEFORE UPDATE ON contracts
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_guard_contract_transition
    BEFORE UPDATE OR DELETE ON contracts
    FOR EACH ROW EXECUTE FUNCTION fn_guard_contract_transition();

-- 7. ロール権限付与 (アプリケーション実行ロールへのアクセス許可)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON contracts TO app_runtime;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly_external') THEN
        GRANT SELECT ON contracts TO app_readonly_external;
    END IF;
END $$;
