-- =========================================================================
-- 031_contract_renewal_link_guards.sql
-- Phase 4 Task 3 (P4-T3-VERIFY): 契約更新連携 ガード・一意性・不変性強化
--
-- 変更内容:
-- 1. contract_renewal_links.deal_id へのNULL除外部分UNIQUE制約
--    - 1つのdealが複数の契約リンク対象になることを構造的に排除
-- 2. contract_renewal_links.quotation_id へのNULL除外部分UNIQUE制約
--    - 同一quotationが複数のリンク行から参照されることを構造的に排除
-- 3. WORMトリガー (fn_guard_contract_renewal_link_immutability)
--    - contract_id, deal_id, tenant_id, created_by への作成後直接UPDATEを拒絶 (ERRCODE: 55000)
--    - quotation_id が一度設定された後の再設定（変更）・NULLへの巻き戻しを拒絶 (ERRCODE: 55000)
-- 4. quotation_id 正当性検証トリガー (fn_validate_contract_renewal_link_quotation_deal)
--    - リンクに設定される quotation の deal_id が、当該リンク行の deal_id と完全一致することを強制 (ERRCODE: 23503)
-- =========================================================================

-- 1. contract_renewal_links.deal_id 部分UNIQUE制約
CREATE UNIQUE INDEX IF NOT EXISTS ix_contract_renewal_links_deal_unique
    ON contract_renewal_links (deal_id)
    WHERE deal_id IS NOT NULL;

-- 2. contract_renewal_links.quotation_id 部分UNIQUE制約
CREATE UNIQUE INDEX IF NOT EXISTS ix_contract_renewal_links_quotation_unique
    ON contract_renewal_links (quotation_id)
    WHERE quotation_id IS NOT NULL;

-- 3. WORM不変性ガードトリガー関数
CREATE OR REPLACE FUNCTION fn_guard_contract_renewal_link_immutability()
RETURNS TRIGGER AS $$
BEGIN
    -- 3.1 contract_id 変更拒絶
    IF NEW.contract_id IS DISTINCT FROM OLD.contract_id THEN
        RAISE EXCEPTION 'cannot change contract_id of contract_renewal_link % (immutable WORM)', OLD.id
            USING ERRCODE = '55000';
    END IF;

    -- 3.2 deal_id 変更拒絶
    IF NEW.deal_id IS DISTINCT FROM OLD.deal_id THEN
        RAISE EXCEPTION 'cannot change deal_id of contract_renewal_link % (immutable WORM)', OLD.id
            USING ERRCODE = '55000';
    END IF;

    -- 3.3 tenant_id 変更拒絶
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
        RAISE EXCEPTION 'cannot change tenant_id of contract_renewal_link % (immutable WORM)', OLD.id
            USING ERRCODE = '55000';
    END IF;

    -- 3.4 created_by 変更拒絶
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'cannot change created_by of contract_renewal_link % (immutable WORM)', OLD.id
            USING ERRCODE = '55000';
    END IF;

    -- 3.5 quotation_id 設定後の再設定・NULL巻き戻し拒絶
    -- (NULL -> 非NULL への一度限りの遷移のみ許可)
    IF OLD.quotation_id IS NOT NULL AND NEW.quotation_id IS DISTINCT FROM OLD.quotation_id THEN
        RAISE EXCEPTION 'cannot reassign or clear quotation_id of contract_renewal_link % once set (immutable WORM)', OLD.id
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_contract_renewal_link_immutability ON contract_renewal_links;
CREATE TRIGGER trg_guard_contract_renewal_link_immutability
    BEFORE UPDATE ON contract_renewal_links
    FOR EACH ROW EXECUTE FUNCTION fn_guard_contract_renewal_link_immutability();

-- 4. quotation_id と deal_id の正当性検証トリガー関数 (設計確定-02)
CREATE OR REPLACE FUNCTION fn_validate_contract_renewal_link_quotation_deal()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.quotation_id IS NOT NULL THEN
        -- リンクの deal_id が未設定の場合は quotation 紐付け不可
        IF NEW.deal_id IS NULL THEN
            RAISE EXCEPTION 'cannot associate quotation_id % when deal_id is NULL', NEW.quotation_id
                USING ERRCODE = '23503';
        END IF;

        -- 参照先 quotation の deal_id が当該リンク行の deal_id と一致することを検証
        IF NOT EXISTS (
            SELECT 1 FROM quotations
            WHERE id = NEW.quotation_id
              AND tenant_id = NEW.tenant_id
              AND deal_id = NEW.deal_id
        ) THEN
            RAISE EXCEPTION 'quotation % does not belong to deal % in tenant %',
                NEW.quotation_id, NEW.deal_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_contract_renewal_link_quotation_deal ON contract_renewal_links;
CREATE TRIGGER trg_validate_contract_renewal_link_quotation_deal
    BEFORE INSERT OR UPDATE OF quotation_id, deal_id ON contract_renewal_links
    FOR EACH ROW EXECUTE FUNCTION fn_validate_contract_renewal_link_quotation_deal();
