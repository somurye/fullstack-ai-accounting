-- ============================================================================
-- 経理・会計オールインワンAIアプリケーション
-- 001_initial_schema_all_in_one.sql
--
-- 対象: PostgreSQL 16 + pgvector
-- 目的: 5領域(A:資金管理 B:経費精算 C:決算/資産/税務 D:給与連携 E:ガバナンス)を
--       最初から破壊的変更なしにカバーする統合スキーマ。
--
-- 設計原則:
--   1. AIの役割分離    -> 確定列(account_id等)にAIが直接書き込むことはない。
--                          AI提案は ai_suggestions テーブルに隔離して保存する。
--   2. DB制約による最終防御 -> CHECK制約・トリガーで貸借一致/追記専用/自己承認禁止を強制。
--   3. 完全テナント分離     -> 全テナント表にRLSを設定し、FORCE ROW LEVEL SECURITYで
--                              テーブルオーナーも含め例外なく適用する(fail-closed)。
--   4. 生SQL駆動            -> アプリは `SET LOCAL app.current_tenant_id` 等を用いる。
--
-- 適用方法: psql -f 001_initial_schema_all_in_one.sql
-- ============================================================================


-- ============================================================================
-- PART 0: EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid() 等
CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector: 仕訳類似検索・AI提案精度向上
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- 摘要・取引先名の部分一致/あいまい検索
CREATE EXTENSION IF NOT EXISTS citext;     -- ユーザーメールアドレスの大文字小文字非依存一意性


-- ============================================================================
-- PART 1: ENUM 型定義
-- ============================================================================

CREATE TYPE role_code_enum AS ENUM (
    'owner', 'accounting_manager', 'accountant', 'approver',
    'employee', 'payroll_admin', 'viewer_external', 'system_service'
);

CREATE TYPE je_status_enum AS ENUM (
    'draft', 'pending_approval', 'posted', 'rejected', 'voided', 'reversed'
);

CREATE TYPE debit_credit_enum AS ENUM ('debit', 'credit');

CREATE TYPE invoice_status_enum AS ENUM (
    'draft', 'issued', 'partially_paid', 'paid', 'overdue', 'voided', 'credit_note_issued'
);

CREATE TYPE vendor_bill_status_enum AS ENUM (
    'draft', 'pending_approval', 'approved', 'rejected', 'scheduled_for_payment', 'paid'
);

CREATE TYPE bank_match_status_enum AS ENUM (
    'unmatched', 'auto_matched', 'manually_matched', 'reconciled', 'ignored'
);

CREATE TYPE payment_batch_status_enum AS ENUM ('draft', 'exported', 'completed', 'cancelled');

CREATE TYPE expense_report_status_enum AS ENUM (
    'submitted', 'in_review', 'approved', 'rejected',
    'reimbursement_scheduled', 'reimbursed'
);

CREATE TYPE payment_method_enum AS ENUM (
    'cash', 'corporate_card', 'bank_transfer', 'employee_advance'
);

CREATE TYPE approval_action_enum AS ENUM ('approve', 'reject');

CREATE TYPE approval_request_status_enum AS ENUM ('pending', 'approved', 'rejected');

CREATE TYPE depreciation_method_enum AS ENUM ('straight_line', 'declining_balance');

CREATE TYPE fixed_asset_status_enum AS ENUM ('active', 'disposed', 'sold');

CREATE TYPE disposal_type_enum AS ENUM ('disposed', 'sold');

CREATE TYPE tax_filing_method_enum AS ENUM ('general', 'simplified', 'twenty_percent_special');

-- 端数処理ルール(設定モジュール: 会計処理設定)。切り捨て/切り上げ/四捨五入。
CREATE TYPE rounding_rule_enum AS ENUM ('floor', 'ceil', 'round');
CREATE TYPE ai_provider_enum AS ENUM ('gemini', 'openai', 'anthropic');

CREATE TYPE tax_type_enum AS ENUM ('taxable', 'non_taxable', 'exempt', 'out_of_scope');

CREATE TYPE fiscal_period_status_enum AS ENUM ('open', 'closed');

CREATE TYPE account_type_enum AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');

CREATE TYPE accrual_schedule_status_enum AS ENUM ('scheduled', 'posted');

CREATE TYPE payroll_import_status_enum AS ENUM ('imported', 'posted');

CREATE TYPE recurring_frequency_enum AS ENUM ('monthly', 'quarterly', 'annually');


-- ============================================================================
-- PART 2: テーブル定義
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 2.0 コア: テナント / ユーザー / RBAC
-- ----------------------------------------------------------------------------

CREATE TABLE tenants (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                        TEXT NOT NULL,
    legal_name                  TEXT,
    representative_name        TEXT,                 -- 代表者名
    address                     TEXT,                 -- 所在地
    fiscal_year_start_month     SMALLINT NOT NULL DEFAULT 4 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
    invoice_registration_number TEXT,                 -- インボイス登録番号 (T+13桁)
    consumption_tax_filing_method tax_filing_method_enum NOT NULL DEFAULT 'general',
    base_currency_code          CHAR(3) NOT NULL DEFAULT 'JPY',
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE tenants IS '契約企業(テナント)マスタ。全テナント固有表のRLS基準となる。';

-- users はグローバル表(1ユーザーが複数テナントに所属しうる: 税理士等)。
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         CITEXT UNIQUE,
    name          TEXT NOT NULL,
    password_hash TEXT,
    -- MFA(TOTP)。mfa_secretはRFC6238のBase32エンコード済みシークレット。
    -- 発行(QRコード表示等)のエンドポイントは本タスクのスコープ外のため、
    -- 有効化されたユーザーへは別途シードデータ/管理コンソールでの投入を想定する。
    mfa_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret    TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenant_users (
    tenant_id     UUID NOT NULL REFERENCES tenants(id),
    user_id       UUID NOT NULL REFERENCES users(id),
    employee_code TEXT,
    department    TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    left_at       TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, user_id)
);
CREATE UNIQUE INDEX ux_tenant_users_employee_code ON tenant_users(tenant_id, employee_code) WHERE employee_code IS NOT NULL;

CREATE TABLE roles (
    id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code role_code_enum NOT NULL UNIQUE,
    name TEXT NOT NULL
);

CREATE TABLE permissions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT NOT NULL UNIQUE,
    description TEXT
);

CREATE TABLE role_permissions (
    role_id       UUID NOT NULL REFERENCES roles(id),
    permission_id UUID NOT NULL REFERENCES permissions(id),
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
    tenant_id  UUID NOT NULL,
    user_id    UUID NOT NULL,
    role_id    UUID NOT NULL REFERENCES roles(id),
    granted_by UUID REFERENCES users(id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id, role_id),
    FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_users(tenant_id, user_id)
);

-- 税理士・監査人等、期間限定の外部閲覧者アクセス権
CREATE TABLE external_access_grants (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenants(id),
    user_id    UUID NOT NULL REFERENCES users(id),
    valid_from TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ NOT NULL,
    can_export BOOLEAN NOT NULL DEFAULT FALSE,
    granted_by UUID NOT NULL REFERENCES users(id),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (valid_until > valid_from)
);
CREATE INDEX ix_external_access_grants_lookup ON external_access_grants(tenant_id, user_id, valid_from, valid_until);

-- テナントメンバー招待。生トークンはSHA-256ハッシュのみ保存し(refresh_tokensと同様の方針)、
-- 招待発行レスポンスでのみ生トークンを返す(以降は復元不可)。
CREATE TABLE member_invitations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id),
    email       CITEXT NOT NULL,
    role_code   role_code_enum NOT NULL,
    token_hash  TEXT NOT NULL UNIQUE,
    invited_by  UUID NOT NULL REFERENCES users(id),
    expires_at  TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_member_invitations_pending ON member_invitations(tenant_id, email)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- POST /auth/login・POST /auth/mfa で発行するリフレッシュトークン。
-- 生トークンはSHA-256ハッシュのみ保存し(漏洩時にも再利用不可)、POST /auth/logoutで失効させる。
-- tenant_idを持たないグローバル表であり、roles/permissions等と同様にRLSは適用しない
-- (AuthService経由でuser_id/token_hashを明示条件にした問い合わせのみで運用するため。
--  ログイン処理自体がテナントコンテキスト確立前に実行される都合上、RLSを課すと
--  fn_current_user_id()が未設定でINSERT/SELECTが常に0件になってしまう)。
CREATE TABLE refresh_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    issued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);
CREATE INDEX ix_refresh_tokens_user_active ON refresh_tokens(user_id) WHERE revoked_at IS NULL;

-- ----------------------------------------------------------------------------
-- 2.1 ガバナンス: 添付ファイル (電帳法対応・追記専用)
-- ----------------------------------------------------------------------------

CREATE TABLE attachments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id),
    file_name         TEXT NOT NULL,
    storage_path      TEXT NOT NULL,
    mime_type         TEXT NOT NULL,
    file_hash         TEXT NOT NULL,          -- SHA-256等。改ざん検知用
    -- 電帳法スキャナ保存の検索要件3項目(取引年月日/金額/取引先)
    transaction_date  DATE,
    amount            NUMERIC(18, 2),
    counterparty_name TEXT,
    uploaded_by       UUID NOT NULL REFERENCES users(id),
    uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_attachments_search ON attachments(tenant_id, transaction_date, amount, counterparty_name);
CREATE INDEX ix_attachments_counterparty_trgm ON attachments USING gin (counterparty_name gin_trgm_ops);

-- ポリモーフィック関連: どの業務レコードに紐づく添付か
CREATE TABLE attachment_links (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id),
    attachment_id UUID NOT NULL REFERENCES attachments(id),
    linkable_type TEXT NOT NULL CHECK (linkable_type IN (
        'journal_entry', 'expense_report_line', 'invoice', 'vendor_bill', 'fixed_asset'
    )),
    linkable_id   UUID NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (attachment_id, linkable_type, linkable_id)
);
CREATE INDEX ix_attachment_links_target ON attachment_links(tenant_id, linkable_type, linkable_id);

-- ----------------------------------------------------------------------------
-- 2.2 勘定科目体系
-- ----------------------------------------------------------------------------

CREATE TABLE departments (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    code      TEXT NOT NULL,
    name      TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (tenant_id, code)
);

CREATE TABLE account_categories (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id),
    code                    TEXT NOT NULL,
    name                    TEXT NOT NULL,
    financial_statement_type TEXT NOT NULL CHECK (financial_statement_type IN ('BS', 'PL')),
    UNIQUE (tenant_id, code)
);

CREATE TABLE accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),
    code                TEXT NOT NULL,
    name                TEXT NOT NULL,
    category_id         UUID REFERENCES account_categories(id),
    account_type        account_type_enum NOT NULL,
    normal_balance      debit_credit_enum NOT NULL,
    parent_account_id   UUID REFERENCES accounts(id),
    default_tax_category_code TEXT,
    allow_manual_entry  BOOLEAN NOT NULL DEFAULT TRUE,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);
CREATE INDEX ix_accounts_tenant_active ON accounts(tenant_id, is_active);

CREATE TABLE tax_categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    code            TEXT NOT NULL,
    name            TEXT NOT NULL,
    tax_type        tax_type_enum NOT NULL,
    tax_rate        NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
    is_reduced_rate BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (tenant_id, code)
);

-- 設定モジュール: テナントごとの会計処理共通設定(1テナント1行)。
-- 未設定のテナントには行が存在しないことがあるため、アプリ層でデフォルト値を補完して返す。
CREATE TABLE tenant_accounting_settings (
    tenant_id               UUID PRIMARY KEY REFERENCES tenants(id),
    rounding_rule           rounding_rule_enum NOT NULL DEFAULT 'floor',
    default_tax_category_id UUID REFERENCES tax_categories(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 外部連携設定(AIプロバイダAPIキー・銀行/決済コネクタ状態)。
-- APIキーはAES-256-GCMで暗号化して保存し(平文は保持しない)、末尾4桁のみ`ai_api_key_last4`に
-- 別途保持してマスク表示(••••1234)を復号なしで返せるようにする。
CREATE TABLE tenant_integration_settings (
    tenant_id             UUID PRIMARY KEY REFERENCES tenants(id),
    ai_provider           ai_provider_enum,
    ai_api_key_ciphertext TEXT,   -- base64 (AES-256-GCM暗号文)
    ai_api_key_iv         TEXT,   -- base64 (12byte IV)
    ai_api_key_tag        TEXT,   -- base64 (16byte 認証タグ)
    ai_api_key_last4      TEXT,   -- マスク表示用の末尾4桁(平文)
    ai_last_tested_at     TIMESTAMPTZ,
    ai_last_test_result   TEXT CHECK (ai_last_test_result IN ('success', 'failure')),
    bank_connector_status TEXT NOT NULL DEFAULT 'not_connected'
        CHECK (bank_connector_status IN ('not_connected', 'connected')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 2.3 会計期間
-- ----------------------------------------------------------------------------

CREATE TABLE fiscal_years (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenants(id),
    start_date DATE NOT NULL,
    end_date   DATE NOT NULL,
    status     fiscal_period_status_enum NOT NULL DEFAULT 'open',
    CHECK (end_date > start_date),
    UNIQUE (tenant_id, start_date)
);

CREATE TABLE fiscal_periods (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id),
    fiscal_year_id UUID NOT NULL REFERENCES fiscal_years(id),
    period_no      SMALLINT NOT NULL CHECK (period_no BETWEEN 1 AND 12),
    start_date     DATE NOT NULL,
    end_date       DATE NOT NULL,
    status         fiscal_period_status_enum NOT NULL DEFAULT 'open',
    CHECK (end_date > start_date),
    UNIQUE (fiscal_year_id, period_no)
);
CREATE INDEX ix_fiscal_periods_range ON fiscal_periods(tenant_id, start_date, end_date);

-- ----------------------------------------------------------------------------
-- 2.4 取引先マスタ (顧客 / 仕入先を明確に分離)
-- ----------------------------------------------------------------------------

CREATE TABLE customers (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenants(id),
    code       TEXT NOT NULL,
    name       TEXT NOT NULL,
    kana_name  TEXT,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);
CREATE INDEX ix_customers_kana_trgm ON customers USING gin (kana_name gin_trgm_ops);

CREATE TABLE vendors (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id),
    code                        TEXT NOT NULL,
    name                        TEXT NOT NULL,
    kana_name                   TEXT,
    invoice_registration_number TEXT,   -- 適格請求書発行事業者番号(仕入税額控除判定に使用)
    bank_account_info           JSONB,  -- 全銀FB振込先情報(銀行/支店/科目/口座番号/名義カナ)
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, code)
);
CREATE INDEX ix_vendors_kana_trgm ON vendors USING gin (kana_name gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- 2.5 銀行口座 / カード / 取込プロファイル
-- ----------------------------------------------------------------------------

CREATE TABLE bank_accounts (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL REFERENCES tenants(id),
    bank_name          TEXT NOT NULL,
    bank_code          TEXT,
    branch_name        TEXT,
    branch_code        TEXT,
    account_type       TEXT NOT NULL CHECK (account_type IN ('ordinary', 'checking')),
    account_number     TEXT NOT NULL,
    account_holder_kana TEXT,
    currency_code      CHAR(3) NOT NULL DEFAULT 'JPY',
    opening_balance    NUMERIC(18, 2) NOT NULL DEFAULT 0,
    linked_account_id  UUID REFERENCES accounts(id),  -- 対応する現金預金勘定科目
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, bank_code, branch_code, account_number)
);

CREATE TABLE bank_import_profiles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    bank_account_id UUID NOT NULL REFERENCES bank_accounts(id),
    name            TEXT NOT NULL,
    column_mapping  JSONB NOT NULL, -- CSV列 -> 論理フィールドのマッピング定義
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE credit_cards (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id),
    card_name        TEXT NOT NULL,
    issuer           TEXT,
    last4            CHAR(4),
    assigned_user_id UUID REFERENCES users(id),
    linked_account_id UUID REFERENCES accounts(id), -- 未払金(カード)勘定
    is_active        BOOLEAN NOT NULL DEFAULT TRUE
);

-- ----------------------------------------------------------------------------
-- 2.6 仕訳 (会計の中核)
-- ----------------------------------------------------------------------------

CREATE TABLE journal_entries (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL REFERENCES tenants(id),
    entry_no           TEXT NOT NULL,
    entry_date         DATE NOT NULL,
    fiscal_period_id   UUID REFERENCES fiscal_periods(id),
    description        TEXT,
    status             je_status_enum NOT NULL DEFAULT 'draft',
    -- どの業務イベントから起票されたかの追跡可能性(監査要件)
    source_type        TEXT CHECK (source_type IN (
        'manual', 'expense_report', 'invoice', 'vendor_bill', 'bank_auto_rule',
        'depreciation_batch', 'accrual_batch', 'recurring_template', 'payroll_import',
        'ai_suggestion', 'reversal'
    )),
    source_id          UUID,
    currency_code      CHAR(3) NOT NULL DEFAULT 'JPY',
    exchange_rate      NUMERIC(12, 6) NOT NULL DEFAULT 1,
    reversal_of_entry_id UUID REFERENCES journal_entries(id), -- 反対仕訳の場合、元仕訳を指す
    posted_at          TIMESTAMPTZ,
    posted_by          UUID REFERENCES users(id),
    voided_at          TIMESTAMPTZ,
    voided_by          UUID REFERENCES users(id),
    created_by         UUID NOT NULL REFERENCES users(id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, entry_no)
);
CREATE INDEX ix_journal_entries_date ON journal_entries(tenant_id, entry_date);
CREATE INDEX ix_journal_entries_status ON journal_entries(tenant_id, status);
CREATE INDEX ix_journal_entries_source ON journal_entries(tenant_id, source_type, source_id);

CREATE TABLE journal_entry_lines (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id),
    journal_entry_id  UUID NOT NULL REFERENCES journal_entries(id),
    line_no           SMALLINT NOT NULL,
    account_id        UUID NOT NULL REFERENCES accounts(id),
    debit_credit      debit_credit_enum NOT NULL,
    amount            NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
    tax_category_id   UUID REFERENCES tax_categories(id),
    tax_amount        NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    department_id     UUID REFERENCES departments(id),
    customer_id       UUID REFERENCES customers(id),
    vendor_id         UUID REFERENCES vendors(id),
    description       TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (journal_entry_id, line_no)
);
CREATE INDEX ix_journal_entry_lines_account ON journal_entry_lines(tenant_id, account_id);
CREATE INDEX ix_journal_entry_lines_entry ON journal_entry_lines(journal_entry_id);

-- 仕訳ベクトル(過去仕訳の類似検索によるAI提案精度向上。pgvector)
CREATE TABLE journal_entry_embeddings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id),
    journal_entry_id  UUID NOT NULL UNIQUE REFERENCES journal_entries(id),
    embedding         VECTOR(1536) NOT NULL,
    model_name        TEXT NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_journal_entry_embeddings_ivfflat ON journal_entry_embeddings
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ----------------------------------------------------------------------------
-- 2.7 銀行明細 / カード明細 / 自動仕訳ルール
-- ----------------------------------------------------------------------------

CREATE TABLE bank_transactions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL REFERENCES tenants(id),
    bank_account_id       UUID NOT NULL REFERENCES bank_accounts(id),
    transaction_date      DATE NOT NULL,
    description           TEXT,
    amount                NUMERIC(18, 2) NOT NULL, -- 入金:正 / 出金:負
    balance_after          NUMERIC(18, 2),
    import_hash           TEXT NOT NULL,           -- (口座,日付,金額,摘要)から生成。重複取込防止
    match_status          bank_match_status_enum NOT NULL DEFAULT 'unmatched',
    matched_journal_entry_id UUID REFERENCES journal_entries(id),
    imported_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (bank_account_id, import_hash)
);
CREATE INDEX ix_bank_transactions_status ON bank_transactions(tenant_id, match_status);
CREATE INDEX ix_bank_transactions_date ON bank_transactions(tenant_id, transaction_date);

CREATE TABLE card_transactions (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                 UUID NOT NULL REFERENCES tenants(id),
    credit_card_id            UUID NOT NULL REFERENCES credit_cards(id),
    transaction_date          DATE NOT NULL,
    description                TEXT,
    amount                    NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
    import_hash                TEXT NOT NULL,
    match_status               bank_match_status_enum NOT NULL DEFAULT 'unmatched',
    matched_expense_report_line_id UUID, -- FK追加は当該表定義後にALTERで付与
    matched_journal_entry_id   UUID REFERENCES journal_entries(id),
    imported_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (credit_card_id, import_hash)
);
CREATE INDEX ix_card_transactions_status ON card_transactions(tenant_id, match_status);

CREATE TABLE auto_journal_rules (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL REFERENCES tenants(id),
    rule_name          TEXT NOT NULL,
    priority           INTEGER NOT NULL DEFAULT 100,
    source              TEXT NOT NULL CHECK (source IN ('bank', 'card')),
    match_pattern       TEXT NOT NULL,  -- 摘要の正規表現/部分一致パターン
    min_amount          NUMERIC(18, 2),
    max_amount          NUMERIC(18, 2),
    debit_account_id    UUID REFERENCES accounts(id),
    credit_account_id   UUID REFERENCES accounts(id),
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_auto_journal_rules_priority ON auto_journal_rules(tenant_id, source, priority);

-- ----------------------------------------------------------------------------
-- 2.8 売上請求書 (Accounts Receivable) ※仕入請求書とは明確に分離
-- ----------------------------------------------------------------------------

CREATE TABLE invoices (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id),
    invoice_no       TEXT NOT NULL,
    customer_id      UUID NOT NULL REFERENCES customers(id),
    issue_date       DATE NOT NULL,
    due_date         DATE NOT NULL,
    status           invoice_status_enum NOT NULL DEFAULT 'draft',
    subtotal_amount  NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
    tax_amount       NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    total_amount     NUMERIC(18, 2) GENERATED ALWAYS AS (subtotal_amount + tax_amount) STORED,
    currency_code    CHAR(3) NOT NULL DEFAULT 'JPY',
    journal_entry_id UUID REFERENCES journal_entries(id), -- 発行時の売上計上仕訳
    issued_at        TIMESTAMPTZ,
    voided_at        TIMESTAMPTZ,
    created_by       UUID NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (due_date >= issue_date),
    UNIQUE (tenant_id, invoice_no)
);
CREATE INDEX ix_invoices_status ON invoices(tenant_id, status);
CREATE INDEX ix_invoices_customer ON invoices(tenant_id, customer_id);
CREATE INDEX ix_invoices_due_date ON invoices(tenant_id, due_date) WHERE status IN ('issued', 'partially_paid', 'overdue');

CREATE TABLE invoice_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    invoice_id      UUID NOT NULL REFERENCES invoices(id),
    line_no         SMALLINT NOT NULL,
    description     TEXT NOT NULL,
    quantity        NUMERIC(14, 2) NOT NULL DEFAULT 1,
    unit_price      NUMERIC(18, 2) NOT NULL,
    amount          NUMERIC(18, 2) NOT NULL, -- quantity*unit_price(丸めはアプリ側で1請求書税区分ごと1回)
    tax_category_id UUID NOT NULL REFERENCES tax_categories(id),
    account_id      UUID NOT NULL REFERENCES accounts(id), -- 売上高科目
    UNIQUE (invoice_id, line_no)
);

-- 発行済み請求書の訂正は反対仕訳的な「クレジットノート」で行う(直接UPDATE禁止)
CREATE TABLE credit_notes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),
    original_invoice_id UUID NOT NULL REFERENCES invoices(id),
    credit_note_no      TEXT NOT NULL,
    issue_date          DATE NOT NULL,
    amount              NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
    reason              TEXT NOT NULL,
    journal_entry_id    UUID REFERENCES journal_entries(id),
    created_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, credit_note_no)
);

CREATE TABLE invoice_payments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),
    invoice_id          UUID NOT NULL REFERENCES invoices(id),
    payment_date        DATE NOT NULL,
    amount              NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
    bank_transaction_id UUID REFERENCES bank_transactions(id),
    journal_entry_id    UUID REFERENCES journal_entries(id), -- 消込仕訳
    matched_by          TEXT NOT NULL DEFAULT 'manual' CHECK (matched_by IN ('auto', 'manual')),
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_invoice_payments_invoice ON invoice_payments(invoice_id);

-- ----------------------------------------------------------------------------
-- 2.9 仕入請求書 / 買掛金 (Accounts Payable) ※売上請求書とは明確に分離
-- ----------------------------------------------------------------------------

CREATE TABLE vendor_bills (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id),
    bill_no          TEXT NOT NULL,
    vendor_id        UUID NOT NULL REFERENCES vendors(id),
    bill_date        DATE NOT NULL,
    due_date         DATE NOT NULL,
    status           vendor_bill_status_enum NOT NULL DEFAULT 'draft',
    subtotal_amount  NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
    tax_amount       NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    total_amount     NUMERIC(18, 2) GENERATED ALWAYS AS (subtotal_amount + tax_amount) STORED,
    payment_method   payment_method_enum NOT NULL DEFAULT 'bank_transfer',
    journal_entry_id UUID REFERENCES journal_entries(id),
    current_approval_step SMALLINT NOT NULL DEFAULT 0,
    created_by       UUID NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (due_date >= bill_date),
    UNIQUE (tenant_id, bill_no)
);
CREATE INDEX ix_vendor_bills_status ON vendor_bills(tenant_id, status);
CREATE INDEX ix_vendor_bills_vendor ON vendor_bills(tenant_id, vendor_id);

CREATE TABLE vendor_bill_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    vendor_bill_id  UUID NOT NULL REFERENCES vendor_bills(id),
    line_no         SMALLINT NOT NULL,
    description     TEXT NOT NULL,
    amount          NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
    tax_category_id UUID NOT NULL REFERENCES tax_categories(id),
    account_id      UUID NOT NULL REFERENCES accounts(id), -- 費用/資産科目(借方)
    department_id   UUID REFERENCES departments(id),
    UNIQUE (vendor_bill_id, line_no)
);

CREATE TABLE vendor_bill_payments (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID NOT NULL REFERENCES tenants(id),
    vendor_bill_id         UUID NOT NULL REFERENCES vendor_bills(id),
    payment_date           DATE NOT NULL,
    amount                 NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
    bank_transaction_id    UUID REFERENCES bank_transactions(id),
    payment_batch_item_id  UUID, -- FKは payment_batch_items 定義後にALTERで付与
    journal_entry_id       UUID REFERENCES journal_entries(id),
    matched_by             TEXT NOT NULL DEFAULT 'manual' CHECK (matched_by IN ('auto', 'manual')),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_vendor_bill_payments_bill ON vendor_bill_payments(vendor_bill_id);

-- ----------------------------------------------------------------------------
-- 2.10 支払バッチ / 全銀協FBデータ出力
-- ----------------------------------------------------------------------------

CREATE TABLE payment_batches (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id),
    batch_no     TEXT NOT NULL,
    payment_date DATE NOT NULL,
    batch_type   TEXT NOT NULL DEFAULT 'zengin_transfer' CHECK (batch_type IN ('zengin_transfer')),
    status       payment_batch_status_enum NOT NULL DEFAULT 'draft',
    total_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
    file_hash    TEXT,
    exported_at  TIMESTAMPTZ,
    exported_by  UUID REFERENCES users(id),
    created_by   UUID NOT NULL REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, batch_no)
);

-- 出力時点でのスナップショット。source_typeによりvendor_bill/経費立替/給与を横断的に格納
CREATE TABLE payment_batch_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id),
    payment_batch_id  UUID NOT NULL REFERENCES payment_batches(id),
    source_type       TEXT NOT NULL CHECK (source_type IN ('vendor_bill', 'expense_reimbursement', 'payroll')),
    source_id         UUID NOT NULL,
    payee_name        TEXT NOT NULL,
    payee_bank_info   JSONB NOT NULL,
    amount            NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_payment_batch_items_batch ON payment_batch_items(payment_batch_id);
CREATE INDEX ix_payment_batch_items_source ON payment_batch_items(tenant_id, source_type, source_id);

ALTER TABLE vendor_bill_payments
    ADD CONSTRAINT fk_vendor_bill_payments_batch_item
    FOREIGN KEY (payment_batch_item_id) REFERENCES payment_batch_items(id);

-- card_transactions.matched_expense_report_line_id への FK は、
-- expense_report_lines テーブル作成後(セクション2.12末尾)でALTERにより付与する。

-- ----------------------------------------------------------------------------
-- 2.11 承認ワークフロー (共通: 仕訳/経費/仕入請求書等を横断)
-- ----------------------------------------------------------------------------

CREATE TABLE approval_rules (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id),
    target_type      TEXT NOT NULL CHECK (target_type IN ('journal_entry', 'expense_report', 'vendor_bill')),
    step_number      SMALLINT NOT NULL CHECK (step_number > 0),
    condition        JSONB NOT NULL DEFAULT '{}', -- 例: {"min_amount": 100000}
    approver_role_id UUID REFERENCES roles(id),
    approver_user_id UUID REFERENCES users(id),
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (approver_role_id IS NOT NULL OR approver_user_id IS NOT NULL),
    UNIQUE (tenant_id, target_type, step_number, approver_role_id, approver_user_id)
);

CREATE TABLE approval_requests (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id),
    target_type   TEXT NOT NULL CHECK (target_type IN ('journal_entry', 'expense_report', 'vendor_bill')),
    target_id     UUID NOT NULL,
    submitted_by  UUID NOT NULL REFERENCES users(id), -- 自己承認禁止チェックの基準
    total_steps   SMALLINT NOT NULL CHECK (total_steps > 0),
    current_step  SMALLINT NOT NULL DEFAULT 1,
    status        approval_request_status_enum NOT NULL DEFAULT 'pending',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (target_type, target_id)
);
CREATE INDEX ix_approval_requests_status ON approval_requests(tenant_id, status);

-- 追記専用: 承認履歴
CREATE TABLE approval_history (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),
    approval_request_id UUID NOT NULL REFERENCES approval_requests(id),
    step_number         SMALLINT NOT NULL CHECK (step_number > 0),
    approver_id         UUID NOT NULL REFERENCES users(id),
    action               approval_action_enum NOT NULL,
    comment              TEXT,
    acted_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_approval_history_request ON approval_history(approval_request_id);

-- ----------------------------------------------------------------------------
-- 2.12 経費精算 / 出張旅費 / 定期仕訳
-- ----------------------------------------------------------------------------

CREATE TABLE expense_categories (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL REFERENCES tenants(id),
    code               TEXT NOT NULL,
    name               TEXT NOT NULL,
    default_account_id UUID REFERENCES accounts(id),
    requires_receipt   BOOLEAN NOT NULL DEFAULT TRUE,
    monthly_limit_amount NUMERIC(18, 2),
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (tenant_id, code)
);

CREATE TABLE travel_policies (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id),
    name                        TEXT NOT NULL,
    per_diem_domestic_amount    NUMERIC(18, 2) NOT NULL DEFAULT 0,
    per_diem_overseas_amount    NUMERIC(18, 2) NOT NULL DEFAULT 0,
    lodging_cap_amount          NUMERIC(18, 2),
    effective_from               DATE NOT NULL,
    is_active                    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE expense_reports (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID NOT NULL REFERENCES tenants(id),
    report_no              TEXT NOT NULL,
    submitted_by           UUID NOT NULL REFERENCES users(id), -- 実際の申請実行者
    on_behalf_of           UUID NOT NULL REFERENCES users(id), -- 費用が帰属する従業員(代理申請時に分離)
    purpose                TEXT,
    status                 expense_report_status_enum NOT NULL DEFAULT 'submitted',
    total_amount           NUMERIC(18, 2) NOT NULL DEFAULT 0,
    journal_entry_id       UUID REFERENCES journal_entries(id), -- 申請時先行起票されたdraft仕訳
    reimbursement_payment_batch_item_id UUID, -- 立替金振込データとの紐付け(payment_batch_items後にALTER)
    submitted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, report_no)
);
CREATE INDEX ix_expense_reports_status ON expense_reports(tenant_id, status);
CREATE INDEX ix_expense_reports_on_behalf_of ON expense_reports(tenant_id, on_behalf_of);

ALTER TABLE expense_reports
    ADD CONSTRAINT fk_expense_reports_batch_item
    FOREIGN KEY (reimbursement_payment_batch_item_id) REFERENCES payment_batch_items(id);

CREATE TABLE expense_report_lines (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id),
    expense_report_id UUID NOT NULL REFERENCES expense_reports(id),
    line_no           SMALLINT NOT NULL,
    expense_date      DATE NOT NULL,
    category_id       UUID NOT NULL REFERENCES expense_categories(id),
    description       TEXT,
    amount            NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
    -- 支払方法に応じ貸方科目決定ロジックがアプリ層で確定(現金/法人カード/銀行振込/従業員立替)
    payment_method    payment_method_enum NOT NULL,
    tax_category_id   UUID REFERENCES tax_categories(id),
    card_transaction_id UUID REFERENCES card_transactions(id), -- 法人カード明細との突合
    UNIQUE (expense_report_id, line_no)
);

ALTER TABLE card_transactions
    ADD CONSTRAINT fk_card_transactions_expense_line
    FOREIGN KEY (matched_expense_report_line_id) REFERENCES expense_report_lines(id);

CREATE TABLE recurring_journal_templates (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL REFERENCES tenants(id),
    template_name      TEXT NOT NULL,
    frequency          recurring_frequency_enum NOT NULL DEFAULT 'monthly',
    day_of_month       SMALLINT NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
    debit_account_id   UUID NOT NULL REFERENCES accounts(id),
    credit_account_id  UUID NOT NULL REFERENCES accounts(id),
    amount             NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
    description        TEXT,
    next_run_date      DATE NOT NULL,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE recurring_journal_runs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id),
    template_id       UUID NOT NULL REFERENCES recurring_journal_templates(id),
    run_date          DATE NOT NULL,
    journal_entry_id  UUID REFERENCES journal_entries(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (template_id, run_date)
);

-- ----------------------------------------------------------------------------
-- 2.13 固定資産 / 減価償却
-- ----------------------------------------------------------------------------

CREATE TABLE fixed_assets (
    id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                     UUID NOT NULL REFERENCES tenants(id),
    asset_no                      TEXT NOT NULL,
    name                          TEXT NOT NULL,
    category                      TEXT,
    acquisition_date              DATE NOT NULL,
    acquisition_cost              NUMERIC(18, 2) NOT NULL CHECK (acquisition_cost > 0),
    useful_life_years             SMALLINT NOT NULL CHECK (useful_life_years > 0),
    depreciation_method           depreciation_method_enum NOT NULL,
    salvage_value                 NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0),
    status                        fixed_asset_status_enum NOT NULL DEFAULT 'active',
    accumulated_depreciation      NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (accumulated_depreciation >= 0),
    department_id                 UUID REFERENCES departments(id),
    asset_account_id              UUID NOT NULL REFERENCES accounts(id),      -- 資産科目
    depreciation_expense_account_id UUID NOT NULL REFERENCES accounts(id),    -- 減価償却費科目
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, asset_no),
    CHECK (accumulated_depreciation <= acquisition_cost)
);
CREATE INDEX ix_fixed_assets_status ON fixed_assets(tenant_id, status);

-- 追記専用(posted後): 償却スケジュール/実績
CREATE TABLE depreciation_schedules (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id),
    fixed_asset_id   UUID NOT NULL REFERENCES fixed_assets(id),
    fiscal_period_id UUID NOT NULL REFERENCES fiscal_periods(id),
    scheduled_amount NUMERIC(18, 2) NOT NULL CHECK (scheduled_amount >= 0),
    actual_amount    NUMERIC(18, 2),
    journal_entry_id UUID REFERENCES journal_entries(id),
    status           accrual_schedule_status_enum NOT NULL DEFAULT 'scheduled',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (fixed_asset_id, fiscal_period_id)
);

CREATE TABLE fixed_asset_disposals (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id),
    fixed_asset_id   UUID NOT NULL UNIQUE REFERENCES fixed_assets(id),
    disposal_date    DATE NOT NULL,
    disposal_type    disposal_type_enum NOT NULL,
    proceeds_amount  NUMERIC(18, 2) NOT NULL DEFAULT 0,
    gain_loss_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
    journal_entry_id UUID REFERENCES journal_entries(id),
    created_by       UUID NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 2.14 経過勘定 (前払/未払/前受/未収の自動振替)
-- ----------------------------------------------------------------------------

CREATE TABLE accrual_schedules (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID NOT NULL REFERENCES tenants(id),
    source_type            TEXT NOT NULL CHECK (source_type IN ('vendor_bill', 'invoice', 'manual')),
    source_id              UUID,
    total_amount           NUMERIC(18, 2) NOT NULL CHECK (total_amount > 0),
    start_period_id        UUID NOT NULL REFERENCES fiscal_periods(id),
    end_period_id          UUID NOT NULL REFERENCES fiscal_periods(id),
    method                 TEXT NOT NULL DEFAULT 'straight_line' CHECK (method IN ('straight_line')),
    original_account_id    UUID NOT NULL REFERENCES accounts(id), -- 前払費用/前受収益等の経過勘定科目
    target_account_id      UUID NOT NULL REFERENCES accounts(id), -- 振替先の費用/収益科目
    created_by             UUID NOT NULL REFERENCES users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE accrual_schedule_lines (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),
    accrual_schedule_id UUID NOT NULL REFERENCES accrual_schedules(id),
    fiscal_period_id    UUID NOT NULL REFERENCES fiscal_periods(id),
    amount              NUMERIC(18, 2) NOT NULL CHECK (amount >= 0),
    journal_entry_id    UUID REFERENCES journal_entries(id),
    status              accrual_schedule_status_enum NOT NULL DEFAULT 'scheduled',
    UNIQUE (accrual_schedule_id, fiscal_period_id)
);

-- ----------------------------------------------------------------------------
-- 2.15 消費税申告サポート
-- ----------------------------------------------------------------------------

CREATE TABLE consumption_tax_returns (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID NOT NULL REFERENCES tenants(id),
    fiscal_year_id         UUID NOT NULL REFERENCES fiscal_years(id),
    filing_method          tax_filing_method_enum NOT NULL,
    taxable_sales_amount   NUMERIC(18, 2) NOT NULL DEFAULT 0,
    taxable_purchase_amount NUMERIC(18, 2) NOT NULL DEFAULT 0,
    tax_due_amount         NUMERIC(18, 2) NOT NULL DEFAULT 0,
    status                 TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized')),
    finalized_at           TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, fiscal_year_id)
);

CREATE TABLE consumption_tax_return_lines (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                   UUID NOT NULL REFERENCES tenants(id),
    consumption_tax_return_id   UUID NOT NULL REFERENCES consumption_tax_returns(id),
    category                    TEXT NOT NULL, -- 例: 課税売上10%, 課税仕入8%軽減 等
    amount                      NUMERIC(18, 2) NOT NULL DEFAULT 0
);

-- ----------------------------------------------------------------------------
-- 2.16 給与連携
-- ----------------------------------------------------------------------------

CREATE TABLE payroll_import_mappings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    name            TEXT NOT NULL,
    column_mapping  JSONB NOT NULL,
    account_mapping JSONB NOT NULL, -- 役員報酬/給与手当/預り金各種/法定福利費 -> account_id
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE payroll_imports (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id),
    pay_period_start  DATE NOT NULL,
    pay_period_end    DATE NOT NULL,
    payment_date      DATE NOT NULL,
    import_mapping_id UUID NOT NULL REFERENCES payroll_import_mappings(id),
    status            payroll_import_status_enum NOT NULL DEFAULT 'imported',
    journal_entry_id  UUID REFERENCES journal_entries(id), -- 複合仕訳(1トランザクション)
    created_by        UUID NOT NULL REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (pay_period_end >= pay_period_start)
);

CREATE TABLE payroll_import_lines (
    id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                           UUID NOT NULL REFERENCES tenants(id),
    payroll_import_id                   UUID NOT NULL REFERENCES payroll_imports(id),
    employee_name                       TEXT NOT NULL,
    employee_code                       TEXT,
    executive_compensation_amount       NUMERIC(18, 2) NOT NULL DEFAULT 0,
    salary_amount                       NUMERIC(18, 2) NOT NULL DEFAULT 0,
    withholding_tax_amount              NUMERIC(18, 2) NOT NULL DEFAULT 0,  -- 源泉所得税預り金
    resident_tax_amount                 NUMERIC(18, 2) NOT NULL DEFAULT 0,  -- 住民税預り金
    social_insurance_employee_amount    NUMERIC(18, 2) NOT NULL DEFAULT 0,  -- 社保 本人負担(預り金)
    social_insurance_company_amount     NUMERIC(18, 2) NOT NULL DEFAULT 0,  -- 社保 会社負担(法定福利費)
    net_payment_amount                  NUMERIC(18, 2) NOT NULL DEFAULT 0,  -- 差引支給額
    CHECK (
        net_payment_amount = executive_compensation_amount + salary_amount
            - withholding_tax_amount - resident_tax_amount - social_insurance_employee_amount
    )
);

-- ----------------------------------------------------------------------------
-- 2.17 AI提案の隔離保存 (確定データとは物理的に分離)
-- ----------------------------------------------------------------------------

CREATE TABLE ai_suggestions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id),
    target_type      TEXT NOT NULL CHECK (target_type IN (
        'journal_entry', 'expense_report_line', 'bank_transaction', 'vendor_bill', 'expense_report'
    )),
    target_id        UUID NOT NULL,
    suggestion_type  TEXT NOT NULL CHECK (suggestion_type IN (
        'account_code', 'tax_category', 'reconciliation_match', 'anomaly_flag', 'ocr'
    )),
    payload          JSONB NOT NULL,     -- 候補科目・信頼度スコア等の構造化提案
    confidence_score NUMERIC(4, 3) CHECK (confidence_score BETWEEN 0 AND 1),
    model_name       TEXT NOT NULL,
    accepted         BOOLEAN,            -- 人間/ルールエンジンによる採否(NULL=未判定)
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_ai_suggestions_target ON ai_suggestions(tenant_id, target_type, target_id);

-- ----------------------------------------------------------------------------
-- 2.18 監査ログ (追記専用・物理削除禁止)
-- ----------------------------------------------------------------------------

CREATE TABLE audit_logs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id),
    actor_user_id UUID REFERENCES users(id),
    action        TEXT NOT NULL,   -- 例: 'journal_entry.posted', 'invoice.issued', 'approval.approved'
    target_type   TEXT NOT NULL,
    target_id     UUID,
    before_data   JSONB,
    after_data    JSONB,
    ip_address    INET,
    occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_logs_target ON audit_logs(tenant_id, target_type, target_id);
CREATE INDEX ix_audit_logs_actor ON audit_logs(tenant_id, actor_user_id, occurred_at);


-- ============================================================================
-- PART 3: 共通トリガー関数
-- ============================================================================

-- 3.1 updated_at 自動更新
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3.2 追記専用ガード(汎用): 当該テーブルへのUPDATE/DELETEを常に禁止
CREATE OR REPLACE FUNCTION fn_prevent_update_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: % operation is not permitted (table=%)',
        TG_TABLE_NAME, TG_OP, TG_TABLE_NAME
        USING ERRCODE = '23001';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 3.3 仕訳明細の改変防止: 親仕訳がdraft以外の場合、明細のUPDATE/DELETEを禁止
CREATE OR REPLACE FUNCTION fn_prevent_modify_nondraft_journal_lines()
RETURNS TRIGGER AS $$
DECLARE
    v_status je_status_enum;
    v_entry_id UUID;
BEGIN
    v_entry_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
    SELECT status INTO v_status FROM journal_entries WHERE id = v_entry_id;
    IF v_status IS DISTINCT FROM 'draft' THEN
        RAISE EXCEPTION 'journal_entry_lines cannot be modified once parent journal_entry status is %', v_status
            USING ERRCODE = '23001';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- 3.4 仕訳ヘッダの改変防止 + void(即時取消)の時間窓・被参照チェック
CREATE OR REPLACE FUNCTION fn_guard_journal_entry_transition()
RETURNS TRIGGER AS $$
BEGIN
    -- 物理削除は常に禁止(訂正は反対仕訳/void)
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'journal_entries rows cannot be physically deleted; use void or reversal'
            USING ERRCODE = '23001';
    END IF;

    -- posted状態からの遷移は voided のみ許可。それ以外の列変更は一切禁止。
    IF OLD.status = 'posted' THEN
        IF NEW.status = 'voided' THEN
            -- 24時間以内かつ他テーブルから未参照であることを要求
            IF now() - OLD.posted_at > INTERVAL '24 hours' THEN
                RAISE EXCEPTION 'void is only allowed within 24 hours of posting; use a reversing entry instead'
                    USING ERRCODE = '23001';
            END IF;
            IF EXISTS (SELECT 1 FROM invoice_payments WHERE journal_entry_id = OLD.id)
               OR EXISTS (SELECT 1 FROM vendor_bill_payments WHERE journal_entry_id = OLD.id)
               OR EXISTS (SELECT 1 FROM invoices WHERE journal_entry_id = OLD.id)
               OR EXISTS (SELECT 1 FROM vendor_bills WHERE journal_entry_id = OLD.id)
               OR EXISTS (SELECT 1 FROM depreciation_schedules WHERE journal_entry_id = OLD.id)
               OR EXISTS (SELECT 1 FROM accrual_schedule_lines WHERE journal_entry_id = OLD.id)
            THEN
                RAISE EXCEPTION 'journal_entry % is already referenced by other records; use a reversing entry instead', OLD.id
                    USING ERRCODE = '23001';
            END IF;
        ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'posted journal_entries can only transition to voided (got %); use a reversing entry instead', NEW.status
                USING ERRCODE = '23001';
        ELSE
            RAISE EXCEPTION 'posted journal_entries are append-only and cannot be updated'
                USING ERRCODE = '23001';
        END IF;
    END IF;

    IF OLD.status IN ('voided', 'reversed') THEN
        RAISE EXCEPTION 'journal_entries in status % are immutable', OLD.status
            USING ERRCODE = '23001';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3.5 貸借一致チェック: draft -> posted への遷移時に厳格検証
CREATE OR REPLACE FUNCTION fn_check_journal_balance()
RETURNS TRIGGER AS $$
DECLARE
    v_debit  NUMERIC(18, 2);
    v_credit NUMERIC(18, 2);
    v_lines  INTEGER;
BEGIN
    IF NEW.status = 'posted' AND (OLD.status IS DISTINCT FROM 'posted') THEN
        SELECT
            COALESCE(SUM(amount) FILTER (WHERE debit_credit = 'debit'), 0),
            COALESCE(SUM(amount) FILTER (WHERE debit_credit = 'credit'), 0),
            COUNT(*)
        INTO v_debit, v_credit, v_lines
        FROM journal_entry_lines
        WHERE journal_entry_id = NEW.id;

        IF v_lines < 2 THEN
            RAISE EXCEPTION 'journal_entry % must have at least 2 lines to be posted', NEW.id
                USING ERRCODE = '23514';
        END IF;

        IF v_debit <> v_credit THEN
            RAISE EXCEPTION 'journal_entry % is not balanced: debit=% credit=%', NEW.id, v_debit, v_credit
                USING ERRCODE = '23514';
        END IF;

        NEW.posted_at := COALESCE(NEW.posted_at, now());
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3.6 自己承認の禁止: 申請者=承認者の組み合わせを拒否
CREATE OR REPLACE FUNCTION fn_prevent_self_approval()
RETURNS TRIGGER AS $$
DECLARE
    v_submitted_by UUID;
BEGIN
    SELECT submitted_by INTO v_submitted_by
    FROM approval_requests WHERE id = NEW.approval_request_id;

    IF v_submitted_by = NEW.approver_id THEN
        RAISE EXCEPTION 'self-approval is not permitted (submitter=%, approver=%)', v_submitted_by, NEW.approver_id
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- PART 4: トリガー適用
-- ============================================================================

-- 4.1 updated_at トリガー(該当列を持つ全テーブル)
DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN
        SELECT c.table_name FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.column_name = 'updated_at'
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();', t
        );
    END LOOP;
END $$;

-- 4.2 仕訳ヘッダ: 遷移ガード + 貸借一致チェック
CREATE TRIGGER trg_guard_journal_entry_transition
    BEFORE UPDATE OR DELETE ON journal_entries
    FOR EACH ROW EXECUTE FUNCTION fn_guard_journal_entry_transition();

CREATE TRIGGER trg_check_journal_balance
    BEFORE UPDATE ON journal_entries
    FOR EACH ROW EXECUTE FUNCTION fn_check_journal_balance();

-- 4.3 仕訳明細: draft以外での改変禁止
CREATE TRIGGER trg_guard_journal_entry_lines
    BEFORE UPDATE OR DELETE ON journal_entry_lines
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_modify_nondraft_journal_lines();

-- 4.4 追記専用テーブル群: UPDATE/DELETE 物理禁止
DO $$
DECLARE
    t TEXT;
    append_only_tables TEXT[] := ARRAY[
        'audit_logs', 'attachments', 'attachment_links',
        'invoice_payments', 'vendor_bill_payments', 'payment_batch_items',
        'approval_history', 'ai_suggestions', 'journal_entry_embeddings',
        'credit_notes', 'recurring_journal_runs', 'payroll_import_lines',
        'consumption_tax_return_lines'
    ];
BEGIN
    FOREACH t IN ARRAY append_only_tables LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_append_only BEFORE UPDATE OR DELETE ON %I
             FOR EACH ROW EXECUTE FUNCTION fn_prevent_update_delete();', t
        );
    END LOOP;
END $$;

-- 4.5 自己承認禁止
CREATE TRIGGER trg_prevent_self_approval
    BEFORE INSERT ON approval_history
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_self_approval();

-- 4.6 payment_batches: exported以降は追記専用化(draftのみ更新可)
CREATE OR REPLACE FUNCTION fn_guard_payment_batch()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' AND OLD.status <> 'draft' THEN
        RAISE EXCEPTION 'payment_batches in status % cannot be deleted', OLD.status USING ERRCODE = '23001';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'exported' AND NEW.status NOT IN ('exported', 'completed', 'cancelled') THEN
        RAISE EXCEPTION 'exported payment_batches cannot revert to draft' USING ERRCODE = '23001';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_payment_batch
    BEFORE UPDATE OR DELETE ON payment_batches
    FOR EACH ROW EXECUTE FUNCTION fn_guard_payment_batch();


-- ============================================================================
-- PART 5: 行レベルセキュリティ (RLS) — 完全テナント分離
-- ============================================================================
-- 方針: 全テナント固有表に対し、
--   1) ENABLE ROW LEVEL SECURITY
--   2) FORCE ROW LEVEL SECURITY (テーブルオーナーであっても迂回不可)
--   3) 標準ポリシー: tenant_id = fn_current_tenant_id()
--   4) app.current_tenant_id が未設定の場合は fn_current_tenant_id() が NULL を返し、
--      NULL = tenant_id は常にfalseとなるため、自動的に0件(fail-closed)になる。
--
-- 【重要な実装上の注意(検証で判明した実際のPostgreSQL挙動)】
-- カスタムGUC(app.*)は、一度でも同一セッション内で SET LOCAL された後、
-- トランザクション終了によりスコープが切れると、値が NULL ではなく
-- 空文字列 '' に戻る(プレースホルダ変数のリセット値が''であるため)。
-- そのため `current_setting(...)::uuid` を直接使うと、未設定時に
-- 「NULLとの比較で0件」ではなく「''のuuidキャストエラー」で例外が飛ぶ
-- 場合がある(fail-closedではあるがエラーになり運用上望ましくない)。
-- 下記 fn_current_tenant_id() / fn_current_user_id() で NULLIF(...,'')
-- と例外ハンドリングにより、未設定時は必ず静かにNULLを返すようにする。
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_current_tenant_id()
RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_tenant_id', true), '')::uuid;
EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION fn_current_user_id()
RETURNS UUID AS $$
BEGIN
    RETURN NULLIF(current_setting('app.current_user_id', true), '')::uuid;
EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

DO $$
DECLARE
    t TEXT;
    tenant_tables TEXT[] := ARRAY[
        'tenants', 'tenant_users', 'external_access_grants', 'member_invitations',
        'attachments', 'attachment_links',
        'departments', 'account_categories', 'accounts', 'tax_categories',
        'tenant_accounting_settings', 'tenant_integration_settings',
        'fiscal_years', 'fiscal_periods',
        'customers', 'vendors',
        'bank_accounts', 'bank_import_profiles', 'credit_cards',
        'journal_entries', 'journal_entry_lines', 'journal_entry_embeddings',
        'bank_transactions', 'card_transactions', 'auto_journal_rules',
        'invoices', 'invoice_lines', 'credit_notes', 'invoice_payments',
        'vendor_bills', 'vendor_bill_lines', 'vendor_bill_payments',
        'payment_batches', 'payment_batch_items',
        'approval_rules', 'approval_requests', 'approval_history',
        'expense_categories', 'travel_policies', 'expense_reports', 'expense_report_lines',
        'recurring_journal_templates', 'recurring_journal_runs',
        'fixed_assets', 'depreciation_schedules', 'fixed_asset_disposals',
        'accrual_schedules', 'accrual_schedule_lines',
        'consumption_tax_returns', 'consumption_tax_return_lines',
        'payroll_import_mappings', 'payroll_imports', 'payroll_import_lines',
        'ai_suggestions', 'audit_logs'
    ];
BEGIN
    FOREACH t IN ARRAY tenant_tables LOOP
        -- tenants テーブル自身は tenant_id ではなく id で判定する特殊ケース
        IF t = 'tenants' THEN
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
            EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
            EXECUTE format(
                'CREATE POLICY tenant_isolation_%I ON %I
                 USING (id = fn_current_tenant_id())
                 WITH CHECK (id = fn_current_tenant_id());', t, t
            );
        ELSE
            EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
            EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
            EXECUTE format(
                'CREATE POLICY tenant_isolation_%I ON %I
                 USING (tenant_id = fn_current_tenant_id())
                 WITH CHECK (tenant_id = fn_current_tenant_id());', t, t
            );
        END IF;
    END LOOP;
END $$;

-- user_roles / role_permissions / roles / permissions / users はグローバルまたは
-- 複合PK(tenant_id, user_id, ...)構成のため個別にポリシーを定義する。
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_user_roles ON user_roles
    USING (tenant_id = fn_current_tenant_id())
    WITH CHECK (tenant_id = fn_current_tenant_id());

-- roles / permissions / role_permissions はマスタ的な全テナント共通データのため
-- RLSは適用せず全ロールでSELECT可能とする(書込は管理ロールのみアプリ層で制御)。

-- users はグローバル表。個人情報保護の観点から、自身が所属するテナントに
-- 紐づくユーザーのみ閲覧可能とする(tenant_usersを介した間接ポリシー)。
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scoped_users ON users
    USING (
        EXISTS (
            SELECT 1 FROM tenant_users tu
            WHERE tu.user_id = users.id
              AND tu.tenant_id = fn_current_tenant_id()
        )
        OR id = fn_current_user_id()
    )
    WITH CHECK (id = fn_current_user_id());

-- ----------------------------------------------------------------------------
-- viewer_external (税理士/監査人) の時限アクセス制御
-- ----------------------------------------------------------------------------
-- 実装方針: PostgreSQLのRLSでは同一コマンドに対する PERMISSIVE ポリシーは
-- OR で合成されるため、テナント分離ポリシーに単純に別の PERMISSIVE ポリシーを
-- 追加しても「制限」にはならない(むしろ閲覧範囲が拡張されてしまう)。
-- したがって本要件は RESTRICTIVE ポリシー(AND合成)として実装し、
-- 全ての PERMISSIVE ポリシーの結果に対して追加の必須条件として課す。
--
-- また、判定基準はアプリ層が SET LOCAL する自己申告の app.current_role ではなく、
-- 実際に接続に使用されたDBロール(current_user = 'app_readonly_external')に
-- 基づかせることで、アプリケーション層のバグや侵害によってもこの制限を
-- 迂回できないようにする(原則2: DB制約による最終防御)。
-- SECURITY DEFINER が必須: external_access_grants テーブル自身にも
-- 同じ時限アクセス制限(RESTRICTIVEポリシー)が適用されるため、呼び出し元の
-- 権限のまま(SECURITY INVOKER)ではこの判定クエリ自体が「有効な許可がなければ
-- 有効な許可を確認できない」という循環参照に陥り、常にfalseとなってしまう。
-- SECURITY DEFINERにより関数所有者権限でRLSをバイパスして判定のみ行う。
-- 判定パラメータはセッション変数由来のtenant_id/user_idに限定されているため
-- 任意テナントの情報を漏洩する経路にはならない。
CREATE OR REPLACE FUNCTION fn_has_active_external_grant()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM external_access_grants g
        WHERE g.tenant_id = fn_current_tenant_id()
          AND g.user_id = fn_current_user_id()
          AND now() BETWEEN g.valid_from AND g.valid_until
    );
$$;

-- ----------------------------------------------------------------------------
-- ログイン認証用の限定的なRLSバイパス関数 (fn_has_active_external_grant と同じ設計方針)
-- ----------------------------------------------------------------------------
-- POST /auth/login の時点では app.current_tenant_id / app.current_user_id の
-- いずれも未確立(これから確立するために本人確認を行う処理そのもの)であるため、
-- 通常の users RLSポリシー(tenant_users経由の間接ポリシー、または
-- id = fn_current_user_id())ではメールアドレスによる検索が常に0件になる
-- (循環参照: ログインするにはテナントが要るが、テナントを知るにはログインが要る)。
-- 認証に最小限必要な列のみを返す SECURITY DEFINER 関数でこれを解決する。
CREATE OR REPLACE FUNCTION fn_authenticate_user_by_email(p_email CITEXT)
RETURNS TABLE (id UUID, password_hash TEXT, is_active BOOLEAN, mfa_enabled BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.id, u.password_hash, u.is_active, u.mfa_enabled
    FROM users u
    WHERE u.email = p_email;
$$;

-- POST /auth/mfa (mfa_tokenにはsub=user_idのみが含まれ、テナントは未確立)でのTOTP検証用。
CREATE OR REPLACE FUNCTION fn_get_user_for_mfa(p_user_id UUID)
RETURNS TABLE (id UUID, mfa_secret TEXT, is_active BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.id, u.mfa_secret, u.is_active
    FROM users u
    WHERE u.id = p_user_id;
$$;

-- ログイン/MFA成功直後、アクセストークンに載せる「所属テナント一覧+各テナントでのロール」を
-- 取得するための関数。この時点でもテナントコンテキストは未確立のため同様にSECURITY DEFINERとする。
CREATE OR REPLACE FUNCTION fn_list_user_tenant_memberships(p_user_id UUID)
RETURNS TABLE (tenant_id UUID, tenant_name TEXT, role_code TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT t.id, t.name, r.code::text
    FROM tenant_users tu
    JOIN tenants t ON t.id = tu.tenant_id
    LEFT JOIN user_roles ur ON ur.tenant_id = tu.tenant_id AND ur.user_id = tu.user_id
    LEFT JOIN roles r ON r.id = ur.role_id
    WHERE tu.user_id = p_user_id
      AND tu.is_active = TRUE
      AND t.is_active = TRUE
    ORDER BY tu.joined_at ASC;
$$;

-- GET /auth/invitations/validate, POST /auth/accept-invite 用。招待受諾者は
-- リンクを踏んだ時点でテナント/ユーザーコンテキストのいずれも未確立であり、
-- member_invitations の通常のテナント分離ポリシーでは照会できない
-- (ログイン関数群と同じ循環参照)。生トークンではなく呼び出し元で
-- SHA-256ハッシュ化した値を鍵として、検証・受諾に最小限必要な列のみを返す。
CREATE OR REPLACE FUNCTION fn_get_invitation_by_token_hash(p_token_hash TEXT)
RETURNS TABLE (
    id UUID, tenant_id UUID, tenant_name TEXT, email CITEXT, role_code TEXT,
    invited_by UUID, expires_at TIMESTAMPTZ, accepted_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT mi.id, mi.tenant_id, t.name, mi.email, mi.role_code::text, mi.invited_by,
           mi.expires_at, mi.accepted_at, mi.revoked_at
    FROM member_invitations mi
    JOIN tenants t ON t.id = mi.tenant_id
    WHERE mi.token_hash = p_token_hash;
$$;

DO $$
DECLARE
    t TEXT;
    restricted_tables TEXT[] := ARRAY[
        'tenants', 'tenant_users', 'external_access_grants', 'member_invitations', 'users',
        'attachments', 'attachment_links',
        'departments', 'account_categories', 'accounts', 'tax_categories',
        'tenant_accounting_settings', 'tenant_integration_settings',
        'fiscal_years', 'fiscal_periods',
        'customers', 'vendors',
        'bank_accounts', 'bank_import_profiles', 'credit_cards',
        'journal_entries', 'journal_entry_lines', 'journal_entry_embeddings',
        'bank_transactions', 'card_transactions', 'auto_journal_rules',
        'invoices', 'invoice_lines', 'credit_notes', 'invoice_payments',
        'vendor_bills', 'vendor_bill_lines', 'vendor_bill_payments',
        'payment_batches', 'payment_batch_items',
        'approval_rules', 'approval_requests', 'approval_history',
        'expense_categories', 'travel_policies', 'expense_reports', 'expense_report_lines',
        'recurring_journal_templates', 'recurring_journal_runs',
        'fixed_assets', 'depreciation_schedules', 'fixed_asset_disposals',
        'accrual_schedules', 'accrual_schedule_lines',
        'consumption_tax_returns', 'consumption_tax_return_lines',
        'payroll_import_mappings', 'payroll_imports', 'payroll_import_lines',
        'ai_suggestions', 'audit_logs'
    ];
BEGIN
    FOREACH t IN ARRAY restricted_tables LOOP
        EXECUTE format(
            'CREATE POLICY external_viewer_time_limit_%I ON %I
             AS RESTRICTIVE
             FOR SELECT
             USING (current_user <> ''app_readonly_external'' OR fn_has_active_external_grant());', t, t
        );
    END LOOP;
END $$;


-- ============================================================================
-- PART 6: シードデータ (ロール / 権限の初期値)
-- ============================================================================

INSERT INTO roles (code, name) VALUES
    ('owner', 'テナント管理者'),
    ('accounting_manager', '経理責任者'),
    ('accountant', '経理担当者'),
    ('approver', '承認者'),
    ('employee', '一般従業員'),
    ('payroll_admin', '給与担当'),
    ('viewer_external', '外部閲覧者(税理士/監査人)'),
    ('system_service', 'システム内部処理用')
ON CONFLICT (code) DO NOTHING;

INSERT INTO permissions (code, description) VALUES
    ('journal_entry.create', '仕訳の作成(draft)'),
    ('journal_entry.post', '仕訳の確定'),
    ('journal_entry.void', '仕訳のvoid取消'),
    ('invoice.issue', '売上請求書の発行'),
    ('vendor_bill.approve', '仕入請求書の承認'),
    ('payment_batch.export', '全銀協FBデータの出力'),
    ('expense_report.approve', '経費精算の承認'),
    ('payroll.import', '給与CSVの取込'),
    ('tax_return.finalize', '消費税申告の確定'),
    ('external.view', '外部閲覧者としての読み取りアクセス')
ON CONFLICT (code) DO NOTHING;


-- ============================================================================
-- PART 7: 運用ロール (アプリケーション接続用)
-- ============================================================================
-- 本番環境ではパスワード等はシークレットマネージャで別途管理すること。
-- ここでは検証環境向けの最小定義のみ行う。

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
        CREATE ROLE app_runtime LOGIN PASSWORD 'change_me_in_production';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly_external') THEN
        CREATE ROLE app_readonly_external LOGIN PASSWORD 'change_me_in_production';
    END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_runtime, app_readonly_external;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
-- 実際の削除可否・改変可否は上記トリガー/RLSが最終防御として機能する。
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_readonly_external;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_runtime;

-- アプリケーションは単一のコネクションプール(app_runtimeでログイン)を共有するため、
-- 外部閲覧者(viewer_external)向けリクエストの範囲でのみ `SET LOCAL ROLE app_readonly_external`
-- により一時的に読み取り専用ロールへ降格できるようにする(DatabaseService.transactionAsRole参照)。
-- PostgreSQLの `SET ROLE` は対象ロールのメンバーであることを要求するため、このGRANTが無いと
-- 「permission denied to set role」となり降格自体ができない。app_readonly_externalの権限は
-- app_runtimeの真部分集合(SELECTのみ)であるため、これは権限昇格ではなく権限縮小の一方向許可であり、
-- 安全側の変更である。
GRANT app_readonly_external TO app_runtime;

-- ============================================================================
-- END OF 001_initial_schema_all_in_one.sql
-- ============================================================================
