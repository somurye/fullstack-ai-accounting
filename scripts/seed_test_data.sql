-- 動作確認用の最小シードデータ(postgresスーパーユーザーで実行。RLSはバイパスされる)
INSERT INTO tenants (id, name, legal_name)
VALUES ('11111111-1111-1111-1111-111111111111', 'Verify Tenant', 'Verify Tenant Co., Ltd.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, email, name)
VALUES ('22222222-2222-2222-2222-222222222222', 'verify-user@example.com', 'Verify User')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenant_users (tenant_id, user_id)
VALUES ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222')
ON CONFLICT DO NOTHING;

INSERT INTO accounts (id, tenant_id, code, name, account_type, normal_balance)
VALUES ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', '1000', '現金', 'asset', 'debit')
ON CONFLICT (id) DO NOTHING;

INSERT INTO accounts (id, tenant_id, code, name, account_type, normal_balance)
VALUES ('44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111', '5000', '旅費交通費', 'expense', 'debit')
ON CONFLICT (id) DO NOTHING;
