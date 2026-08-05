-- 仕入請求書・買掛金/支払バッチモジュール動作確認用の追加シードデータ(postgresスーパーユーザーで実行。RLSはバイパスされる)

-- vendor-bills.service.ts の勘定科目コード規約に対応する科目
INSERT INTO accounts (id, tenant_id, code, name, account_type, normal_balance)
VALUES ('88888888-8888-8888-8888-888888888885', '11111111-1111-1111-1111-111111111111', '2100', '買掛金', 'liability', 'credit')
ON CONFLICT (id) DO NOTHING;

INSERT INTO accounts (id, tenant_id, code, name, account_type, normal_balance)
VALUES ('88888888-8888-8888-8888-888888888886', '11111111-1111-1111-1111-111111111111', '2210', '仮払消費税', 'asset', 'debit')
ON CONFLICT (id) DO NOTHING;

-- 費用科目(仕入請求書明細用)
INSERT INTO accounts (id, tenant_id, code, name, account_type, normal_balance)
VALUES ('88888888-8888-8888-8888-888888888887', '11111111-1111-1111-1111-111111111111', '5100', '仕入高', 'expense', 'debit')
ON CONFLICT (id) DO NOTHING;

-- 自社の振込元銀行口座(全銀協FBデータのヘッダー(仕向銀行)情報に使用)
INSERT INTO bank_accounts (id, tenant_id, bank_name, bank_code, branch_name, branch_code, account_type, account_number, account_holder_kana, linked_account_id)
VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '11111111-1111-1111-1111-111111111111',
  'ミライ銀行', '0001', 'ホンテン', '001', 'ordinary', '1234567',
  'カ)ケイリカイケイ',
  '88888888-8888-8888-8888-888888888881'
)
ON CONFLICT DO NOTHING;

-- 仕入先(全銀FB振込先情報を含む)
INSERT INTO vendors (id, tenant_id, code, name, kana_name, bank_account_info)
VALUES (
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  '11111111-1111-1111-1111-111111111111',
  'VEND001', '株式会社テスト物産', 'カ)テストブッサン',
  '{"bank_name":"サンプル銀行","bank_code":"0009","branch_name":"エイギョウブ","branch_code":"101","account_type":"ordinary","account_number":"7654321","account_holder_kana":"カ)テストブッサン"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;
