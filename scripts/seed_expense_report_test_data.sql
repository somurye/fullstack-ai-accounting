-- 経費精算モジュール動作確認用の追加シードデータ(postgresスーパーユーザーで実行。RLSはバイパスされる)

-- 支払方法別の貸方科目(expense-reports.service.ts の PAYMENT_METHOD_CREDIT_ACCOUNT_CODE 規約に対応)
INSERT INTO accounts (id, tenant_id, code, name, account_type, normal_balance)
VALUES ('55555555-5555-5555-5555-555555555551', '11111111-1111-1111-1111-111111111111', '2110', '未払金(法人カード)', 'liability', 'credit')
ON CONFLICT (id) DO NOTHING;

INSERT INTO accounts (id, tenant_id, code, name, account_type, normal_balance)
VALUES ('55555555-5555-5555-5555-555555555552', '11111111-1111-1111-1111-111111111111', '2120', '未払金(振込)', 'liability', 'credit')
ON CONFLICT (id) DO NOTHING;

INSERT INTO accounts (id, tenant_id, code, name, account_type, normal_balance)
VALUES ('55555555-5555-5555-5555-555555555553', '11111111-1111-1111-1111-111111111111', '2130', '未払金(従業員立替)', 'liability', 'credit')
ON CONFLICT (id) DO NOTHING;

-- 経費カテゴリ(借方=旅費交通費科目)
INSERT INTO expense_categories (id, tenant_id, code, name, default_account_id, requires_receipt)
VALUES ('66666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111', 'TRAVEL', '旅費交通費', '44444444-4444-4444-4444-444444444444', true)
ON CONFLICT (id) DO NOTHING;

-- 承認者ユーザー(申請者=Verify Userとは別ユーザー。自己承認禁止の検証に使用)
INSERT INTO users (id, email, name)
VALUES ('77777777-7777-7777-7777-777777777777', 'approver@example.com', 'Approver User')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenant_users (tenant_id, user_id)
VALUES ('11111111-1111-1111-1111-111111111111', '77777777-7777-7777-7777-777777777777')
ON CONFLICT DO NOTHING;
