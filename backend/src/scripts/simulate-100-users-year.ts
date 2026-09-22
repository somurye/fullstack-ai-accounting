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
import { ApprovalRequestsService } from '../modules/approval-requests/approval-requests.service';
import { ContractsService } from '../modules/contracts/contracts.service';
import { GeneralRequestsService } from '../modules/general-requests/general-requests.service';
import { SuppliersService } from '../modules/suppliers/suppliers.service';
import { PurchaseRequestsService } from '../modules/purchase-requests/purchase-requests.service';
import { EmployeesService } from '../modules/employees/employees.service';
import { AttendanceService } from '../modules/attendance/attendance.service';
import { RateMastersService } from '../modules/rate-masters/rate-masters.service';
import { PayrollCalculationsService } from '../modules/payroll-calculations/payroll-calculations.service';
import { YearEndAdjustmentsService } from '../modules/year-end-adjustments/year-end-adjustments.service';
import { QuotationsService } from '../modules/quotations/quotations.service';
import { DealsService } from '../modules/deals/deals.service';
import { ContractRenewalLinksService } from '../modules/contract-renewal-links/contract-renewal-links.service';
import { ExecutiveDashboardService } from '../modules/executive-dashboard/executive-dashboard.service';
import { RecommendationsService } from '../modules/recommendations/recommendations.service';

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
  role:
    | 'owner'
    | 'accounting_manager'
    | 'accountant'
    | 'bookkeeper'
    | 'approver'
    | 'payroll_admin'
    | 'legal_admin'
    | 'legal_viewer'
    | 'viewer_external'
    | 'employee';
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
  const approvalRequestsSvc = app.get(ApprovalRequestsService);
  const contractsSvc = app.get(ContractsService);
  const generalRequestsSvc = app.get(GeneralRequestsService);
  const suppliersSvc = app.get(SuppliersService);
  const purchaseRequestsSvc = app.get(PurchaseRequestsService);
  const employeesSvc = app.get(EmployeesService);
  const attendanceSvc = app.get(AttendanceService);
  const rateMastersSvc = app.get(RateMastersService);
  const payrollCalculationsSvc = app.get(PayrollCalculationsService);
  const yearEndAdjustmentsSvc = app.get(YearEndAdjustmentsService);
  const quotationsSvc = app.get(QuotationsService);
  const dealsSvc = app.get(DealsService);
  const contractRenewalLinksSvc = app.get(ContractRenewalLinksService);
  const executiveDashboardSvc = app.get(ExecutiveDashboardService);
  const recommendationsSvc = app.get(RecommendationsService);

  const errors: ErrorRecord[] = [];
  function recordError(phase: string, e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    errors.push({ phase, message });
  }

  const stats = {
    // 既存
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
    // Phase 1: 契約・稟議
    contractsCreated: 0,
    contractsApproved: 0,
    generalRequestsCreated: 0,
    generalRequestsApproved: 0,
    generalRequestsRejected: 0,
    // Phase 2: 購買調達
    suppliersCreated: 0,
    purchaseRequestsCreated: 0,
    purchaseRequestsApproved: 0,
    purchaseReceiptsCreated: 0,
    threeWayMatchesCompleted: 0,
    // Phase 3: 人事労務
    employeesCreated: 0,
    attendanceRecordsCreated: 0,
    payrollEngineCalculations: 0,
    yearEndAdjustmentsCompleted: 0,
    // Phase 4: 営業事務
    quotationsCreated: 0,
    quotationsAccepted: 0,
    quotationsRejected: 0,
    quotationsStaleSent: 0,
    dealsCreated: 0,
    dealsWon: 0,
    contractRenewalDealsCreated: 0,
    // Phase 5: 統合最適化
    recommendationsGenerated: 0,
    recommendationsAccepted: 0,
    recommendationsDismissed: 0,
  };

  console.log('=== フェーズ1: テナント・オーナー作成(signup) ===');
  const EMAIL_DOMAIN = process.env.SIM_EMAIL_DOMAIN ?? `enterprise-${Date.now()}.sim.example.jp`;
  const ownerEmail = `owner1@${EMAIL_DOMAIN}`;
  const tenantName = '100人規模全社バックオフィス統合シミュレーション株式会社';
  const signupResult = await auth.signup({
    email: ownerEmail,
    password: 'SimPass!2025',
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
    legal_name: `株式会社全社バックオフィス統合シミュレーション`,
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

  // 1. owner (2名: owner1は登録済み、owner2を追加)
  await addUser('役員 次郎', `owner2@${EMAIL_DOMAIN}`, 'owner', 'EXEC002', '役員');

  // 2. accounting_manager (1名)
  await addUser('経理責任者 花子', `mgr1@${EMAIL_DOMAIN}`, 'accounting_manager', 'MGR001', '経理部');

  // 3. accountant (1名)
  await addUser('経理担当 一郎', `accountant1@${EMAIL_DOMAIN}`, 'accountant', 'ACC001', '経理部');

  // 4. bookkeeper (1名)
  await addUser('記帳担当 二郎', `bookkeeper1@${EMAIL_DOMAIN}`, 'bookkeeper', 'BKP001', '経理部');

  // 5. approver (1名)
  await addUser('承認責任者 三郎', `approver1@${EMAIL_DOMAIN}`, 'approver', 'APP001', '経営管理部');

  // 6. payroll_admin (1名)
  await addUser('給与担当 四郎', `payroll1@${EMAIL_DOMAIN}`, 'payroll_admin', 'PAY001', '人事労務部');

  // 7. legal_admin (1名)
  await addUser('法務管理者 五郎', `legal_admin1@${EMAIL_DOMAIN}`, 'legal_admin', 'LGL001', '法務部');

  // 8. legal_viewer (1名)
  await addUser('法務閲覧者 六郎', `legal_viewer1@${EMAIL_DOMAIN}`, 'legal_viewer', 'LGL002', '法務部');

  // 9. viewer_external (1名)
  await addUser('外部監査担当(税理士法人)', `auditor@audit.${EMAIL_DOMAIN}`, 'viewer_external', 'AUD001', '社外');

  // 10. employee (90名: 計100名)
  await mapPool(
    Array.from({ length: 90 }, (_, idx) => idx + 1),
    8,
    (i) =>
      addUser(
        `社員${String(i).padStart(3, '0')}`,
        `emp${String(i).padStart(3, '0')}@${EMAIL_DOMAIN}`,
        'employee',
        `EMP${String(i).padStart(3, '0')}`,
        departments[i % departments.length],
      ),
  );

  const ownerUser = users.find((u) => u.email === `owner1@${EMAIL_DOMAIN}`)!;
  const owner2User = users.find((u) => u.email === `owner2@${EMAIL_DOMAIN}`)!;
  const accountingManagerUser = users.find((u) => u.email === `mgr1@${EMAIL_DOMAIN}`)!;
  const accountantUser = users.find((u) => u.email === `accountant1@${EMAIL_DOMAIN}`)!;
  const bookkeeperUser = users.find((u) => u.email === `bookkeeper1@${EMAIL_DOMAIN}`)!;
  const approverUser = users.find((u) => u.email === `approver1@${EMAIL_DOMAIN}`)!;
  const payrollAdminUser = users.find((u) => u.email === `payroll1@${EMAIL_DOMAIN}`)!;
  const legalAdminUser = users.find((u) => u.email === `legal_admin1@${EMAIL_DOMAIN}`)!;
  const legalViewerUser = users.find((u) => u.email === `legal_viewer1@${EMAIL_DOMAIN}`)!;
  const auditorUser = users.find((u) => u.email === `auditor@audit.${EMAIL_DOMAIN}`)!;
  const owners = users.filter((u) => u.role === 'owner');
  const managers = users.filter((u) => u.role === 'accounting_manager');
  const employees = users.filter((u) => u.role === 'employee');
  const allStaff = users.filter((u) => u.role !== 'viewer_external');
  console.log(
    `  users total=${users.length} (全10ロール: owner=${owners.length} mgr=${managers.length} acc=1 bkp=1 app=1 pay=1 lgl_adm=1 lgl_viw=1 aud=1 emp=${employees.length})`,
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

  console.log('=== フェーズ9: 承認ルール作成(経費・契約・稟議・発注・給与・年末調整) ===');
  await db.transaction(tenantId, owner1Id, async (client) => {
    const rules = [
      { target_type: 'expense_report', roleCode: 'accounting_manager' },
      { target_type: 'general_request', roleCode: 'approver' },
      { target_type: 'contract', roleCode: 'owner' },
      { target_type: 'purchase_request', roleCode: 'approver' },
      { target_type: 'payroll', roleCode: 'owner' },
      { target_type: 'year_end_adjustment', roleCode: 'owner' },
    ];
    for (const r of rules) {
      await client.query(
        `INSERT INTO approval_rules (tenant_id, target_type, step_number, condition, approver_role_id, is_active)
         VALUES ($1, $2, 1, '{}'::jsonb, $3, TRUE)`,
        [tenantId, r.target_type, roleIdByCode.get(r.roleCode)],
      );
    }
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
  for (const u of users.filter((u) => u.role !== 'owner')) {
    payrollProfile.set(u.id, { isExecutive: false, base: randInt(280_000, 480_000) });
  }

  console.log('=== フェーズ11b: Phase 1〜5 マスタ・初期データ登録 ===');
  // (A) サプライヤーマスタ登録 (Phase 2)
  const supplierIds: string[] = [];
  const supplierDefs = [
    { code: 'SUP001', name: 'オフィスサプライ株式会社', terms: '月末締め翌月末振込' },
    { code: 'SUP002', name: 'クラウドインフラ株式会社', terms: '当月末日振込' },
    { code: 'SUP003', name: 'IT機器調達パートナーズ', terms: '納品後30日以内' },
    { code: 'SUP004', name: 'オフィス什器販売株式会社', terms: '月末締め翌月末振込' },
  ];
  for (const s of supplierDefs) {
    try {
      const created = await suppliersSvc.create(tenantId, owner1Id, {
        name: s.name,
        payment_terms: s.terms,
        status: 'active',
      });
      supplierIds.push(created.id as string);
      stats.suppliersCreated++;
    } catch (e) {
      recordError('init:supplier', e);
    }
  }

  // (B) 従業員マスタ登録 (Phase 3)
  const employeeIdByUserId = new Map<string, string>();
  for (let idx = 0; idx < users.length; idx++) {
    const u = users[idx];
    try {
      const emp = await employeesSvc.create(tenantId, owner1Id, {
        user_id: u.id,
        employee_no: `EMP${String(idx + 1).padStart(3, '0')}`,
        name: u.name,
        hire_date: '2024-04-01',
        employment_type: 'full_time',
        status: 'active',
      });
      employeeIdByUserId.set(u.id, emp.id as string);
      stats.employeesCreated++;
    } catch (e) {
      recordError('init:employee', e);
    }
  }

  // (C) 保険料率マスタ登録 (Phase 3)
  try {
    await rateMastersSvc.createInsuranceRate(tenantId, owner1Id, {
      rate_type: 'health_insurance',
      prefecture: '東京都',
      rate_employee: 0.04985,
      rate_employer: 0.04985,
      effective_from: '2025-04-01',
      description: '令和7年度 東京都健康保険料率(折半)',
    });
    await rateMastersSvc.createInsuranceRate(tenantId, owner1Id, {
      rate_type: 'care_insurance',
      rate_employee: 0.008,
      rate_employer: 0.008,
      effective_from: '2025-04-01',
      description: '令和7年度 介護保険料率(折半)',
    });
    await rateMastersSvc.createInsuranceRate(tenantId, owner1Id, {
      rate_type: 'pension',
      rate_employee: 0.0915,
      rate_employer: 0.0915,
      effective_from: '2025-04-01',
      description: '令和7年度 厚生年金保険料率(折半)',
    });
    await rateMastersSvc.createInsuranceRate(tenantId, owner1Id, {
      rate_type: 'employment_insurance',
      rate_employee: 0.006,
      rate_employer: 0.0095,
      effective_from: '2025-04-01',
      description: '令和7年度 雇用保険料率',
    });
    await rateMastersSvc.createTaxBracket(tenantId, owner1Id, {
      dependents_count: 0,
      income_min: 0,
      income_max: null,
      tax_amount: 0,
      effective_from: '2025-01-01',
      description: '所得税源泉徴収基本税額帯(0円以上全域)',
    });
  } catch (e) {
    recordError('init:rate_masters', e);
  }

  // (D) 内製給与計算用プロファイル登録 (Phase 3)
  for (const u of users) {
    const empId = employeeIdByUserId.get(u.id);
    if (!empId) continue;
    const prof = payrollProfile.get(u.id)!;
    try {
      await payrollCalculationsSvc.createProfile(tenantId, owner1Id, {
        employee_id: empId,
        salary_type: 'monthly',
        base_salary: prof.base,
        hourly_wage: 0,
        resident_tax_amount: 15_000,
        standard_monthly_remuneration: prof.base,
        has_health_insurance: true,
        has_care_insurance: false,
        has_pension: true,
        has_employment_insurance: !prof.isExecutive,
        prefecture: '東京都',
        dependents_count: 0,
        effective_from: '2025-04-01',
      });
    } catch (e) {
      recordError('init:payroll_profile', e);
    }
  }

  // (E) 初期契約書の作成 (Phase 1)
  const initialContracts: { id: string; title: string; type: string; isExpiringNear: boolean }[] = [];
  try {
    const contractDefs = [
      {
        title: 'クラウドインフラ利用基本契約',
        contract_type: 'service' as const,
        counterparty_name: 'ITハードウェア商事株式会社',
        start_date: '2025-04-01',
        end_date: '2026-03-31',
        amount: 3_600_000,
        auto_renewal: false,
        notice_days: 30,
        shouldApprove: true,
        isExpiringNear: true,
      },
      {
        title: '本社オフィス賃貸借契約',
        contract_type: 'lease' as const,
        counterparty_name: '不動産管理株式会社',
        start_date: '2025-04-01',
        end_date: '2028-03-31',
        amount: 24_000_000,
        auto_renewal: true,
        notice_days: 90,
        shouldApprove: true,
        isExpiringNear: false,
      },
      {
        title: '基幹業務システム保守委託契約',
        contract_type: 'outsourcing' as const,
        counterparty_name: '外注先パートナー株式会社',
        start_date: '2025-05-01',
        end_date: '2026-04-30',
        amount: 6_000_000,
        auto_renewal: false,
        notice_days: 60,
        shouldApprove: true,
        isExpiringNear: true,
      },
      {
        title: '年間ソフトウェアライセンス提供契約',
        contract_type: 'license' as const,
        counterparty_name: '得意先1株式会社',
        start_date: '2025-04-01',
        end_date: '2026-03-31',
        amount: 12_000_000,
        auto_renewal: false,
        notice_days: 30,
        shouldApprove: true,
        isExpiringNear: true,
      },
      {
        title: '新規パートナーシップ秘密保持契約(NDA)',
        contract_type: 'nda' as const,
        counterparty_name: '得意先2株式会社',
        start_date: '2025-06-01',
        end_date: '2026-05-31',
        auto_renewal: false,
        notice_days: 30,
        shouldApprove: false, // 下書き(draft)のまま保持
        isExpiringNear: false,
      },
      {
        title: '新規事業マーケティング支援業務委託契約',
        contract_type: 'outsourcing' as const,
        counterparty_name: '外注先パートナー株式会社',
        start_date: '2025-10-01',
        end_date: '2026-09-30',
        amount: 4_800_000,
        auto_renewal: false,
        notice_days: 30,
        shouldApprove: false, // pending_approvalのまま保持(stale approvalsレコメンド対象)
        isExpiringNear: false,
      },
    ];

    for (const cd of contractDefs) {
      const created = await contractsSvc.create(tenantId, legalAdminUser.id, {
        title: cd.title,
        contract_type: cd.contract_type,
        counterparty_name: cd.counterparty_name,
        currency: 'JPY',
        start_date: cd.start_date,
        end_date: cd.end_date,
        contract_amount: cd.amount,
        auto_renewal: cd.auto_renewal,
        renewal_notice_days: cd.notice_days ?? 30,
      });
      stats.contractsCreated++;

      if (cd.shouldApprove) {
        await contractsSvc.submitForApproval(tenantId, legalAdminUser.id, created.id as string);
        // 承認責任者(approver)またはownerが承認
        const ar = await db.transaction(tenantId, owner1Id, async (client) => {
          const res = await client.query<{ id: string }>(
            `SELECT id FROM approval_requests WHERE tenant_id = $1 AND target_type = 'contract' AND target_id = $2`,
            [tenantId, created.id],
          );
          return res.rows[0];
        });
        if (ar) {
          await approvalRequestsSvc.approve(tenantId, owner1Id, ar.id, { comment: '契約内容承認' });
          stats.contractsApproved++;
        }
      } else if (cd.title.includes('マーケティング支援')) {
        await contractsSvc.submitForApproval(tenantId, legalAdminUser.id, created.id as string);
      }


      initialContracts.push({
        id: created.id as string,
        title: cd.title,
        type: cd.contract_type,
        isExpiringNear: cd.isExpiringNear,
      });
    }
  } catch (e) {
    recordError('init:contracts', e);
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
        const submitter = pick(employees);
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

          const approver = accountingManagerUser;
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

    // ------------------------------------------------------------------
    // (7) 稟議・各種申請(Phase 1: 月約2〜3件、承認・却下・保留の混在)
    // ------------------------------------------------------------------
    const generalRequestTitles: { title: string; category: 'equipment' | 'business_trip' | 'general'; priority: 'medium' | 'high' | 'low' | 'urgent'; amount: number }[] = [
      { title: `開発用モニター・周辺機器購入申請 (${m.label})`, category: 'equipment', priority: 'medium', amount: 85_000 },
      { title: `技術カンファレンス参加稟議 (${m.label})`, category: 'business_trip', priority: 'high', amount: 50_000 },
      { title: `在宅勤務環境整備補助申請 (${m.label})`, category: 'general', priority: 'low', amount: 30_000 },
      { title: `全社セキュリティ教育ツール導入稟議 (${m.label})`, category: 'equipment', priority: 'urgent', amount: 300_000 },
    ];
    for (const gr of generalRequestTitles.slice(0, scaled(randInt(2, 3)))) {
      try {
        const requester = pick(employees);
        const created = await generalRequestsSvc.create(tenantId, requester.id, {
          title: gr.title,
          category: gr.category as any,
          amount: gr.amount,
          description: `${gr.title} の申請です。`,
        });
        stats.generalRequestsCreated++;

        // 一部は承認、一部は却下、一部はpending(未処理)のまま放置
        const actionRand = rand();
        if (actionRand < 0.6) {
          await generalRequestsSvc.submitForApproval(tenantId, requester.id, created.id as string);
          const ar = await db.transaction(tenantId, approverUser.id, async (client) => {
            const res = await client.query<{ id: string }>(
              `SELECT id FROM approval_requests WHERE tenant_id = $1 AND target_type = 'general_request' AND target_id = $2`,
              [tenantId, created.id],
            );
            return res.rows[0];
          });
          if (ar) {
            await approvalRequestsSvc.approve(tenantId, approverUser.id, ar.id, { comment: '稟議内容承認' });
            stats.generalRequestsApproved++;
          }
        } else if (actionRand < 0.8) {
          await generalRequestsSvc.submitForApproval(tenantId, requester.id, created.id as string);
          const ar = await db.transaction(tenantId, approverUser.id, async (client) => {
            const res = await client.query<{ id: string }>(
              `SELECT id FROM approval_requests WHERE tenant_id = $1 AND target_type = 'general_request' AND target_id = $2`,
              [tenantId, created.id],
            );
            return res.rows[0];
          });
          if (ar) {
            await approvalRequestsSvc.reject(tenantId, approverUser.id, ar.id, { comment: '予算枠超過のため却下' });
            stats.generalRequestsRejected++;
          }
        } else {
          // 未処理のまま提出(stale approvalsレコメンド対象)
          await generalRequestsSvc.submitForApproval(tenantId, requester.id, created.id as string);
        }
      } catch (e) {
        recordError(`${m.label}:general_request`, e);
      }
    }

    // ------------------------------------------------------------------
    // (8) 発注申請〜検収〜仕入請求書紐付け(3点照合 - Phase 2: 月約1〜2件)
    // ------------------------------------------------------------------
    const prItemPool = [
      { name: '開発用クラウドサーバー月額利用料', price: 120_000 },
      { name: 'オフィスコピー用紙・文具一式', price: 45_000 },
      { name: '社内ネットワークルーター保守部品', price: 80_000 },
      { name: 'ergonomicオフィスチェア追加分', price: 65_000 },
    ];
    if (supplierIds.length > 0) {
      for (let i = 0; i < scaled(randInt(1, 2)); i++) {
        try {
          const supplierId = pick(supplierIds);
          const requester = pick(employees);
          const prItem = pick(prItemPool);
          const quantity = randInt(1, 3);
          const pr = await purchaseRequestsSvc.create(tenantId, requester.id, {
            title: `${prItem.name} 発注申請 (${m.label})`,
            supplier_id: supplierId,
            item_description: prItem.name,
            quantity,
            unit_price: prItem.price,
            requested_delivery_date: randomDateInMonth(m.year, m.month),
          });
          stats.purchaseRequestsCreated++;

          // 承認申請
          await purchaseRequestsSvc.submitForApproval(tenantId, requester.id, pr.id as string);
          const ar = await db.transaction(tenantId, approverUser.id, async (client) => {
            const res = await client.query<{ id: string }>(
              `SELECT id FROM approval_requests WHERE tenant_id = $1 AND target_type = 'purchase_request' AND target_id = $2`,
              [tenantId, pr.id],
            );
            return res.rows[0];
          });
          if (ar) {
            await approvalRequestsSvc.approve(tenantId, approverUser.id, ar.id, { comment: '発注申請承認' });
            stats.purchaseRequestsApproved++;

            // 納品受領(検収)
            const receiptDate = randomDateInMonth(m.year, m.month);
            await purchaseRequestsSvc.addReceipt(tenantId, approverUser.id, pr.id as string, {
              received_quantity: quantity,
              received_date: receiptDate,
              notes: '検収完了、数量・品質に問題なし',
            });
            stats.purchaseReceiptsCreated++;

            // 仕入請求書(vendor_bills)との紐付け (3点照合完了)
            if (approvedBills.length > 0) {
              const targetBill = pick(approvedBills);
              await purchaseRequestsSvc.linkVendorBill(tenantId, owner1Id, pr.id as string, {
                vendor_bill_id: targetBill.id,
              });
              stats.threeWayMatchesCompleted++;
            }
          }
        } catch (e) {
          recordError(`${m.label}:purchase_request`, e);
        }
      }
    }

    // ------------------------------------------------------------------
    // (9) 勤怠打刻 & 内製給与計算エンジン & 年末調整(Phase 3)
    // ------------------------------------------------------------------
    // 勤怠打刻: attendance.create 権限を持つ一般社員（＋管理者・給与担当）を対象に打刻を記録
    const sampleStaffForAttendance = [
      ownerUser,
      payrollAdminUser,
      ...employees.slice(0, 10),
    ];
    // 月内の平日サンプリング日 (5日, 10日, 15日, 20日, 25日)
    const workDays = [5, 10, 15, 20, 25].filter((d) => d <= daysInMonth(m.year, m.month));
    for (const staff of sampleStaffForAttendance) {
      const empId = employeeIdByUserId.get(staff.id);
      if (!empId) continue;
      for (const day of workDays) {
        try {
          const workDate = ymd(m.year, m.month, day);
          const clockInTime = `${workDate}T09:00:00+09:00`;
          const otHours = chance(0.4) ? randInt(1, 2) : 0;
          const clockOutHour = 18 + otHours;
          const clockOutTime = `${workDate}T${String(clockOutHour).padStart(2, '0')}:00:00+09:00`;

          await attendanceSvc.createRecord(tenantId, staff.id, {
            employee_id: empId,
            work_date: workDate,
            clock_in: clockInTime,
            clock_out: clockOutTime,
            break_minutes: 60,
            is_holiday: false,
            note: '通常勤務',
          });
          stats.attendanceRecordsCreated++;
        } catch (e) {
          recordError(`${m.label}:attendance_record`, e);
        }
      }
    }

    // 内製給与計算エンジン (payroll-calculations) 実行
    try {
      const periodStart = ymd(m.year, m.month, 1);
      const periodEnd = ymd(m.year, m.month, daysInMonth(m.year, m.month));
      const payDate = ymd(m.year, m.month, 25);

      const period = await payrollCalculationsSvc.createPeriod(tenantId, payrollAdminUser.id, {
        name: `${m.year}年${m.month}月度 内製給与計算`,
        period_start: periodStart,
        period_end: periodEnd,
        payment_date: payDate,
      });

      const calcs = await payrollCalculationsSvc.calculateForPeriod(
        tenantId,
        payrollAdminUser.id,
        period.id as string,
        {},
      );
      stats.payrollEngineCalculations += calcs.length;

      // 承認申請 & 確定
      await payrollCalculationsSvc.submitPeriodApproval(
        tenantId,
        payrollAdminUser.id,
        period.id as string,
        { comment: '月次内製給与計算完了、承認申請します' },
      );
    } catch (e) {
      recordError(`${m.label}:payroll_calculations_engine`, e);
    }

    // 年末調整 (12月)
    if (m.month === 12) {
      console.log('  -- 年末調整シミュレーション(12月) --');
      for (const staff of sampleStaffForAttendance) {
        const empId = employeeIdByUserId.get(staff.id);
        if (!empId) continue;
        try {
          const yea = await yearEndAdjustmentsSvc.calculate(tenantId, payrollAdminUser.id, {
            employee_id: empId,
            tax_year: 2026,
            dependents_count: 0,
            spouse_deduction: 0,
            life_insurance_deduction: 50_000,
            earthquake_insurance_deduction: 20_000,
            housing_loan_deduction: 0,
          });
          const submittedYea = await yearEndAdjustmentsSvc.submitApproval(tenantId, payrollAdminUser.id, yea.id, {
            comment: '年末調整申告承認',
          });
          if (submittedYea.approval_request_id) {
            await approvalRequestsSvc.approve(tenantId, owner1Id, submittedYea.approval_request_id, {
              comment: '年末調整承認完了',
            });
          }
          stats.yearEndAdjustmentsCompleted++;
        } catch (e) {
          recordError(`${m.label}:year_end_adjustment`, e);
        }
      }
    }

    // ------------------------------------------------------------------
    // (10) 見積書・案件パイプライン・契約更新提案リンク(Phase 4)
    // ------------------------------------------------------------------
    const quoteItemsPool = [
      { name: 'クラウド統合基盤構築支援コンサルティング', price: 1_200_000 },
      { name: '経理自動化SaaS 年間ライセンス', price: 600_000 },
      { name: 'ERP導入・データマイグレーション支援', price: 2_500_000 },
      { name: '月次システム運用保守サポート', price: 150_000 },
    ];
    for (let i = 0; i < scaled(randInt(2, 4)); i++) {
      try {
        const custId = pick(customerIds);
        const item = pick(quoteItemsPool);
        const issueDate = randomDateInMonth(m.year, m.month);
        const validUntil = addDaysClamped(issueDate, 30, '2026-03-31') ?? issueDate;
        const quote = await quotationsSvc.create(tenantId, owner1Id, {
          customer_id: custId,
          title: `${item.name} 御見積書 (${m.label})`,
          issue_date: issueDate,
          valid_until: validUntil,
          lines: [
            {
              item_name: item.name,
              quantity: 1,
              unit: '式',
              unit_price: item.price,
              tax_rate: 0.1,
            },
          ],
        });
        stats.quotationsCreated++;

        const quoteRand = rand();
        if (quoteRand < 0.45) {
          // 送信 → 受注
          await quotationsSvc.send(tenantId, owner1Id, quote.id as string);
          await quotationsSvc.accept(tenantId, owner1Id, quote.id as string);
          stats.quotationsAccepted++;
        } else if (quoteRand < 0.65) {
          // 送信 → 却下
          await quotationsSvc.send(tenantId, owner1Id, quote.id as string);
          await quotationsSvc.reject(tenantId, owner1Id, quote.id as string);
          stats.quotationsRejected++;
        } else if (quoteRand < 0.85) {
          // 送信のまま放置 (stale sent quotation: レコメンドフォローアップ提案対象)
          await quotationsSvc.send(tenantId, owner1Id, quote.id as string);
          stats.quotationsStaleSent++;
        }
        // 残り15%はdraftのまま保持
      } catch (e) {
        recordError(`${m.label}:quotation`, e);
      }
    }

    // 案件(Deals)作成
    for (let i = 0; i < scaled(randInt(1, 2)); i++) {
      try {
        const custId = pick(customerIds);
        const stages: Array<'lead' | 'qualified' | 'proposal' | 'negotiation'> = [
          'lead',
          'qualified',
          'proposal',
          'negotiation',
        ];
        const selectedStage = pick(stages);
        const expectedAmount = randInt(500_000, 3_000_000);
        const deal = await dealsSvc.create(tenantId, owner1Id, ['owner'], {
          customer_id: custId,
          title: `新規ソリューション導入商談 (${m.label})`,
          stage: selectedStage,
          expected_amount: expectedAmount,
          currency_code: 'JPY',
          expected_close_date: m.endDate,
        });
        stats.dealsCreated++;

        // 一部は商談成約(won)または失注(lost)へクローズ
        if (selectedStage === 'negotiation' && chance(0.5)) {
          await dealsSvc.close(tenantId, owner1Id, ['owner'], deal.id as string, {
            stage: 'won',
          });
          stats.dealsWon++;
        }
      } catch (e) {
        recordError(`${m.label}:deal`, e);
      }
    }

    // 契約更新提案リンク (3月または期末近く)
    if (m.month === 3) {
      const expiringContract = initialContracts.find((c) => c.title.includes('年間ソフトウェアライセンス提供契約'));
      if (expiringContract) {
        try {
          const renewalResult = await contractRenewalLinksSvc.createRenewalDeal(tenantId, owner1Id, ['owner'], {
            contract_id: expiringContract.id,
            title: '次期 年間ソフトウェアライセンス更新商談(自動提案)',
            expected_amount: 13_200_000,
            expected_close_date: '2026-03-31',
          });
          stats.contractRenewalDealsCreated++;

          // 更新用見積書を作成してアタッチ
          const renewalQuote = await quotationsSvc.create(tenantId, owner1Id, {
            customer_id: customerIds[0],
            deal_id: renewalResult.link.deal_id,
            title: '次期 年間ソフトウェアライセンス更新御見積',
            issue_date: '2026-03-01',
            valid_until: '2026-03-31',
            lines: [
              {
                item_name: '次期 年間ソフトウェアライセンス',
                quantity: 1,
                unit: '式',
                unit_price: 13_200_000,
                tax_rate: 0.1,
              },
            ],
          });
          if (renewalResult.link.deal_id) {
            await contractRenewalLinksSvc.attachQuotation(
              tenantId,
              owner1Id,
              ['owner'],
              renewalResult.link.deal_id,
              renewalQuote.id as string,
            );
          }
        } catch (e) {
          recordError(`${m.label}:contract_renewal_link`, e);
        }
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
  // フェーズ13b: Phase 5 統合最適化 (AIレコメンド生成 & 横断KPIダッシュボード検証)
  // --------------------------------------------------------------------
  console.log('=== フェーズ13b: Phase 5 統合最適化 (AIレコメンド & 横断KPI) ===');
  try {
    // AIレコメンド生成 (未承認申請、未フォロー見積、更新間近契約の自動検出)
    await recommendationsSvc.generateRecommendations(tenantId, owner1Id);
    const recList = await recommendationsSvc.list(tenantId, owner1Id, ['owner']);
    stats.recommendationsGenerated = recList.length;
    console.log(`  AIレコメンド自動生成: ${recList.length}件`);

    // 1件をaccept(採用)、1件をdismiss(見送り)、残りをpendingとしてUI確認用に保持
    if (recList.length > 0) {
      const firstRec = recList[0];
      await recommendationsSvc.accept(tenantId, owner1Id, ['owner'], firstRec.id);
      stats.recommendationsAccepted++;
    }
    if (recList.length > 1) {
      const secondRec = recList[1];
      await recommendationsSvc.dismiss(tenantId, owner1Id, ['owner'], secondRec.id);
      stats.recommendationsDismissed++;
    }

    // 横断KPIダッシュボード取得検証
    const execSummary = await executiveDashboardSvc.getSummary(tenantId, owner1Id, ['owner']);
    console.log(`  横断KPIサマリ取得成功:
    - 承認KPI: 未承認合計=${execSummary.approvals?.pending_total_count ?? 0}件
    - 契約KPI: 有効契約=${execSummary.contracts?.active_contracts_count ?? 0}件, 30日以内満了=${execSummary.contracts?.expiring_within_30_days ?? 0}件
    - 購買KPI: 当月発注額=${execSummary.purchase?.current_month_order_amount ?? 0}円, 未検収=${execSummary.purchase?.pending_receipts_count ?? 0}件
    - 人事KPI: 在籍従業員=${execSummary.hr?.active_employees_count ?? 0}名, 残業アラート=${execSummary.hr?.overtime_alert_count ?? 0}件
    - 営業KPI: 進行中案件=${execSummary.sales?.open_deals_count ?? 0}件, 案件総額=${execSummary.sales?.open_deals_amount ?? 0}円`);
  } catch (e) {
    recordError('phase5:recommendations_and_dashboard', e);
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
       UNION ALL SELECT 'payroll_imports', COUNT(*)::text FROM payroll_imports WHERE tenant_id = $1
       UNION ALL SELECT 'contracts', COUNT(*)::text FROM contracts WHERE tenant_id = $1
       UNION ALL SELECT 'general_requests', COUNT(*)::text FROM general_requests WHERE tenant_id = $1
       UNION ALL SELECT 'suppliers', COUNT(*)::text FROM suppliers WHERE tenant_id = $1
       UNION ALL SELECT 'purchase_requests', COUNT(*)::text FROM purchase_requests WHERE tenant_id = $1
       UNION ALL SELECT 'purchase_receipts', COUNT(*)::text FROM purchase_receipts WHERE tenant_id = $1
       UNION ALL SELECT 'employees', COUNT(*)::text FROM employees WHERE tenant_id = $1
       UNION ALL SELECT 'attendance_records', COUNT(*)::text FROM attendance_records WHERE tenant_id = $1
       UNION ALL SELECT 'insurance_rate_tables', COUNT(*)::text FROM insurance_rate_tables WHERE tenant_id = $1
       UNION ALL SELECT 'employee_payroll_profiles', COUNT(*)::text FROM employee_payroll_profiles WHERE tenant_id = $1
       UNION ALL SELECT 'payroll_periods', COUNT(*)::text FROM payroll_periods WHERE tenant_id = $1
       UNION ALL SELECT 'payroll_calculations', COUNT(*)::text FROM payroll_calculations WHERE tenant_id = $1
       UNION ALL SELECT 'year_end_adjustments', COUNT(*)::text FROM year_end_adjustments WHERE tenant_id = $1
       UNION ALL SELECT 'quotations', COUNT(*)::text FROM quotations WHERE tenant_id = $1
       UNION ALL SELECT 'deals', COUNT(*)::text FROM deals WHERE tenant_id = $1
       UNION ALL SELECT 'contract_renewal_links', COUNT(*)::text FROM contract_renewal_links WHERE tenant_id = $1
       UNION ALL SELECT 'recommendations', COUNT(*)::text FROM recommendations WHERE tenant_id = $1`,
      [tenantId],
    ),
  );
  const tableCounts: Record<string, number> = {};
  for (const row of countRows.rows) tableCounts[row.table_name] = Number(row.c);

  const totalElapsedSec = (Date.now() - startedAt) / 1000;

  // 全10ロールの代表テストアカウント情報
  const representativeAccounts = [
    { role: 'owner', email: `owner1@${EMAIL_DOMAIN}`, name: '代表 太郎', pass: 'SimPass!2025', desc: '全権限・オーナー' },
    { role: 'owner', email: `owner2@${EMAIL_DOMAIN}`, name: '役員 次郎', pass: 'SimPass!2025', desc: '役員・副代表' },
    { role: 'accounting_manager', email: `mgr1@${EMAIL_DOMAIN}`, name: '経理責任者 花子', pass: 'SimPass!2025', desc: '経理責任者・月次確定/承認' },
    { role: 'accountant', email: `accountant1@${EMAIL_DOMAIN}`, name: '経理担当 一郎', pass: 'SimPass!2025', desc: '経理実務・仕訳起票' },
    { role: 'bookkeeper', email: `bookkeeper1@${EMAIL_DOMAIN}`, name: '記帳担当 二郎', pass: 'SimPass!2025', desc: '記帳専任・補助' },
    { role: 'approver', email: `approver1@${EMAIL_DOMAIN}`, name: '承認責任者 三郎', pass: 'SimPass!2025', desc: '各種申請・発注・稟議承認' },
    { role: 'payroll_admin', email: `payroll1@${EMAIL_DOMAIN}`, name: '給与担当 四郎', pass: 'SimPass!2025', desc: '人事労務・給与計算・年末調整' },
    { role: 'legal_admin', email: `legal_admin1@${EMAIL_DOMAIN}`, name: '法務管理者 五郎', pass: 'SimPass!2025', desc: '契約管理・法務統轄' },
    { role: 'legal_viewer', email: `legal_viewer1@${EMAIL_DOMAIN}`, name: '法務閲覧者 六郎', pass: 'SimPass!2025', desc: '契約閲覧専用' },
    { role: 'viewer_external', email: `auditor@audit.${EMAIL_DOMAIN}`, name: '外部監査担当(税理士法人)', pass: 'SimPass!2025', desc: '外部監査時限アクセス(閲覧のみ)' },
    { role: 'employee', email: `emp001@${EMAIL_DOMAIN}`, name: '社員001', pass: 'SimPass!2025', desc: '一般社員(経費申請・勤怠・稟議)' },
  ];

  const report = {
    tenantId,
    tenantName,
    generatedAt: new Date().toISOString(),
    totalElapsedSec,
    scale: SCALE,
    monthsProcessed: months.length,
    representativeAccounts,
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

  console.log('=== 全社シミュレーション完了 ===');
  console.log(`所要時間: ${totalElapsedSec.toFixed(1)}秒`);
  console.log(`エラー件数: ${errors.length}`);
  console.log(`BS貸借差額: ${balanceCheckDiff}円 / PL-BS当期純利益差額: ${plBsNetIncomeDiff}円 / CF-BS現金差額: ${cfBsCashDiff}円`);
  console.log(`会計整合性チェック: ${balanceCheckDiff === 0 && plBsNetIncomeDiff === 0 && cfBsCashDiff === 0 ? '全件一致(合格)' : '不一致あり'}`);
  console.log(`レポート出力先: ${outPath}`);

  console.log('\n================================================================================');
  console.log('【サンプルテナント情報】');
  console.log(`  テナントID  : ${tenantId}`);
  console.log(`  テナント名  : ${tenantName}`);
  console.log('================================================================================');
  console.log('【全10ロール テストログイン情報一覧】(全アカウント共通パスワード: SimPass!2025)');
  console.log('--------------------------------------------------------------------------------');
  console.log('| ロール名 (Role)       | メールアドレス (Email)             | 氏名 (Name)             | 役割説明                  |');
  console.log('|-----------------------|------------------------------------|-------------------------|---------------------------|');
  for (const acc of representativeAccounts) {
    const roleCol = acc.role.padEnd(21);
    const emailCol = acc.email.padEnd(34);
    const nameCol = acc.name.padEnd(23);
    console.log(`| ${roleCol} | ${emailCol} | ${nameCol} | ${acc.desc} |`);
  }
  console.log('================================================================================');
  console.log('【生成データ件数サマリ (テーブル別)】');
  console.log('--------------------------------------------------------------------------------');
  for (const [tbl, cnt] of Object.entries(tableCounts)) {
    console.log(`  - ${tbl.padEnd(28)}: ${cnt} 件`);
  }
  console.log('================================================================================\n');

  await app.close();
}


main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('シミュレーションが致命的エラーで停止しました:', err);
    process.exit(1);
  });
