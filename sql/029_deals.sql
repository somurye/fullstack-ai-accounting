-- ============================================================================
-- 029_deals.sql
-- 案件管理（商談パイプライン）テーブル・終端状態WORMガード・見積連携 (Phase 4: P4-T2)
--
-- 背景・目的:
--   営業事務Phase (Phase 4) の第2タスクとして、商談（案件）パイプラインを管理する
--   deals テーブルを構築する。案件は見積とは異なり、進行中は内容を更新し続けるが、
--   終端状態（won: 受注 / lost: 失注）に達した後は、DBトリガーにより
--   fail-closed (ERRCODE: 55000) に更新・削除を遮断する。
--   また、P4-T1であらかじめ配置した quotations.deal_id に対して外部キー制約を追加し、
--   案件と見積の多重・単一紐付けを安全に保証する。
--
-- 確立された設計原則の遵守:
--   1. 完全テナント分離: ENABLE + FORCE ROW LEVEL SECURITY (fail-closed)
--   2. テナント整合性のDBトリガー保証 (MAJOR-02教訓):
--      customer_id, owner_user_id, created_by の tenant_id 整合性をDBトリガーで強制検証
--   3. ステージ遷移設計と終端状態 (won / lost) の不可変性 (設計確認-01 & 証跡確認-04):
--      - 非終端ステージ間 (lead, qualified, proposal, negotiation) の遷移は、商談の実務プロセス
--        (再提案・条件確認による後退、即時商談化によるスキップ等) に合わせて双方向・非線形な遷移を
--        意図的に許容 (DBによる順序強制なし)。
--      - 終端状態 (won または lost) への遷移のみを一方向・不可逆として保護。
--      - 終端状態到達後は、stageおよび業務列、closed_at を含む全列の変更・レコード物理削除を
--        DBトリガーで fail-closed (ERRCODE: 55000) に遮断。
--   4. lost時の理由必須保証 (fail-closed):
--      lost への遷移時は lost_reason が必須 (空文字・NULL拒絶: ERRCODE: 23514)
--   5. quotations.deal_id への外部キー制約とテナント整合性保証:
--      既存の quotations (deal_id IS NULL) に影響を与えずに FK を追加し、
--      quotations 側のテナント整合性トリガーでも deal_id のテナント一致を検証
--   6. RBAC三層防御:
--      deal.create / view / edit / close の権限体系を整備
-- ============================================================================

-- 1. deals テーブル作成
CREATE TABLE IF NOT EXISTS deals (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),
    customer_id         UUID NOT NULL REFERENCES customers(id),
    title               TEXT NOT NULL CHECK (length(btrim(title)) > 0),
    stage               TEXT NOT NULL DEFAULT 'lead' CHECK (stage IN (
                            'lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'
                        )),
    expected_amount     NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (expected_amount >= 0),
    currency_code       CHAR(3) NOT NULL DEFAULT 'JPY',
    expected_close_date DATE,
    owner_user_id       UUID REFERENCES users(id),
    lost_reason         TEXT,
    closed_at           TIMESTAMPTZ,
    created_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE deals IS '案件・商談パイプラインテーブル (進行管理・クローズド不変性・見積連携)';
COMMENT ON COLUMN deals.title IS '案件名・商談名';
COMMENT ON COLUMN deals.customer_id IS '顧客ID (既存顧客マスタ customers への外部キー参照)';
COMMENT ON COLUMN deals.stage IS '商談ステージ (lead, qualified, proposal, negotiation, won, lost)';
COMMENT ON COLUMN deals.expected_amount IS '予想売上金額 (0以上)';
COMMENT ON COLUMN deals.expected_close_date IS '受注予定日';
COMMENT ON COLUMN deals.owner_user_id IS '案件担当者ユーザーID';
COMMENT ON COLUMN deals.lost_reason IS '失注理由 (stage=lost の場合必須)';
COMMENT ON COLUMN deals.closed_at IS '商談クローズ日時 (won/lost 遷移時に自動設定)';

-- 2. インデックス作成
CREATE INDEX IF NOT EXISTS ix_deals_tenant_stage
    ON deals (tenant_id, stage, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_deals_tenant_customer
    ON deals (tenant_id, customer_id);

CREATE INDEX IF NOT EXISTS ix_deals_tenant_owner
    ON deals (tenant_id, owner_user_id)
    WHERE owner_user_id IS NOT NULL;

-- 3. 行レベルセキュリティ (RLS)
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_deals ON deals;
CREATE POLICY tenant_isolation_deals ON deals
    FOR ALL
    USING (tenant_id = fn_current_tenant_id())
    WITH CHECK (tenant_id = fn_current_tenant_id());

-- 4. テナント整合性ガードトリガー (MAJOR-02教訓)
CREATE OR REPLACE FUNCTION fn_validate_deal_tenant_consistency()
RETURNS TRIGGER AS $$
BEGIN
    -- 4.1 customer_id が当該テナントに属していることを検証
    IF NEW.customer_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM customers
            WHERE id = NEW.customer_id AND tenant_id = NEW.tenant_id
        ) THEN
            RAISE EXCEPTION 'customer % does not belong to tenant %',
                NEW.customer_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    -- 4.2 owner_user_id が指定されている場合、当該テナント (tenant_users) に所属していることを検証
    IF NEW.owner_user_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM tenant_users
            WHERE tenant_id = NEW.tenant_id AND user_id = NEW.owner_user_id
        ) THEN
            RAISE EXCEPTION 'owner user % does not belong to tenant %',
                NEW.owner_user_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    -- 4.3 created_by ユーザーが当該テナント (tenant_users) に所属していることを検証
    IF NEW.created_by IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM tenant_users
            WHERE tenant_id = NEW.tenant_id AND user_id = NEW.created_by
        ) THEN
            RAISE EXCEPTION 'user % does not belong to tenant %',
                NEW.created_by, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_deal_tenant_consistency ON deals;
CREATE TRIGGER trg_validate_deal_tenant_consistency
    BEFORE INSERT OR UPDATE ON deals
    FOR EACH ROW EXECUTE FUNCTION fn_validate_deal_tenant_consistency();

-- 5. 終端状態ガードおよび状態遷移トリガー (P3給与計算finalizedパターン準拠)
CREATE OR REPLACE FUNCTION fn_guard_deal_immutability()
RETURNS TRIGGER AS $$
BEGIN
    -- 5.1 物理削除ガード: won / lost の終端状態に達した案件の削除は一切禁止
    IF TG_OP = 'DELETE' THEN
        IF OLD.stage IN ('won', 'lost') THEN
            RAISE EXCEPTION 'cannot delete terminal deal % in % stage',
                OLD.id, OLD.stage
                USING ERRCODE = '55000';
        END IF;
        RETURN OLD;
    END IF;

    -- 5.2 INSERT時ガード: 新規作成時に lost の場合は lost_reason 必須、terminal の場合は closed_at 自動設定
    IF TG_OP = 'INSERT' THEN
        IF NEW.stage = 'lost' AND (NEW.lost_reason IS NULL OR btrim(NEW.lost_reason) = '') THEN
            RAISE EXCEPTION 'lost_reason is required when deal stage is lost'
                USING ERRCODE = '23514';
        END IF;

        IF NEW.stage IN ('won', 'lost') AND NEW.closed_at IS NULL THEN
            NEW.closed_at := now();
        END IF;

        RETURN NEW;
    END IF;

    -- 5.3 UPDATE時ガード
    IF TG_OP = 'UPDATE' THEN
        -- 5.3.1 終端状態 (won / lost) からの改変を fail-closed に一切拒絶
        IF OLD.stage IN ('won', 'lost') THEN
            RAISE EXCEPTION 'terminal deal (%) in % stage is immutable; stage and business columns cannot be modified',
                OLD.id, OLD.stage
                USING ERRCODE = '55000';
        END IF;

        -- 5.3.2 lost への遷移時は lost_reason 必須チェック
        IF NEW.stage = 'lost' AND (NEW.lost_reason IS NULL OR btrim(NEW.lost_reason) = '') THEN
            RAISE EXCEPTION 'lost_reason is required when deal stage is lost'
                USING ERRCODE = '23514';
        END IF;

        -- 5.3.3 won / lost への遷移時は closed_at を自動設定 (未指定時)
        IF NEW.stage IN ('won', 'lost') THEN
            IF NEW.closed_at IS NULL THEN
                NEW.closed_at := now();
            END IF;
        ELSE
            -- 進行中ステージへ更新・保持される場合、クローズ日および失注理由はリセット
            NEW.closed_at := NULL;
            NEW.lost_reason := NULL;
        END IF;

        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_guard_deal_immutability ON deals;
CREATE TRIGGER trg_guard_deal_immutability
    BEFORE INSERT OR UPDATE OR DELETE ON deals
    FOR EACH ROW EXECUTE FUNCTION fn_guard_deal_immutability();

-- 6. updated_at 自動更新トリガー
DROP TRIGGER IF EXISTS trg_set_deals_updated_at ON deals;
CREATE TRIGGER trg_set_deals_updated_at
    BEFORE UPDATE ON deals
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- 7. quotations.deal_id への外部キー制約追加
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_quotations_deal'
          AND table_name = 'quotations'
    ) THEN
        ALTER TABLE quotations
            ADD CONSTRAINT fk_quotations_deal
            FOREIGN KEY (deal_id) REFERENCES deals(id)
            ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_quotations_deal
    ON quotations (tenant_id, deal_id)
    WHERE deal_id IS NOT NULL;

-- 8. quotations テナント整合性トリガーに関数更新 (deal_id のテナント整合性検証を追加)
CREATE OR REPLACE FUNCTION fn_validate_quotation_tenant_consistency()
RETURNS TRIGGER AS $$
BEGIN
    -- 8.1 customer_id が当該テナントに属していることを検証
    IF NEW.customer_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM customers
            WHERE id = NEW.customer_id AND tenant_id = NEW.tenant_id
        ) THEN
            RAISE EXCEPTION 'customer % does not belong to tenant %',
                NEW.customer_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    -- 8.2 deal_id が指定されている場合、参照先案件が当該テナントに属していることを検証
    IF NEW.deal_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM deals
            WHERE id = NEW.deal_id AND tenant_id = NEW.tenant_id
        ) THEN
            RAISE EXCEPTION 'deal % does not belong to tenant %',
                NEW.deal_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    -- 8.3 created_by ユーザーが当該テナント (tenant_users) に所属していることを検証
    IF NEW.created_by IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM tenant_users
            WHERE tenant_id = NEW.tenant_id AND user_id = NEW.created_by
        ) THEN
            RAISE EXCEPTION 'user % does not belong to tenant %',
                NEW.created_by, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    -- 8.4 superseded_by が指定されている場合、参照先見積が当該テナントに属していることを検証
    IF NEW.superseded_by IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM quotations
            WHERE id = NEW.superseded_by AND tenant_id = NEW.tenant_id
        ) THEN
            RAISE EXCEPTION 'superseded quotation % does not belong to tenant %',
                NEW.superseded_by, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    -- 8.5 converted_invoice_id が指定されている場合、参照先請求書が当該テナントに属していることを検証
    IF NEW.converted_invoice_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM invoices
            WHERE id = NEW.converted_invoice_id AND tenant_id = NEW.tenant_id
        ) THEN
            RAISE EXCEPTION 'converted invoice % does not belong to tenant %',
                NEW.converted_invoice_id, NEW.tenant_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 9. RBAC: パーミッション登録およびロールへの割当
INSERT INTO permissions (code, description) VALUES
    ('deal.create', '案件・商談の作成・登録'),
    ('deal.view', '案件・商談の閲覧・一覧取得'),
    ('deal.edit', '案件・商談の編集・更新(進行中ステージ)'),
    ('deal.close', '案件・商談のクローズ(won/lost確定)')
ON CONFLICT (code) DO NOTHING;

-- owner: 全権限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'owner'
  AND p.code IN ('deal.create', 'deal.view', 'deal.edit', 'deal.close')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- employee: 営業担当等の一般社員は作成・閲覧・編集・クローズが可能
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'employee'
  AND p.code IN ('deal.create', 'deal.view', 'deal.edit', 'deal.close')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- accounting_manager: 経理責任者は全権限
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'accounting_manager'
  AND p.code IN ('deal.create', 'deal.view', 'deal.edit', 'deal.close')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- accountant, approver, bookkeeper, legal_admin, legal_viewer: 閲覧のみ
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code IN ('accountant', 'approver', 'bookkeeper', 'legal_admin', 'legal_viewer')
  AND p.code IN ('deal.view')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 10. 権限付与
GRANT SELECT, INSERT, UPDATE, DELETE ON deals TO app_runtime;
