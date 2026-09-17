-- ============================================================================
-- 027_quotation_revision_and_conversion_guards.sql
-- 見積改訂先検証・多重改訂排除および受注転換先invoice双方向リンク検証 (Phase 4: P4-T1-FIX3)
--
-- 背景・目的 (BLOCKER-01 & BLOCKER候補-02):
--   1. superseded_by の正当性DB検証:
--      sent 状態の見積に対する改訂リンク (superseded_by) について、
--      参照先が「同一テナント」「同一見積番号 (quote_no)」「version = OLD.version + 1」
--      を満たす正規の改訂先であることを DB トリガーで機械的に強制照合する。
--      これにより、同一テナント内の無関係な見積への付け替えを構造的に排除する。
--   2. superseded_by の UNIQUE 制約 (NULL除外部分ユニークインデックス):
--      複数の旧見積が同一の新見積を指す状態 (1:N, N:1 の不正リンク) を構造的に排除する。
--   3. converted_invoice_id の双方向リンク検証 (BLOCKER候補-02 方針(a)):
--      invoices テーブルに source_quotation_id (UUID UNIQUE REFERENCES quotations(id)) を追加。
--      受注転換時、参照先 invoice の source_quotation_id が当該見積の ID と一致することを
--      DB トリガーで強制検証し、無関係な既存 invoice への不正リンクを構造的に排除する。
-- ============================================================================

-- 1. invoices テーブルに source_quotation_id 追加
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS source_quotation_id UUID UNIQUE REFERENCES quotations(id);

CREATE INDEX IF NOT EXISTS ix_invoices_source_quotation
    ON invoices (source_quotation_id)
    WHERE source_quotation_id IS NOT NULL;

COMMENT ON COLUMN invoices.source_quotation_id IS '受注転換元見積書ID (quotations.id への一意参照, 双方向整合性担保)';

-- 2. quotations テーブルの superseded_by 部分 UNIQUE インデックス作成
CREATE UNIQUE INDEX IF NOT EXISTS ix_quotations_superseded_by_unique
    ON quotations (superseded_by)
    WHERE superseded_by IS NOT NULL;

-- 3. WORM不変性・改訂先正当性ガードトリガー関数の更新 (CREATE OR REPLACE, BLOCKER-01)
CREATE OR REPLACE FUNCTION fn_guard_quotation_immutability()
RETURNS TRIGGER AS $$
DECLARE
    v_target_tenant_id UUID;
    v_target_quote_no  TEXT;
    v_target_version   INTEGER;
BEGIN
    -- 3.1 物理削除は draft 状態のみ許可 (sent以降は不可逆保護)
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'draft' THEN
            RAISE EXCEPTION 'cannot delete quotation % in % status (only draft can be deleted)',
                OLD.quote_no, OLD.status
                USING ERRCODE = '55000';
        END IF;
        RETURN OLD;
    END IF;

    -- 3.2 状態遷移チェック
    IF OLD.status <> NEW.status THEN
        -- draft からの遷移: sent のみ許可 (確定送付)
        IF OLD.status = 'draft' AND NEW.status NOT IN ('sent') THEN
            RAISE EXCEPTION 'invalid quotation status transition from % to %', OLD.status, NEW.status
                USING ERRCODE = '23001';
        END IF;

        -- sent からの遷移: accepted, rejected, expired のみ許可
        IF OLD.status = 'sent' AND NEW.status NOT IN ('accepted', 'rejected', 'expired') THEN
            RAISE EXCEPTION 'invalid quotation status transition from % to %', OLD.status, NEW.status
                USING ERRCODE = '23001';
        END IF;

        -- 終端状態 (accepted, rejected, expired) からの再遷移は一切禁止
        IF OLD.status IN ('accepted', 'rejected', 'expired') THEN
            RAISE EXCEPTION 'terminal quotation in % status cannot transition to %', OLD.status, NEW.status
                USING ERRCODE = '23001';
        END IF;
    END IF;

    -- 3.3 sent 以降の確定状態における不変性強制 (WORM特性, 計画書6.2節 原則1)
    IF OLD.status IN ('sent', 'accepted', 'rejected', 'expired') THEN
        -- 3.3.1 superseded_by の自己循環参照禁止
        IF NEW.superseded_by = OLD.id THEN
            RAISE EXCEPTION 'quotation (%) cannot be superseded by itself',
                OLD.quote_no
                USING ERRCODE = '23001';
        END IF;

        -- 3.3.2 superseded_by の正当性・改訂例外制御 (BLOCKER-01):
        -- 「NULL → 新バージョンの見積IDへの一度きりの遷移」のみを許可する。
        -- 既に設定済みの場合はいかなる変更も拒絶し、NULLへの巻き戻しも拒絶する。
        IF OLD.superseded_by IS NOT NULL AND NEW.superseded_by IS DISTINCT FROM OLD.superseded_by THEN
            RAISE EXCEPTION 'quotation (%) already superseded by %; cannot re-assign superseded_by',
                OLD.quote_no, OLD.superseded_by
                USING ERRCODE = '55000';
        END IF;

        -- NULL から値が設定される初回改訂リンク時:
        -- 参照先 target が「同一テナント」「同一見積番号」「version = OLD.version + 1」であることをDB側で機械的に検証
        IF OLD.superseded_by IS NULL AND NEW.superseded_by IS NOT NULL THEN
            SELECT tenant_id, quote_no, version
            INTO v_target_tenant_id, v_target_quote_no, v_target_version
            FROM quotations
            WHERE id = NEW.superseded_by;

            IF v_target_tenant_id IS NULL THEN
                RAISE EXCEPTION 'target superseded quotation % not found', NEW.superseded_by
                    USING ERRCODE = '23503';
            END IF;

            IF v_target_tenant_id <> OLD.tenant_id THEN
                RAISE EXCEPTION 'superseded quotation % does not belong to tenant %',
                    NEW.superseded_by, OLD.tenant_id
                    USING ERRCODE = '23503';
            END IF;

            IF v_target_quote_no <> OLD.quote_no THEN
                RAISE EXCEPTION 'superseded quotation % has different quote_no (%) than original (%)',
                    NEW.superseded_by, v_target_quote_no, OLD.quote_no
                    USING ERRCODE = '23001';
            END IF;

            IF v_target_version <> (OLD.version + 1) THEN
                RAISE EXCEPTION 'superseded quotation % version (%) must be exactly old version (%) + 1',
                    NEW.superseded_by, v_target_version, OLD.version
                    USING ERRCODE = '23001';
            END IF;
        END IF;

        -- 3.3.3 業務内容を構成する重要列の改変を fail-closed に一切禁止
        -- 注: total_amount は GENERATED STORED (subtotal + tax_amount) のため、
        -- subtotal および tax_amount の不変性検証により合計金額も機械的に保護される。
        IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
           OR OLD.customer_id IS DISTINCT FROM NEW.customer_id
           OR OLD.deal_id IS DISTINCT FROM NEW.deal_id
           OR OLD.quote_no IS DISTINCT FROM NEW.quote_no
           OR OLD.title IS DISTINCT FROM NEW.title
           OR OLD.valid_until IS DISTINCT FROM NEW.valid_until
           OR OLD.issue_date IS DISTINCT FROM NEW.issue_date
           OR OLD.subtotal IS DISTINCT FROM NEW.subtotal
           OR OLD.tax_amount IS DISTINCT FROM NEW.tax_amount
           OR OLD.currency_code IS DISTINCT FROM NEW.currency_code
           OR OLD.version IS DISTINCT FROM NEW.version
           OR OLD.notes IS DISTINCT FROM NEW.notes
           OR OLD.created_by IS DISTINCT FROM NEW.created_by
           OR OLD.created_at IS DISTINCT FROM NEW.created_at
        THEN
            RAISE EXCEPTION 'finalized quotation (%) is immutable; critical fields cannot be modified after sent',
                OLD.quote_no
                USING ERRCODE = '55000';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. 受注転換ガードトリガー関数の更新 (CREATE OR REPLACE, BLOCKER候補-02)
CREATE OR REPLACE FUNCTION fn_guard_quotation_conversion()
RETURNS TRIGGER AS $$
DECLARE
    v_inv_tenant_id UUID;
    v_inv_source_quote_id UUID;
BEGIN
    -- converted_invoice_id が既に設定されている場合の再設定・改変は禁止
    IF OLD.converted_invoice_id IS NOT NULL AND NEW.converted_invoice_id IS DISTINCT FROM OLD.converted_invoice_id THEN
        RAISE EXCEPTION 'quotation % is already converted to invoice %; multiple conversions are prohibited',
            OLD.quote_no, OLD.converted_invoice_id
            USING ERRCODE = '55000';
    END IF;

    -- 新たに converted_invoice_id をセットする場合
    IF OLD.converted_invoice_id IS NULL AND NEW.converted_invoice_id IS NOT NULL THEN
        -- ステータスは sent または accepted でなければならない
        IF NEW.status NOT IN ('sent', 'accepted') THEN
            RAISE EXCEPTION 'cannot convert quotation % in status % to invoice (must be sent or accepted)',
                OLD.quote_no, NEW.status
                USING ERRCODE = '55000';
        END IF;

        -- 参照先 invoice の存在・テナント整合性・source_quotation_id 照合 (BLOCKER候補-02)
        SELECT tenant_id, source_quotation_id
        INTO v_inv_tenant_id, v_inv_source_quote_id
        FROM invoices
        WHERE id = NEW.converted_invoice_id;

        IF v_inv_tenant_id IS NULL THEN
            RAISE EXCEPTION 'converted invoice % does not exist', NEW.converted_invoice_id
                USING ERRCODE = '23503';
        END IF;

        IF v_inv_tenant_id <> NEW.tenant_id THEN
            RAISE EXCEPTION 'converted invoice % does not belong to tenant %',
                NEW.converted_invoice_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;

        IF v_inv_source_quote_id IS DISTINCT FROM NEW.id THEN
            RAISE EXCEPTION 'converted invoice % was not generated from quotation % (source_quotation_id mismatch)',
                NEW.converted_invoice_id, NEW.quote_no
                USING ERRCODE = '55000';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
