-- 売上請求書モジュール動作確認用の追加シードデータ(postgresスーパーユーザーで実行。RLSはバイパスされる)

-- invoices.service.ts の勘定科目コード規約に対応する科目
INSERT INTO accounts (id, tenant_id, code, name, account_type, normal_balance)
VALUES ('88888888-8888-8888-8888-888888888881', '11111111-1111-1111-1111-111111111111', '1100', '普通預金', 'asset', 'debit')
ON CONFLICT (id) DO NOTHING;

INSERT INTO accounts (id, tenant_id, code, name, account_type, normal_balance)
VALUES ('88888888-8888-8888-8888-888888888882', '11111111-1111-1111-1111-111111111111', '1200', '売掛金', 'asset', 'debit')
ON CONFLICT (id) DO NOTHING;

INSERT INTO accounts (id, tenant_id, code, name, account_type, normal_balance)
VALUES ('88888888-8888-8888-8888-888888888883', '11111111-1111-1111-1111-111111111111', '2200', '仮受消費税', 'liability', 'credit')
ON CONFLICT (id) DO NOTHING;

-- 売上高科目(請求書明細の売上科目として使用)
INSERT INTO accounts (id, tenant_id, code, name, account_type, normal_balance)
VALUES ('88888888-8888-8888-8888-888888888884', '11111111-1111-1111-1111-111111111111', '4000', '売上高', 'revenue', 'credit')
ON CONFLICT (id) DO NOTHING;

-- 税区分(標準10% / 軽減8%)
INSERT INTO tax_categories (id, tenant_id, code, name, tax_type, tax_rate, is_reduced_rate)
VALUES ('99999999-9999-9999-9999-999999999991', '11111111-1111-1111-1111-111111111111', 'STD10', '標準税率', 'taxable', 10, false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tax_categories (id, tenant_id, code, name, tax_type, tax_rate, is_reduced_rate)
VALUES ('99999999-9999-9999-9999-999999999992', '11111111-1111-1111-1111-111111111111', 'RED8', '軽減税率', 'taxable', 8, true)
ON CONFLICT (id) DO NOTHING;

-- 顧客
INSERT INTO customers (id, tenant_id, code, name, kana_name)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'CUST001', '株式会社サンプル商事', 'カブシキガイシャサンプルショウジ')
ON CONFLICT (id) DO NOTHING;
