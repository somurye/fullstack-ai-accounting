import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DatabaseService } from '../database/database.service';
import { hashPassword } from '../common/security/password';
import { AuthService } from '../modules/auth/auth.service';
import { SettingsService } from '../modules/settings/settings.service';
import { AccountsService } from '../modules/accounts/accounts.service';
import { TaxCategoriesService } from '../modules/tax-categories/tax-categories.service';
import { CustomersService } from '../modules/customers/customers.service';
import { VendorsService } from '../modules/vendors/vendors.service';
import { BankAccountsService } from '../modules/bank-accounts/bank-accounts.service';
import { BankTransactionsService } from '../modules/bank-transactions/bank-transactions.service';
import { ExpenseReportsService } from '../modules/expense-reports/expense-reports.service';
import { InvoicesService } from '../modules/invoices/invoices.service';
import { VendorBillsService } from '../modules/vendor-bills/vendor-bills.service';
import { PayrollImportMappingsService } from '../modules/payroll-import-mappings/payroll-import-mappings.service';
import { PayrollImportsService } from '../modules/payroll-imports/payroll-imports.service';
import { FixedAssetsService } from '../modules/fixed-assets/fixed-assets.service';
import { JournalEntriesService } from '../modules/journal-entries/journal-entries.service';
import { AiSuggestionsService } from '../modules/ai-suggestions/ai-suggestions.service';
import { ExternalAccessGrantsService } from '../modules/external-access-grants/external-access-grants.service';
import { ConsumptionTaxReturnsService } from '../modules/consumption-tax-returns/consumption-tax-returns.service';
import { ReportsService } from '../modules/reports/reports.service';

// ----------------------------------------------------------------------------
// .env loader (このプロジェクトにdotenv依存が無いため、最小限のパーサーを自前で用意する)
// ----------------------------------------------------------------------------
function loadEnvFile(): void {
  const envPath = path.resolve(__dirname, '../../.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
loadEnvFile();

// ----------------------------------------------------------------------------
// 決定論的疑似乱数(再現性のため固定シード)
// ----------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20250401);
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}
function chance(p: number): boolean {
  return rand() < p;
}

// スケール調整用(スモークテスト時に SIM_SCALE=0.1 等で母数を絞れる)
const SCALE = process.env.SIM_SCALE ? Number(process.env.SIM_SCALE) : 1;
const MONTH_LIMIT = process.env.SIM_MONTHS ? Number(process.env.SIM_MONTHS) : 12;
function scaled(n: number): number {
  return Math.max(1, Math.round(n * SCALE));
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  const json = Buffer.from(part, 'base64url').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function randomDateInMonth(year: number, month: number): string {
  return ymd(year, month, randInt(1, daysInMonth(year, month)));
}
function addDaysClamped(dateStr: string, days: number, maxDateStr: string): string | null {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const result = d.toISOString().slice(0, 10);
  return result <= maxDateStr ? result : null;
}

interface FiscalMonth {
  year: number;
  month: number;
  periodNo: number;
  startDate: string;
  endDate: string;
  label: string;
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  note: string;
}
function buildFiscalMonths(): FiscalMonth[] {
  const defs: { year: number; month: number; quarter: FiscalMonth['quarter']; note: string }[] = [
    { year: 2025, month: 4, quarter: 'Q1', note: '新年度好調(新規受注拡大)' },
    { year: 2025, month: 5, quarter: 'Q1', note: '新年度好調' },
    { year: 2025, month: 6, quarter: 'Q1', note: '新年度好調' },
    { year: 2025, month: 7, quarter: 'Q2', note: '閑散期+IT設備投資+夏季賞与' },
    { year: 2025, month: 8, quarter: 'Q2', note: '閑散期' },
    { year: 2025, month: 9, quarter: 'Q2', note: '閑散期' },
    { year: 2025, month: 10, quarter: 'Q3', note: '繁忙期(年末駆け込み前倒し)' },
    { year: 2025, month: 11, quarter: 'Q3', note: '繁忙期・外部監査対応月' },
    { year: 2025, month: 12, quarter: 'Q3', note: '繁忙期・大型納品+冬季賞与' },
    { year: 2026, month: 1, quarter: 'Q4', note: '為替・仕入価格高騰' },
    { year: 2026, month: 2, quarter: 'Q4', note: '為替・仕入価格高騰' },
    { year: 2026, month: 3, quarter: 'Q4', note: '決算調整月' },
  ];
  return defs.map((d, i) => ({
    year: d.year,
    month: d.month,
    periodNo: i + 1,
    startDate: ymd(d.year, d.month, 1),
    endDate: ymd(d.year, d.month, daysInMonth(d.year, d.month)),
    label: `${d.year}-${String(d.month).padStart(2, '0')}`,
    quarter: d.quarter,
    note: d.note,
  }));
}

// ----------------------------------------------------------------------------
// 経費カテゴリ別の定型フレーズ・金額レンジ(AI提案の類似度検索が効くよう、
// 同じ言い回しを繰り返し使用する)
// ----------------------------------------------------------------------------
const EXPENSE_CATEGORY_DEFS: { name: string; phrases: string[]; min: number; max: number }[] = [
  { name: '交通費', phrases: ['タクシー代(新宿-渋谷)', '電車代 出張', '高速道路料金', '駐車場代'], min: 800, max: 8000 },
  { name: '接待交際費', phrases: ['取引先接待 飲食代', 'お中元贈答品', '歓送迎会費用'], min: 5000, max: 35000 },
  { name: '備品費', phrases: ['文房具購入', 'PC周辺機器購入', '什器購入'], min: 1500, max: 45000 },
  { name: '会議費', phrases: ['会議用弁当代', '会議室レンタル料'], min: 1000, max: 12000 },
];
const PAYMENT_METHODS = ['cash', 'corporate_card', 'bank_transfer', 'employee_advance'] as const;
const EXPENSE_PURPOSES = ['出張旅費精算', '営業活動経費', '打合せ経費', '備品購入', '月次経費精算'];

interface SimUser {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'accounting_manager' | 'employee' | 'viewer_external';
}

interface ErrorRecord {
  phase: string;
  message: string;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const db = app.get(DatabaseService);
  const auth = app.get(AuthService);
  const settings = app.get(SettingsService);
  const accountsSvc = app.get(AccountsService);
  const taxCategoriesSvc = app.get(TaxCategoriesService);
  const customersSvc = app.get(CustomersService);
  const vendorsSvc = app.get(VendorsService);
  const bankAccountsSvc = app.get(BankAccountsService);
  const bankTransactionsSvc = app.get(BankTransactionsService);
  const expenseReportsSvc = app.get(ExpenseReportsService);
  const invoicesSvc = app.get(InvoicesService);
  const vendorBillsSvc = app.get(VendorBillsService);
  const payrollMappingsSvc = app.get(PayrollImportMappingsService);
  const payrollImportsSvc = app.get(PayrollImportsService);
  const fixedAssetsSvc = app.get(FixedAssetsService);
  const journalEntriesSvc = app.get(JournalEntriesService);
  const aiSuggestionsSvc = app.get(AiSuggestionsService);
  const externalAccessSvc = app.get(ExternalAccessGrantsService);
  const consumptionTaxSvc = app.get(ConsumptionTaxReturnsService);
  const reportsSvc = app.get(ReportsService);

  const errors: ErrorRecord[] = [];
  function recordError(phase: string, e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    errors.push({ phase, message });
  }

  const stats = {
    expenseReportsCreated: 0,
    expenseReportsApproved: 0,
    expenseReportsRejected: 0,
    aiSuggestionsGenerated: 0,
    aiSuggestionsAccepted: 0,
    aiSuggestionsRejected: 0,
    invoicesIssued: 0,
    invoicesVoided: 0,
    invoicesFullyPaid: 0,
    invoicesPartiallyPaid: 0,
    vendorBillsSubmitted: 0,
    vendorBillsPaidViaBankMatch: 0,
    payrollRuns: 0,
    depreciationRuns: 0,
  };

  console.log('=== フェーズ1: テナント・オーナー作成(signup) ===');
  const ownerEmail = 'owner1@sim.example.jp';
  const tenantName = '100人規模シミュレーション株式会社';
  const signupResult = await auth.signup({
    email: ownerEmail,
    password: 'Owner!Passw0rd2025',
    name: '代表 太郎',
    tenant_name: tenantName,
  });
  // `users`テーブルはRLS(FORCE)で `id = fn_current_user_id()`(自分自身の行のみ)または
  // 所属テナント経由でのみ閲覧可能なため、テナント/ユーザーコンテキスト無しの
  // `db.query()`エスケープハッチでは0件になる(RLSのfail-closed設計通り)。
  // signup()が返すJWT(access_token)自体にsub(userId)/tenant_idが載っているため、
  // 追加のDB問い合わせをせずデコードして取得する。
  const tenantId = signupResult.tenants[0].tenant_id;
  const jwtPayload = decodeJwtPayload(signupResult.access_token as string);
  const owner1Id = jwtPayload.sub as string;
  console.log(`  tenantId=${tenantId} owner1Id=${owner1Id}`);

  await settings.updateTenant(tenantId, owner1Id, {
    name: tenantName,
    legal_name: `株式会社100人規模シミュレーション`,
    representative_name: '代表 太郎',
    address: '東京都千代田区大手町一丁目1番1号',
    fiscal_year_start_month: 4,
    invoice_registration_number: 'T1234567890123',
    consumption_tax_filing_method: 'twenty_percent_special',
    base_currency_code: 'JPY',
  });

  console.log('=== フェーズ2: 会計年度・会計期間の作成 ===');
  const fiscalYearId = randomUUID();
  const months = buildFiscalMonths().slice(0, MONTH_LIMIT);
  const periodIdByNo = new Map<number, string>();
  await db.transaction(tenantId, owner1Id, async (client) => {
    await client.query(
      `INSERT INTO fiscal_years (id, tenant_id, start_date, end_date, status) VALUES ($1,$2,$3,$4,'open')`,
      [fiscalYearId, tenantId, '2025-04-01', '2026-03-31'],
    );
    for (const m of buildFiscalMonths()) {
      const periodId = randomUUID();
      await client.query(
        `INSERT INTO fiscal_periods (id, tenant_id, fiscal_year_id, period_no, start_date, end_date, status)
         VALUES ($1,$2,$3,$4,$5,$6,'open')`,
        [periodId, tenantId, fiscalYearId, m.periodNo, m.startDate, m.endDate],
      );
      periodIdByNo.set(m.periodNo, periodId);
    }
  });

  console.log('=== フェーズ3: ロール一覧取得 ===');
  const roleRows = await db.query<{ id: string; code: string }>(`SELECT id, code FROM roles`);
  const roleIdByCode = new Map(roleRows.rows.map((r) => [r.code, r.id]));

  console.log('=== フェーズ4: 100名分のユーザー作成 ===');
  const users: SimUser[] = [{ id: owner1Id, email: ownerEmail, name: '代表 太郎', role: 'owner' }];
  const departments = ['営業部', '開発部', '総務部', 'マーケティング部'];
  // `users`テーブルのRLS WITH CHECKは `id = fn_current_user_id()`(自己registration専用の設計、
  // `auth.signup()`/`auth.acceptInvite()` と同じ制約)のため、管理者(owner1)のコンテキストのまま
  // 他人のusers行をINSERTすることはできない。新規ユーザーごとに、そのユーザー自身のidを
  // RLSコンテキストのuserIdとして設定したトランザクションでINSERTする
  // (tenant_users/user_rolesは`tenant_id = fn_current_tenant_id()`のみが条件のため、
  //  同一トランザクション内でまとめて書き込める)。
  const addUser = async (
    name: string,
    email: string,
    roleCode: SimUser['role'],
    employeeCode: string,
    department: string,
  ): Promise<void> => {
    const id = randomUUID();
    const passwordHash = hashPassword('SimPass!2025');
    const roleId = roleIdByCode.get(roleCode);
    await db.transaction(tenantId, id, async (client) => {
      await client.query(`INSERT INTO users (id, email, name, password_hash) VALUES ($1,$2,$3,$4)`, [
        id,
        email,
        name,
        passwordHash,
      ]);
      await client.query(
        `INSERT INTO tenant_users (tenant_id, user_id, employee_code, department) VALUES ($1,$2,$3,$4)`,
        [tenantId, id, employeeCode, department],
      );
      await client.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_id, granted_by) VALUES ($1,$2,$3,$4)`,
        [tenantId, id, roleId, owner1Id],
      );
    });
    users.push({ id, email, name, role: roleCode });
  };

  for (let i = 2; i <= 3; i++) {
    await addUser(`役員${i}`, `owner${i}@sim.example.jp`, 'owner', `E${String(i).padStart(3, '0')}`, '役員');
  }
  for (let i = 1; i <= 4; i++) {
    await addUser(
      `経理担当${i}`,
      `mgr${i}@sim.example.jp`,
      'accounting_manager',
      `M${String(i).padStart(3, '0')}`,
      '経理部',
    );
  }
  await mapPool(
    Array.from({ length: 93 }, (_, idx) => idx + 1),
    8,
    (i) =>
      addUser(
        `社員${String(i).padStart(3, '0')}`,
        `emp${String(i).padStart(3, '0')}@sim.example.jp`,
        'employee',
        `S${String(i).padStart(3, '0')}`,
        departments[i % departments.length],
      ),
  );
  await addUser(
    '外部監査担当(税理士法人)',
    'auditor@sim-tax-firm.example.jp',
    'viewer_external',
    'AUD001',
    '社外',
  );

  const owners = users.filter((u) => u.role === 'owner');
  const managers = users.filter((u) => u.role === 'accounting_manager');
  const employees = users.filter((u) => u.role === 'employee');
  const auditorUser = users.find((u) => u.role === 'viewer_external')!;
  const allStaff = [...owners, ...managers, ...employees];
  console.log(
    `  users total=${users.length} (owner=${owners.length} manager=${managers.length} employee=${employees.length} auditor=1)`,
  );

  console.log('=== フェーズ5: 勘定科目マスタ作成 ===');
  const acctId: Record<string, string> = {};
  const acctDefs: { code: string; name: string; type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'; normal: 'debit' | 'credit' }[] = [
    { code: '1000', name: '現金', type: 'asset', normal: 'debit' },
    { code: '1100', name: '普通預金', type: 'asset', normal: 'debit' },
    { code: '1200', name: '売掛金', type: 'asset', normal: 'debit' },
    { code: '1250', name: '貸倒引当金', type: 'asset', normal: 'credit' },
    { code: '1600', name: '減価償却累計額', type: 'asset', normal: 'credit' },
    { code: '1700', name: '器具備品', type: 'asset', normal: 'debit' },
    { code: '2100', name: '買掛金', type: 'liability', normal: 'credit' },
    { code: '2110', name: '未払金(法人カード)', type: 'liability', normal: 'credit' },
    { code: '2120', name: '未払金(振込)', type: 'liability', normal: 'credit' },
    { code: '2130', name: '未払金(従業員立替)', type: 'liability', normal: 'credit' },
    { code: '2140', name: '未払法定福利費', type: 'liability', normal: 'credit' },
    { code: '2150', name: '源泉所得税預り金', type: 'liability', normal: 'credit' },
    { code: '2160', name: '住民税預り金', type: 'liability', normal: 'credit' },
    { code: '2170', name: '社会保険料預り金', type: 'liability', normal: 'credit' },
    { code: '2200', name: '仮受消費税', type: 'liability', normal: 'credit' },
    { code: '2210', name: '仮払消費税', type: 'asset', normal: 'debit' },
    { code: '2300', name: '未払法人税等', type: 'liability', normal: 'credit' },
    { code: '3000', name: '資本金', type: 'equity', normal: 'credit' },
    { code: '4000', name: '売上高', type: 'revenue', normal: 'credit' },
    { code: '5000', name: '旅費交通費', type: 'expense', normal: 'debit' },
    { code: '5010', name: '接待交際費', type: 'expense', normal: 'debit' },
    { code: '5020', name: '消耗品費', type: 'expense', normal: 'debit' },
    { code: '5030', name: '会議費', type: 'expense', normal: 'debit' },
    { code: '5040', name: '雑費', type: 'expense', normal: 'debit' },
    { code: '5100', name: '外注費', type: 'expense', normal: 'debit' },
    { code: '5110', name: '地代家賃', type: 'expense', normal: 'debit' },
    { code: '5120', name: '水道光熱費', type: 'expense', normal: 'debit' },
    { code: '5200', name: '役員報酬', type: 'expense', normal: 'debit' },
    { code: '5210', name: '給料手当', type: 'expense', normal: 'debit' },
    { code: '5220', name: '法定福利費', type: 'expense', normal: 'debit' },
    { code: '5300', name: '減価償却費', type: 'expense', normal: 'debit' },
    { code: '5400', name: '貸倒引当金繰入額', type: 'expense', normal: 'debit' },
    { code: '5500', name: '法人税、住民税及び事業税', type: 'expense', normal: 'debit' },
  ];
  for (const def of acctDefs) {
    const created = await accountsSvc.create(tenantId, owner1Id, {
      code: def.code,
      name: def.name,
      account_type: def.type,
      normal_balance: def.normal,
      allow_manual_entry: true,
    });
    acctId[def.code] = created.id as string;
  }

  console.log('=== フェーズ6: 税区分マスタ作成 ===');
  const tax10 = await taxCategoriesSvc.create(tenantId, owner1Id, {
    code: 'TAX10',
    name: '標準税率10%',
    tax_type: 'taxable',
    tax_rate: 10,
    is_reduced_rate: false,
  });
  const tax10Id = tax10.id as string;

  console.log('=== フェーズ7: 経費カテゴリマスタ作成 ===');
  const expenseCategoryId: Record<string, string> = {};
  await db.transaction(tenantId, owner1Id, async (client) => {
    const defs: { name: string; code: string; accountCode: string }[] = [
      { name: '交通費', code: 'EXP-TRAVEL', accountCode: '5000' },
      { name: '接待交際費', code: 'EXP-ENTERTAIN', accountCode: '5010' },
      { name: '備品費', code: 'EXP-SUPPLIES', accountCode: '5020' },
      { name: '会議費', code: 'EXP-MEETING', accountCode: '5030' },
      { name: 'その他', code: 'EXP-MISC', accountCode: '5040' },
    ];
    for (const d of defs) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO expense_categories (id, tenant_id, code, name, default_account_id, requires_receipt)
         VALUES ($1,$2,$3,$4,$5, TRUE)`,
        [id, tenantId, d.code, d.name, acctId[d.accountCode]],
      );
      expenseCategoryId[d.name] = id;
    }
  });

  console.log('=== フェーズ8: 取引先・銀行口座マスタ作成 ===');
  const customerIds: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const c = await customersSvc.create(tenantId, owner1Id, {
      code: `CUST${String(i).padStart(3, '0')}`,
      name: `得意先${i}株式会社`,
    });
    customerIds.push(c.id as string);
  }
  const vendorOutsourcing = await vendorsSvc.create(tenantId, owner1Id, {
    code: 'VEND001',
    name: '外注先パートナー株式会社',
  });
  const vendorLandlord = await vendorsSvc.create(tenantId, owner1Id, {
    code: 'VEND002',
    name: '不動産管理株式会社',
  });
  const vendorUtility = await vendorsSvc.create(tenantId, owner1Id, {
    code: 'VEND003',
    name: '関東電力株式会社',
  });
  const vendorSupplier = await vendorsSvc.create(tenantId, owner1Id, {
    code: 'VEND004',
    name: 'オフィスサプライ株式会社',
  });
  const vendorEquipment = await vendorsSvc.create(tenantId, owner1Id, {
    code: 'VEND005',
    name: 'ITハードウェア商事株式会社',
  });
  const bankAccount = await bankAccountsSvc.create(tenantId, owner1Id, {
    bank_name: 'みずほ銀行',
    branch_name: '東京営業部',
    account_type: 'ordinary',
    account_number: '1234567',
    currency_code: 'JPY',
    opening_balance: 0,
    linked_account_id: acctId['1100'],
  });
  const bankAccountId = bankAccount.id as string;

  console.log('=== フェーズ9: 承認ルール(経費精算)作成 ===');
  await db.transaction(tenantId, owner1Id, async (client) => {
    await client.query(
      `INSERT INTO approval_rules (tenant_id, target_type, step_number, condition, approver_role_id, is_active)
       VALUES ($1, 'expense_report', 1, '{}'::jsonb, $2, TRUE)`,
      [tenantId, roleIdByCode.get('accounting_manager')],
    );
  });

  console.log('=== フェーズ10: 給与CSV取込マッピング作成 ===');
  const payrollMapping = await payrollMappingsSvc.create(tenantId, owner1Id, {
    name: '標準給与マッピング',
    column_mapping: {
      employee_name: 'employee_name',
      employee_code: 'employee_code',
      executive_compensation_amount: 'executive_compensation',
      salary_amount: 'salary',
      withholding_tax_amount: 'withholding_tax',
      resident_tax_amount: 'resident_tax',
      social_insurance_employee_amount: 'social_insurance_employee',
      social_insurance_company_amount: 'social_insurance_company',
      net_payment_amount: 'net_payment',
    },
    account_mapping: {
      executive_compensation_account_id: acctId['5200'],
      salary_account_id: acctId['5210'],
      social_insurance_company_expense_account_id: acctId['5220'],
      withholding_tax_account_id: acctId['2150'],
      resident_tax_account_id: acctId['2160'],
      social_insurance_employee_account_id: acctId['2170'],
      social_insurance_company_payable_account_id: acctId['2140'],
      net_payment_account_id: acctId['1100'],
    },
    is_active: true,
  });
  const payrollMappingId = payrollMapping.id as string;

  console.log('=== フェーズ11: 資本金払込仕訳 ===');
  {
    const je = await journalEntriesSvc.create(tenantId, owner1Id, {
      entry_date: '2025-04-01',
      description: '資本金払込',
      currency_code: 'JPY',
      exchange_rate: 1,
      lines: [
        { account_id: acctId['1100'], debit_credit: 'debit', amount: 30_000_000 },
        { account_id: acctId['3000'], debit_credit: 'credit', amount: 30_000_000 },
      ],
    });
    await journalEntriesSvc.post(tenantId, owner1Id, je.id as string);
  }

  // 給与プロファイル(従業員ごとに月額基本給を固定して持たせる。7月・12月は賞与を加算する)
  const payrollProfile = new Map<string, { isExecutive: boolean; base: number }>();
  for (const u of owners) payrollProfile.set(u.id, { isExecutive: true, base: randInt(800_000, 1_200_000) });
  for (const u of [...managers, ...employees]) {
    payrollProfile.set(u.id, { isExecutive: false, base: randInt(280_000, 480_000) });
  }

  function buildExpenseLine(): {
    expense_date: string;
    category_id: string;
    description: string;
    amount: number;
    payment_method: (typeof PAYMENT_METHODS)[number];
    tax_category_id: string;
  } {
    const misclassify = chance(0.32);
    const trueCategory = pick(EXPENSE_CATEGORY_DEFS);
    const categoryName = misclassify ? 'その他' : trueCategory.name;
    return {
      expense_date: '', // 呼び出し側で月内日付を設定する
      category_id: expenseCategoryId[categoryName],
      description: pick(trueCategory.phrases),
      amount: randInt(trueCategory.min, trueCategory.max),
      payment_method: pick(PAYMENT_METHODS),
      tax_category_id: tax10Id,
    };
  }

  function buildPayrollCsv(rows: {
    name: string;
    code: string;
    exec: number;
    salary: number;
    wh: number;
    resident: number;
    siEmp: number;
    siComp: number;
    net: number;
  }[]): Buffer {
    const header =
      'employee_name,employee_code,executive_compensation,salary,withholding_tax,resident_tax,social_insurance_employee,social_insurance_company,net_payment';
    const lines = rows.map((r) =>
      [r.name, r.code, r.exec, r.salary, r.wh, r.resident, r.siEmp, r.siComp, r.net].join(','),
    );
    return Buffer.from([header, ...lines].join('\n'), 'utf8');
  }

  function buildBankCsv(rows: { date: string; description: string; amount: number }[]): Buffer {
    const header = 'date,description,amount';
    const lines = rows.map((r) => `${r.date},${r.description},${r.amount}`);
    return Buffer.from([header, ...lines].join('\n'), 'utf8');
  }

  const monthlyPlSummaries: {
    label: string;
    quarter: string;
    note: string;
    revenue: number;
    expense: number;
    netIncome: number;
  }[] = [];

  console.log('=== フェーズ12: 月次トランザクション生成ループ開始 ===');
  for (const m of months) {
    const monthT0 = Date.now();
    console.log(`--- ${m.label} (${m.quarter}: ${m.note}) 開始 ---`);

    // 収益・費用の季節変動パラメータ
    const revenueBoost = m.quarter === 'Q1' ? 1.1 : m.quarter === 'Q2' ? 0.55 : m.quarter === 'Q3' ? 1.5 : 0.85;
    const costBoost = m.quarter === 'Q4' ? 1.3 : 1.0;
    const isBonusMonth = m.month === 7 || m.month === 12;

    // ------------------------------------------------------------------
    // (1) 経費申請(月約150〜200件、うち約5%却下、AI提案からの一部修正含む)
    // ------------------------------------------------------------------
    const reportCount = scaled(randInt(150, 200));
    await mapPool(
      Array.from({ length: reportCount }),
      6,
      async () => {
        const submitter = pick(allStaff);
        const lineCount = randInt(1, 3);
        const lines = Array.from({ length: lineCount }, () => {
          const line = buildExpenseLine();
          line.expense_date = randomDateInMonth(m.year, m.month);
          return line;
        });
        try {
          const created = await expenseReportsSvc.create(tenantId, submitter.id, {
            on_behalf_of: submitter.id,
            purpose: pick(EXPENSE_PURPOSES),
            lines,
          });
          stats.expenseReportsCreated++;

          for (const line of created.lines ?? []) {
            try {
              const { suggestions } = await aiSuggestionsSvc.list(tenantId, submitter.id, {
                page: 1,
                page_size: 5,
                target_type: 'expense_report_line',
                target_id: line.id as string,
              });
              const suggestion = suggestions[0];
              if (suggestion) {
                stats.aiSuggestionsGenerated++;
                if (chance(0.85)) {
                  await aiSuggestionsSvc.accept(tenantId, submitter.id, suggestion.id as string);
                  stats.aiSuggestionsAccepted++;
                } else {
                  await aiSuggestionsSvc.reject(tenantId, submitter.id, suggestion.id as string, {
                    reason: '内容確認済みのため現状カテゴリを維持',
                  });
                  stats.aiSuggestionsRejected++;
                }
              }
            } catch (e) {
              recordError(`${m.label}:ai-suggestion`, e);
            }
          }

          const candidateApprovers = managers.filter((mgr) => mgr.id !== submitter.id);
          const approver = candidateApprovers.length > 0 ? pick(candidateApprovers) : managers[0];
          if (chance(0.05)) {
            await expenseReportsSvc.reject(tenantId, approver.id, created.id as string, {
              comment: '領収書不備のため差し戻します。再提出をお願いします。',
            });
            stats.expenseReportsRejected++;
          } else {
            await expenseReportsSvc.approve(tenantId, approver.id, created.id as string, {});
            stats.expenseReportsApproved++;
          }
        } catch (e) {
          recordError(`${m.label}:expense_report`, e);
        }
      },
    );

    // ------------------------------------------------------------------
    // (2) 売上請求書発行(月約30〜50件、季節変動あり)+ 24時間以内Void + 入金消込
    // ------------------------------------------------------------------
    const invoiceCount = scaled(Math.max(5, Math.round(randInt(30, 50) * revenueBoost)));
    const issuedInvoices: { id: string; totalAmount: number; issueDate: string }[] = [];
    let voidedThisMonth = 0;
    for (let i = 0; i < invoiceCount; i++) {
      try {
        const issueDate = randomDateInMonth(m.year, m.month);
        const dueDate = addDaysClamped(issueDate, 30, '2026-03-31') ?? issueDate;
        const lineCount = randInt(1, 3);
        const lines = Array.from({ length: lineCount }, () => ({
          description: `商品・サービス提供 ${m.label}`,
          quantity: randInt(1, 5),
          unit_price: Math.round((randInt(30_000, 250_000) * revenueBoost) / 100) * 100,
          tax_category_id: tax10Id,
          account_id: acctId['4000'],
        }));
        const invoice = await invoicesSvc.create(tenantId, owner1Id, {
          customer_id: pick(customerIds),
          issue_date: issueDate,
          due_date: dueDate,
          currency_code: 'JPY',
          lines,
        });
        const issued = await invoicesSvc.issue(tenantId, owner1Id, invoice.id as string);
        stats.invoicesIssued++;

        // 年間数件、発行直後に記載ミスが発覚しVoid→再発行するシナリオ
        if (voidedThisMonth < 1 && chance(0.06)) {
          await invoicesSvc.voidInvoice(tenantId, owner1Id, invoice.id as string);
          stats.invoicesVoided++;
          voidedThisMonth++;
          const corrected = await invoicesSvc.create(tenantId, owner1Id, {
            customer_id: pick(customerIds),
            issue_date: issueDate,
            due_date: dueDate,
            currency_code: 'JPY',
            lines,
          });
          const correctedIssued = await invoicesSvc.issue(tenantId, owner1Id, corrected.id as string);
          stats.invoicesIssued++;
          issuedInvoices.push({
            id: corrected.id as string,
            totalAmount: Number(correctedIssued.total_amount ?? 0),
            issueDate,
          });
          continue;
        }

        issuedInvoices.push({ id: invoice.id as string, totalAmount: Number(issued.total_amount ?? 0), issueDate });
      } catch (e) {
        recordError(`${m.label}:invoice`, e);
      }
    }

    for (const inv of issuedInvoices) {
      try {
        if (chance(0.15)) continue; // 未入金のまま(滞留)
        const isPartial = chance(0.2);
        const payDate = addDaysClamped(inv.issueDate, randInt(5, 30), '2026-03-31');
        if (!payDate) continue;
        const amount = isPartial ? Math.round(inv.totalAmount * (0.4 + rand() * 0.4)) : inv.totalAmount;
        if (amount <= 0) continue;
        await invoicesSvc.recordPayment(tenantId, owner1Id, inv.id, { payment_date: payDate, amount });
        if (isPartial) stats.invoicesPartiallyPaid++;
        else stats.invoicesFullyPaid++;
      } catch (e) {
        recordError(`${m.label}:invoice_payment`, e);
      }
    }

    // ------------------------------------------------------------------
    // (3) 仕入請求書(月約40〜60件、為替高騰月は金額増) + 銀行明細CSV取込・消込
    // ------------------------------------------------------------------
    const billCount = scaled(randInt(40, 60));
    const vendorPool = [vendorOutsourcing, vendorLandlord, vendorUtility, vendorSupplier];
    const approvedBills: { id: string; billNo: string; vendorName: string; totalAmount: number; billDate: string }[] = [];
    for (let i = 0; i < billCount; i++) {
      try {
        const billDate = randomDateInMonth(m.year, m.month);
        const dueDate = addDaysClamped(billDate, 30, '2026-03-31') ?? billDate;
        const vendor = pick(vendorPool);
        const accountCode = vendor === vendorLandlord ? '5110' : vendor === vendorUtility ? '5120' : '5100';
        const baseAmount = randInt(30_000, 200_000) * costBoost;
        const amount = Math.round(baseAmount / 100) * 100;
        const bill = await vendorBillsSvc.create(tenantId, owner1Id, {
          vendor_id: vendor.id as string,
          bill_date: billDate,
          due_date: dueDate,
          payment_method: 'bank_transfer',
          lines: [
            {
              description: `${vendor.name} 請求(${m.label})`,
              amount,
              tax_category_id: tax10Id,
              account_id: acctId[accountCode],
            },
          ],
        });
        const submitted = await vendorBillsSvc.submit(tenantId, owner1Id, bill.id as string);
        stats.vendorBillsSubmitted++;
        if (submitted.status === 'approved') {
          approvedBills.push({
            id: bill.id as string,
            billNo: submitted.bill_no as string,
            vendorName: vendor.name as string,
            totalAmount: Number(submitted.total_amount ?? 0),
            billDate,
          });
        }
      } catch (e) {
        recordError(`${m.label}:vendor_bill`, e);
      }
    }

    if (approvedBills.length > 0) {
      try {
        const payDate = ymd(m.year, m.month, Math.min(28, daysInMonth(m.year, m.month)));
        const csvRows = approvedBills
          .filter(() => chance(0.85))
          .map((b, idx) => ({
            date: payDate,
            description: `${b.vendorName} 支払 ${b.billNo}-${idx}`,
            amount: -b.totalAmount,
          }));
        if (csvRows.length > 0) {
          const csv = buildBankCsv(csvRows);
          const importResult = await bankTransactionsSvc.importCsv(
            tenantId,
            owner1Id,
            { originalname: `bank_${m.label}.csv`, mimetype: 'text/csv', buffer: csv, size: csv.length },
            { bank_account_id: bankAccountId },
          );
          const matchedBillIds = new Set<string>();
          for (let i = 0; i < importResult.transactions.length && i < approvedBills.length; i++) {
            const tx = importResult.transactions[i];
            if (tx.match_status !== 'unmatched') continue;
            const bill = approvedBills[i];
            if (matchedBillIds.has(bill.id)) continue;
            try {
              await bankTransactionsSvc.match(tenantId, owner1Id, tx.id as string, {
                target_type: 'vendor_bill',
                target_id: bill.id,
              });
              matchedBillIds.add(bill.id);
              stats.vendorBillsPaidViaBankMatch++;
            } catch (e) {
              recordError(`${m.label}:bank_match_vendor_bill`, e);
            }
          }
        }
      } catch (e) {
        recordError(`${m.label}:bank_csv_import`, e);
      }
    }

    // ------------------------------------------------------------------
    // (4) 毎月25日の給与連携(役員報酬・給料手当・社会保険料・源泉所得税)
    // ------------------------------------------------------------------
    try {
      const payPeriodStart = ymd(m.year, m.month, 1);
      const payPeriodEnd = ymd(m.year, m.month, daysInMonth(m.year, m.month));
      const paymentDate = ymd(m.year, m.month, 25);
      const rows = allStaff.map((u) => {
        const profile = payrollProfile.get(u.id)!;
        const bonus = isBonusMonth ? profile.base : 0;
        const gross = profile.base + bonus;
        const exec = profile.isExecutive ? gross : 0;
        const salary = profile.isExecutive ? 0 : gross;
        const wh = Math.round((exec + salary) * 0.1);
        const resident = 15_000;
        const siEmp = Math.round((exec + salary) * 0.145);
        const siComp = Math.round((exec + salary) * 0.145);
        const net = exec + salary - wh - resident - siEmp;
        return {
          name: u.name,
          code: u.email.split('@')[0],
          exec,
          salary,
          wh,
          resident,
          siEmp,
          siComp,
          net,
        };
      });
      const csv = buildPayrollCsv(rows);
      const imported = await payrollImportsSvc.importCsv(
        tenantId,
        owner1Id,
        { originalname: `payroll_${m.label}.csv`, mimetype: 'text/csv', buffer: csv, size: csv.length },
        {
          import_mapping_id: payrollMappingId,
          pay_period_start: payPeriodStart,
          pay_period_end: payPeriodEnd,
          payment_date: paymentDate,
        },
      );
      const managerForPost = managers[0];
      await payrollImportsSvc.post(tenantId, managerForPost.id, imported.id as string);
      stats.payrollRuns++;
    } catch (e) {
      recordError(`${m.label}:payroll`, e);
    }

    // ------------------------------------------------------------------
    // (5) 固定資産(7月取得)+ 月次減価償却(取得月以降、毎月)
    // ------------------------------------------------------------------
    if (m.year === 2025 && m.month === 7) {
      try {
        const assetDefs = [
          { name: 'デスクトップPC 50台一括導入', cost: 6_000_000 },
          { name: 'ノートPC 30台一括導入', cost: 3_600_000 },
          { name: 'サーバー機器一式', cost: 2_400_000 },
        ];
        for (const a of assetDefs) {
          await fixedAssetsSvc.create(tenantId, owner1Id, {
            name: a.name,
            category: 'IT機器',
            acquisition_date: '2025-07-10',
            acquisition_cost: a.cost,
            useful_life_years: 4,
            depreciation_method: 'straight_line',
            salvage_value: 0,
            asset_account_id: acctId['1700'],
            depreciation_expense_account_id: acctId['5300'],
          });
        }
      } catch (e) {
        recordError(`${m.label}:fixed_asset_create`, e);
      }
    }
    if (m.year > 2025 || (m.year === 2025 && m.month >= 7)) {
      try {
        const periodId = periodIdByNo.get(m.periodNo)!;
        const result = await fixedAssetsSvc.runDepreciation(tenantId, owner1Id, { fiscal_period_id: periodId });
        if (result.processedCount > 0) stats.depreciationRuns++;
      } catch (e) {
        recordError(`${m.label}:depreciation`, e);
      }
    }

    // ------------------------------------------------------------------
    // (6) 外部監査(11月): 時限アクセス発行 + RLS制限読み取り検証
    // ------------------------------------------------------------------
    if (m.year === 2025 && m.month === 11) {
      console.log('  -- 外部監査シミュレーション(税理士法人への時限アクセス発行) --');
      try {
        const now = new Date();
        const validFrom = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
        const validUntil = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
        await externalAccessSvc.create(tenantId, owner1Id, {
          user_id: auditorUser.id,
          valid_from: validFrom,
          valid_until: validUntil,
          can_export: false,
        });

        const auditTb = await db.transactionAsRole(
          'app_readonly_external',
          tenantId,
          auditorUser.id,
          async (client) => {
            const tb = await client.query(`SELECT COUNT(*)::int AS c FROM journal_entries WHERE tenant_id = $1`, [
              tenantId,
            ]);
            const logs = await client.query(`SELECT COUNT(*)::int AS c FROM audit_logs WHERE tenant_id = $1`, [
              tenantId,
            ]);
            return { journalEntries: tb.rows[0].c, auditLogs: logs.rows[0].c };
          },
        );
        console.log(
          `  監査人ロールでの読み取り成功: journal_entries=${auditTb.journalEntries}件, audit_logs=${auditTb.auditLogs}件`,
        );

        let writeBlocked = false;
        try {
          await db.transactionAsRole('app_readonly_external', tenantId, auditorUser.id, async (client) => {
            await client.query(`UPDATE journal_entries SET description = 'tampered' WHERE tenant_id = $1`, [
              tenantId,
            ]);
          });
        } catch {
          writeBlocked = true;
        }
        console.log(
          `  監査人ロールでの書き込み試行: ${writeBlocked ? '拒否(想定通り)' : '★成功してしまった(要調査)'}`,
        );
        if (!writeBlocked) {
          errors.push({
            phase: 'external_audit',
            message: 'app_readonly_externalロールがjournal_entriesへのUPDATEを実行できてしまった',
          });
        }
      } catch (e) {
        recordError(`${m.label}:external_audit`, e);
      }
    }

    // 当月PLサマリー取得(検証・レポート用)
    try {
      const pl = await reportsSvc.profitAndLoss(tenantId, owner1Id, { date_from: m.startDate, date_to: m.endDate });
      const revenueLine = pl.lines.find((l) => l.account_name === '売上高合計');
      const expenseLine = pl.lines.find((l) => l.account_name === '費用合計');
      const netIncomeLine = pl.lines.find((l) => l.account_name === '当期純利益');
      monthlyPlSummaries.push({
        label: m.label,
        quarter: m.quarter,
        note: m.note,
        revenue: revenueLine?.amount ?? 0,
        expense: expenseLine?.amount ?? 0,
        netIncome: netIncomeLine?.amount ?? 0,
      });
    } catch (e) {
      recordError(`${m.label}:monthly_pl`, e);
    }

    console.log(`--- ${m.label} 完了 (${((Date.now() - monthT0) / 1000).toFixed(1)}秒) ---`);
  }

  // --------------------------------------------------------------------
  // フェーズ13: 決算整理(3月): 貸倒引当金・法人税等の見積計上、消費税申告データ計算
  // --------------------------------------------------------------------
  console.log('=== フェーズ13: 決算整理仕訳(3月末) ===');
  try {
    const tbAsOfYearEnd = await reportsSvc.trialBalance(tenantId, owner1Id, { date_to: '2026-03-31' });
    const arLine = tbAsOfYearEnd.find((l) => l.account_code === '1200');
    const arBalance = arLine?.closing_balance ?? 0;
    const allowanceAmount = Math.round(arBalance * 0.02);
    if (allowanceAmount > 0) {
      const je = await journalEntriesSvc.create(tenantId, owner1Id, {
        entry_date: '2026-03-31',
        description: '貸倒引当金繰入(期末売掛金残高の2%見積計上)',
        currency_code: 'JPY',
        exchange_rate: 1,
        lines: [
          { account_id: acctId['5400'], debit_credit: 'debit', amount: allowanceAmount },
          { account_id: acctId['1250'], debit_credit: 'credit', amount: allowanceAmount },
        ],
      });
      await journalEntriesSvc.post(tenantId, owner1Id, je.id as string);
      console.log(`  貸倒引当金繰入: ${allowanceAmount}円`);
    }

    const plToDate = await reportsSvc.profitAndLoss(tenantId, owner1Id, {
      date_from: '2025-04-01',
      date_to: '2026-03-31',
    });
    const netIncomeSoFar = plToDate.lines.find((l) => l.account_name === '当期純利益')?.amount ?? 0;
    const taxProvision = Math.max(0, Math.round(netIncomeSoFar * 0.3));
    if (taxProvision > 0) {
      const je = await journalEntriesSvc.create(tenantId, owner1Id, {
        entry_date: '2026-03-31',
        description: '未払法人税等の計上(概算実効税率30%)',
        currency_code: 'JPY',
        exchange_rate: 1,
        lines: [
          { account_id: acctId['5500'], debit_credit: 'debit', amount: taxProvision },
          { account_id: acctId['2300'], debit_credit: 'credit', amount: taxProvision },
        ],
      });
      await journalEntriesSvc.post(tenantId, owner1Id, je.id as string);
      console.log(`  未払法人税等: ${taxProvision}円(税引前当期純利益 ${netIncomeSoFar}円の概算30%)`);
    }

    const taxReturn = await consumptionTaxSvc.create(tenantId, owner1Id, {
      fiscal_year_id: fiscalYearId,
      filing_method: 'twenty_percent_special',
    });
    const finalized = await consumptionTaxSvc.finalize(tenantId, owner1Id, taxReturn.id as string);
    console.log(
      `  消費税申告(2割特例): 課税売上=${finalized.taxable_sales_amount}円, 納税額=${finalized.tax_due_amount}円`,
    );
  } catch (e) {
    recordError('fiscal_year_end', e);
  }

  // --------------------------------------------------------------------
  // フェーズ14: 最終整合性検証
  // --------------------------------------------------------------------
  console.log('=== フェーズ14: 最終整合性検証 ===');
  const finalPl = await reportsSvc.profitAndLoss(tenantId, owner1Id, {
    date_from: '2025-04-01',
    date_to: '2026-03-31',
  });
  const finalBs = await reportsSvc.balanceSheet(tenantId, owner1Id, { as_of_date: '2026-03-31' });
  const finalCf = await reportsSvc.cashFlow(tenantId, owner1Id, {
    date_from: '2025-04-01',
    date_to: '2026-03-31',
  });

  const plNetIncome = finalPl.lines.find((l) => l.account_name === '当期純利益')?.amount ?? 0;
  const bsTotalAssets = finalBs.lines.find((l) => l.account_name === '資産合計')?.amount ?? 0;
  const bsTotalLiabilities = finalBs.lines.find((l) => l.account_name === '負債合計')?.amount ?? 0;
  const bsTotalEquity = finalBs.lines.find((l) => l.account_name === '純資産合計')?.amount ?? 0;
  const bsUnappropriatedNetIncome = finalBs.lines.find((l) => l.account_name === '当期純利益(未処分)')?.amount ?? 0;
  const bsCashLine = finalBs.lines.find((l) => l.account_code === '1000')?.amount ?? 0;
  const bsBankLine = finalBs.lines.find((l) => l.account_code === '1100')?.amount ?? 0;

  const balanceCheckDiff = Math.round((bsTotalAssets - (bsTotalLiabilities + bsTotalEquity)) * 100) / 100;
  const plBsNetIncomeDiff = Math.round((plNetIncome - bsUnappropriatedNetIncome) * 100) / 100;
  const cfBsCashDiff = Math.round((finalCf.endingCashBalance - (bsCashLine + bsBankLine)) * 100) / 100;

  // 全テナント固有表がFORCE RLS対象のため、`db.query()`(コンテキスト無し)ではなく
  // `db.transaction()`でテナントコンテキストを設定した上で集計する。
  const countRows = await db.transaction(tenantId, owner1Id, (client) =>
    client.query<{ table_name: string; c: string }>(
      `SELECT 'journal_entries' AS table_name, COUNT(*)::text AS c FROM journal_entries WHERE tenant_id = $1
       UNION ALL SELECT 'expense_reports', COUNT(*)::text FROM expense_reports WHERE tenant_id = $1
       UNION ALL SELECT 'invoices', COUNT(*)::text FROM invoices WHERE tenant_id = $1
       UNION ALL SELECT 'vendor_bills', COUNT(*)::text FROM vendor_bills WHERE tenant_id = $1
       UNION ALL SELECT 'bank_transactions', COUNT(*)::text FROM bank_transactions WHERE tenant_id = $1
       UNION ALL SELECT 'ai_suggestions', COUNT(*)::text FROM ai_suggestions WHERE tenant_id = $1
       UNION ALL SELECT 'audit_logs', COUNT(*)::text FROM audit_logs WHERE tenant_id = $1
       UNION ALL SELECT 'users', COUNT(*)::text FROM tenant_users WHERE tenant_id = $1
       UNION ALL SELECT 'fixed_assets', COUNT(*)::text FROM fixed_assets WHERE tenant_id = $1
       UNION ALL SELECT 'payroll_imports', COUNT(*)::text FROM payroll_imports WHERE tenant_id = $1`,
      [tenantId],
    ),
  );
  const tableCounts: Record<string, number> = {};
  for (const row of countRows.rows) tableCounts[row.table_name] = Number(row.c);

  const totalElapsedSec = (Date.now() - startedAt) / 1000;

  const report = {
    tenantId,
    generatedAt: new Date().toISOString(),
    totalElapsedSec,
    scale: SCALE,
    monthsProcessed: months.length,
    stats,
    tableCounts,
    monthlyPlSummaries,
    reconciliation: {
      bsTotalAssets,
      bsTotalLiabilities,
      bsTotalEquity,
      plNetIncome,
      bsUnappropriatedNetIncome,
      balanceCheckDiff,
      plBsNetIncomeDiff,
      cfEndingCashBalance: finalCf.endingCashBalance,
      bsCashPlusBank: bsCashLine + bsBankLine,
      cfBsCashDiff,
      allPass: balanceCheckDiff === 0 && plBsNetIncomeDiff === 0 && cfBsCashDiff === 0,
    },
    errorCount: errors.length,
    errors: errors.slice(0, 200),
  };

  const outPath = path.resolve(__dirname, '../../../simulation-report.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('=== 完了 ===');
  console.log(`所要時間: ${totalElapsedSec.toFixed(1)}秒`);
  console.log(`エラー件数: ${errors.length}`);
  console.log(`BS貸借差額: ${balanceCheckDiff}円 / PL-BS当期純利益差額: ${plBsNetIncomeDiff}円 / CF-BS現金差額: ${cfBsCashDiff}円`);
  console.log(`レポート出力先: ${outPath}`);

  await app.close();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('シミュレーションが致命的エラーで停止しました:', err);
    process.exit(1);
  });
