-- 固定資産・消費税申告・レポートモジュール動作確認用の追加シードデータ
-- (postgresスーパーユーザーで実行。RLSはバイパスされる)

-- fixed-assets.service.ts の勘定科目コード規約に対応する科目
INSERT INTO accounts (id, tenant_id, code, name, account_type, normal_balance)
VALUES ('88888888-8888-8888-8888-888888888891', '11111111-1111-1111-1111-111111111111', '1500', '工具器具備品', 'asset', 'debit')
ON CONFLICT (id) DO NOTHING;

INSERT INTO accounts (id, tenant_id, code, name, account_type, normal_balance)
VALUES ('88888888-8888-8888-8888-888888888892', '11111111-1111-1111-1111-111111111111', '1600', '減価償却累計額', 'asset', 'credit')
ON CONFLICT (id) DO NOTHING;

INSERT INTO accounts (id, tenant_id, code, name, account_type, normal_balance)
VALUES ('88888888-8888-8888-8888-888888888893', '11111111-1111-1111-1111-111111111111', '6000', '減価償却費', 'expense', 'debit')
ON CONFLICT (id) DO NOTHING;

INSERT INTO accounts (id, tenant_id, code, name, account_type, normal_balance)
VALUES ('88888888-8888-8888-8888-888888888894', '11111111-1111-1111-1111-111111111111', '9000', '固定資産売却益', 'revenue', 'credit')
ON CONFLICT (id) DO NOTHING;

INSERT INTO accounts (id, tenant_id, code, name, account_type, normal_balance)
VALUES ('88888888-8888-8888-8888-888888888895', '11111111-1111-1111-1111-111111111111', '9100', '固定資産除却損', 'expense', 'debit')
ON CONFLICT (id) DO NOTHING;

-- 会計年度・会計期間(2026-04-01〜2027-03-31、月次12期間)
INSERT INTO fiscal_years (id, tenant_id, start_date, end_date, status)
VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', '2026-04-01', '2027-03-31', 'open')
ON CONFLICT (id) DO NOTHING;

INSERT INTO fiscal_periods (id, tenant_id, fiscal_year_id, period_no, start_date, end_date, status)
VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01', '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 1, '2026-04-01', '2026-04-30', 'open'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02', '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 2, '2026-05-01', '2026-05-31', 'open'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03', '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 3, '2026-06-01', '2026-06-30', 'open'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee04', '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 4, '2026-07-01', '2026-07-31', 'open'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee05', '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 5, '2026-08-01', '2026-08-31', 'open'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeee06', '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 6, '2026-09-01', '2026-09-30', 'open')
ON CONFLICT (id) DO NOTHING;

-- 消費税申告テスト用: まとまった課税売上を確定仕訳として直接投入(標準税率10%, 課税標準100万円)
INSERT INTO journal_entries (id, tenant_id, entry_no, entry_date, description, status, source_type, created_by, posted_by, posted_at)
VALUES (
  'ffffffff-ffff-ffff-ffff-ffffffffff01', '11111111-1111-1111-1111-111111111111',
  'JE-SEED-TAX-0001', '2026-08-05', '消費税申告テスト用: 大口売上', 'posted', 'manual',
  '22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', now()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO journal_entry_lines (tenant_id, journal_entry_id, line_no, account_id, debit_credit, amount, tax_category_id)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-ffffffffff01', 1,
   '88888888-8888-8888-8888-888888888882', 'debit', 1100000, NULL),
  ('11111111-1111-1111-1111-111111111111', 'ffffffff-ffff-ffff-ffff-ffffffffff01', 2,
   '88888888-8888-8888-8888-888888888884', 'credit', 1000000, '99999999-9999-9999-9999-999999999991')
ON CONFLICT DO NOTHING;
