import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ExecutiveDashboardService } from '../modules/executive-dashboard/executive-dashboard.service';
import { ExecutiveDashboardController } from '../modules/executive-dashboard/executive-dashboard.controller';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AppException } from '../common/exceptions/app.exception';

function createMockContext(
  handler: Function,
  roles: string[],
  tenantId: string,
  userId: string,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => ExecutiveDashboardController,
    switchToHttp: () => ({
      getRequest: () => ({
        user: {
          sub: userId,
          tenant_id: tenantId,
          roles,
        },
        header: (name: string) => {
          if (name.toLowerCase() === 'x-tenant-id') return tenantId;
          return undefined;
        },
      }),
    }),
  } as unknown as ExecutionContext;
}

let totalAssertions = 0;

function expect(actual: unknown) {
  const matchers = (isNot = false) => ({
    toBe(expected: unknown) {
      totalAssertions++;
      const pass = actual === expected;
      if (isNot ? pass : !pass) {
        throw new Error(
          `Expected ${JSON.stringify(actual)} ${isNot ? 'NOT ' : ''}to be ${JSON.stringify(expected)}`,
        );
      }
    },
    toBeCloseTo(expected: number, precision = 2) {
      totalAssertions++;
      const pass =
        typeof actual === 'number' &&
        Math.abs(actual - expected) <= Math.pow(10, -precision);
      if (isNot ? pass : !pass) {
        throw new Error(
          `Expected ${actual} ${isNot ? 'NOT ' : ''}to be close to ${expected} (diff > 10^-${precision})`,
        );
      }
    },
    toEqual(expected: unknown) {
      totalAssertions++;
      const pass = JSON.stringify(actual) === JSON.stringify(expected);
      if (isNot ? pass : !pass) {
        throw new Error(
          `Expected ${JSON.stringify(actual)} ${isNot ? 'NOT ' : ''}to equal ${JSON.stringify(expected)}`,
        );
      }
    },
    toBeNull() {
      totalAssertions++;
      const pass = actual === null;
      if (isNot ? pass : !pass) {
        throw new Error(
          `Expected ${JSON.stringify(actual)} ${isNot ? 'NOT ' : ''}to be null`,
        );
      }
    },
  });

  return {
    ...matchers(false),
    not: matchers(true),
  };
}

async function run() {
  const dsn = process.argv[2] || process.env.DATABASE_URL;
  if (!dsn) {
    console.error('Usage: ts-node verify-executive-dashboard-e2e.ts <database_dsn>');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dsn });
  const db = new DatabaseService();
  (db as any).pool = pool;

  // --------------------------------------------------------------------------
  // 【BLOCKER-01対応 / P4-T4-FIX確立基準】
  // DatabaseService.transaction に SET LOCAL ROLE app_runtime をフック
  // superuser (postgres) の RLS バイパスを防止し、正規の app_runtime ロール下で
  // app.current_tenant_id / app.current_user_id による RLS ポリシーを確実に発動させる
  // --------------------------------------------------------------------------
  const origRunTransaction = (db as any).runTransaction.bind(db);
  (db as any).runTransaction = async (tenantId: string | null, userId: string | null, callback: any) => {
    return origRunTransaction(tenantId, userId, async (client: any) => {
      // 1. RLS適用対象ロール app_runtime へ切り替え
      await client.query('SET LOCAL ROLE app_runtime');
      // 2. コールバックを実行
      return callback(client);
    });
  };

  const dashboardService = new ExecutiveDashboardService(db);
  const dashboardController = new ExecutiveDashboardController(dashboardService);
  const guard = new PermissionsGuard(new Reflector());

  console.log('=== P5-T1 横断KPIダッシュボード基盤 実DB E2E検証開始 (RLS/app_runtime検証) ===');

  try {
    // --------------------------------------------------------------------------
    // 1. テナント・ユーザー初期化 (Tenant A, B, C)
    // --------------------------------------------------------------------------
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const tenantC = randomUUID();

    const userA = randomUUID();
    const userB = randomUUID();
    const userC = randomUUID();

    console.log(`[1] テナント初期化: Tenant A=${tenantA}, Tenant B=${tenantB}, Tenant C(空)=${tenantC}`);

    await pool.query(`INSERT INTO tenants (id, name, is_active) VALUES ($1, 'Tenant A Exec', true)`, [tenantA]);
    await pool.query(`INSERT INTO tenants (id, name, is_active) VALUES ($1, 'Tenant B Exec', true)`, [tenantB]);
    await pool.query(`INSERT INTO tenants (id, name, is_active) VALUES ($1, 'Tenant C Exec', true)`, [tenantC]);

    await pool.query(
      `INSERT INTO users (id, email, password_hash, name, created_at, updated_at) VALUES
       ($1, 'exec_a@test.com', 'hash', 'Exec User A', NOW(), NOW()),
       ($2, 'exec_b@test.com', 'hash', 'Exec User B', NOW(), NOW()),
       ($3, 'exec_c@test.com', 'hash', 'Exec User C', NOW(), NOW())`,
      [userA, userB, userC],
    );

    await pool.query(`INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2), ($3, $4), ($5, $6)`, [
      tenantA, userA,
      tenantB, userB,
      tenantC, userC,
    ]);

    // 顧客マスタ (customers) 登録
    const customerA = randomUUID();
    const customerB = randomUUID();
    await pool.query(
      `INSERT INTO customers (id, tenant_id, code, name, created_at, updated_at) VALUES
       ($1, $2, 'CUST-A', 'Customer A', NOW(), NOW()),
       ($3, $4, 'CUST-B', 'Customer B', NOW(), NOW())`,
      [customerA, tenantA, customerB, tenantB],
    );

    // --------------------------------------------------------------------------
    // 2. テストデータ投入: Tenant A
    // --------------------------------------------------------------------------
    console.log('[2] Tenant A テストデータ投入 (各業務ドメイン)');

    // (1) 承認依頼 (approval_requests)
    // - contract: 1件 pending
    // - purchase_request: 2件 pending
    // - general_request: 1件 pending
    await pool.query(
      `INSERT INTO approval_requests (id, tenant_id, target_type, target_id, total_steps, current_step, status, submitted_by) VALUES
       ($1, $2, 'contract', $3, 1, 1, 'pending', $4),
       ($5, $2, 'purchase_request', $6, 1, 1, 'pending', $4),
       ($7, $2, 'purchase_request', $8, 1, 1, 'pending', $4),
       ($9, $2, 'general_request', $10, 1, 1, 'pending', $4)`,
      [
        randomUUID(), tenantA, randomUUID(), userA,
        randomUUID(), randomUUID(),
        randomUUID(), randomUUID(),
        randomUUID(), randomUUID(),
      ],
    );

    // (2) 契約書 (contracts)
    // - 1件目: 15日後満了 (notice_days=30 => expiring_soon, within_30, within_60)
    // - 2件目: 45日後満了 (notice_days=30 => notice期限外, within_60)
    // - 3件目: 180日後満了 (期限外)
    const contractA1 = randomUUID();
    const contractA2 = randomUUID();
    const contractA3 = randomUUID();

    await pool.query(
      `INSERT INTO contracts (id, tenant_id, contract_no, title, counterparty_name, contract_type, status, start_date, end_date, renewal_notice_days, created_by, created_at, updated_at) VALUES
       ($1, $2, 'CNT-A-01', '契約A1 (15日後)', 'Client A1', 'service', 'active', CURRENT_DATE - interval '300 days', CURRENT_DATE + interval '15 days', 30, $5, NOW(), NOW()),
       ($3, $2, 'CNT-A-02', '契約A2 (45日後)', 'Client A1', 'service', 'active', CURRENT_DATE - interval '300 days', CURRENT_DATE + interval '45 days', 30, $5, NOW(), NOW()),
       ($4, $2, 'CNT-A-03', '契約A3 (180日後)', 'Client A1', 'service', 'active', CURRENT_DATE - interval '300 days', CURRENT_DATE + interval '180 days', 30, $5, NOW(), NOW())`,
      [contractA1, tenantA, contractA2, contractA3, userA],
    );

    // (3) 購買申請 (purchase_requests)
    // - 1件目: pending_approval 300,000円
    // - 2件目: active 500,000円 (当月発注額 & 検収待ち)
    await pool.query(
      `INSERT INTO purchase_requests (id, tenant_id, request_no, title, supplier_name, item_description, quantity, unit_price, total_amount, status, created_by, created_at, updated_at) VALUES
       ($1, $2, 'PR-A-01', '購買A1 稟議中', 'Supplier A', 'Item 1', 1, 300000, 300000, 'pending_approval', $3, NOW(), NOW()),
       ($4, $2, 'PR-A-02', '購買A2 発注済', 'Supplier A', 'Item 2', 1, 500000, 500000, 'active', $3, NOW(), NOW())`,
      [randomUUID(), tenantA, userA, randomUUID()],
    );

    // (4) 従業員・勤怠 (employees, attendance_records)
    const empA1 = randomUUID();
    const empA2 = randomUUID();
    await pool.query(
      `INSERT INTO employees (id, tenant_id, employee_no, name, hire_date, status) VALUES
       ($1, $2, 'EMP-A-01', '山田 太郎', '2025-01-01', 'active'),
       ($3, $2, 'EMP-A-02', '佐藤 花子', '2025-01-01', 'active')`,
      [empA1, tenantA, empA2],
    );

    // 勤怠1: 本日出勤・未退勤 (unresolved_attendance)
    // 勤怠2: 当月残業50時間・申請中 (pending_attendance & overtime_alert)
    await pool.query(
      `INSERT INTO attendance_records (id, tenant_id, employee_id, work_date, clock_in, clock_out, status, overtime_hours) VALUES
       ($1, $2, $3, CURRENT_DATE, now() - interval '4 hours', NULL, 'draft', 0),
       ($4, $2, $5, CURRENT_DATE - interval '1 day', now() - interval '10 hours', now() - interval '2 hours', 'submitted', 50)`,
      [randomUUID(), tenantA, empA1, randomUUID(), empA2],
    );

    // (5) 営業・商談・見積・契約更新リンク (deals, quotations, contract_renewal_links)
    const dealWonA1 = randomUUID();
    const dealLostA1 = randomUUID();
    const dealOpenA1 = randomUUID();

    await pool.query(
      `INSERT INTO deals (id, tenant_id, customer_id, title, stage, expected_amount, lost_reason, created_by) VALUES
       ($1, $2, $3, '提案中商談', 'proposal', 1000000, NULL, $4),
       ($5, $2, $3, '受注商談', 'won', 2000000, NULL, $4),
       ($6, $2, $3, '失注商談', 'lost', 500000, '予算都合', $4)`,
      [dealOpenA1, tenantA, customerA, userA, dealWonA1, dealLostA1],
    );

    // 見積: sent 1件, accepted 1件
    await pool.query(
      `INSERT INTO quotations (id, tenant_id, customer_id, deal_id, quote_no, title, status, subtotal, tax_amount, created_by, created_at, updated_at) VALUES
       ($1, $2, $3, $4, 'QT-A-01', '見積A1', 'sent', 909091, 90909, $5, NOW(), NOW()),
       ($6, $2, $3, $7, 'QT-A-02', '見積A2', 'accepted', 1818182, 181818, $5, NOW(), NOW())`,
      [randomUUID(), tenantA, customerA, dealOpenA1, userA, randomUUID(), dealWonA1],
    );

    // 契約更新リンク: contractA1(15日後満了) に紐付け
    await pool.query(
      `INSERT INTO contract_renewal_links (id, tenant_id, contract_id, deal_id, created_by) VALUES
       ($1, $2, $3, $4, $5)`,
      [randomUUID(), tenantA, contractA1, dealOpenA1, userA],
    );

    // --------------------------------------------------------------------------
    // 3. テストデータ投入: Tenant B (巨大金額・混入防止検証用)
    // --------------------------------------------------------------------------
    console.log('[3] Tenant B テストデータ投入 (他テナント分離検証用)');

    // 承認依頼 10件
    await pool.query(
      `INSERT INTO approval_requests (id, tenant_id, target_type, target_id, total_steps, current_step, status, submitted_by) VALUES
       ($1, $2, 'contract', $3, 1, 1, 'pending', $4)`,
      [randomUUID(), tenantB, randomUUID(), userB],
    );

    // 契約 999件
    const contractB1 = randomUUID();
    await pool.query(
      `INSERT INTO contracts (id, tenant_id, contract_no, title, counterparty_name, contract_type, status, start_date, end_date, renewal_notice_days, created_by, created_at, updated_at) VALUES
       ($1, $2, 'CNT-B-01', '契約B (超高額)', 'Client B', 'service', 'active', CURRENT_DATE - interval '300 days', CURRENT_DATE + interval '10 days', 30, $3, NOW(), NOW())`,
      [contractB1, tenantB, userB],
    );

    // 購買 999,999,999円
    await pool.query(
      `INSERT INTO purchase_requests (id, tenant_id, request_no, title, supplier_name, item_description, quantity, unit_price, total_amount, status, created_by, created_at, updated_at) VALUES
       ($1, $2, 'PR-B-01', '購買B 巨大金額', 'Supplier B', 'Item B', 1, 999999999, 999999999, 'pending_approval', $3, NOW(), NOW())`,
      [randomUUID(), tenantB, userB],
    );

    // 従業員
    await pool.query(
      `INSERT INTO employees (id, tenant_id, employee_no, name, hire_date, status) VALUES
       ($1, $2, 'EMP-B-01', 'テナントB 従業員', '2025-01-01', 'active')`,
      [randomUUID(), tenantB],
    );

    // 商談 888,888,888円
    const dealB1 = randomUUID();
    await pool.query(
      `INSERT INTO deals (id, tenant_id, customer_id, title, stage, expected_amount, created_by) VALUES
       ($1, $2, $3, '商談B 巨大金額', 'won', 888888888, $4)`,
      [dealB1, tenantB, customerB, userB],
    );

    // --------------------------------------------------------------------------
    // 4. 【BLOCKER-01対応】RLSコンテキストおよび app_runtime ロールの実証
    // --------------------------------------------------------------------------
    console.log('[4] RLSコンテキストおよび app_runtime ロールの接続実証');
    await db.transaction(tenantA, userA, async (txClient) => {
      const roleCheck = await txClient.query<{ current_user: string; session_user: string }>(
        'SELECT current_user, session_user',
      );
      expect(roleCheck.rows[0].current_user).toBe('app_runtime');
      console.log(`  -> 実行ロール実証: current_user=${roleCheck.rows[0].current_user} (RLS適用対象ロールであることを確認)`);

      const tenantCheck = await txClient.query<{ tenant_id: string }>(
        `SELECT current_setting('app.current_tenant_id', true) AS tenant_id`,
      );
      expect(tenantCheck.rows[0].tenant_id).toBe(tenantA);
      console.log(`  -> テナントコンテキスト実証: app.current_tenant_id=${tenantCheck.rows[0].tenant_id}`);
    });

    // --------------------------------------------------------------------------
    // 4-1. RLSによる他テナントデータ直接不可視検証 (app_runtime下でのDB最終防御実証)
    // --------------------------------------------------------------------------
    console.log('[4-1] RLSによる他テナントデータ直接不可視検証 (app_runtime下でのDB最終防御実証)');
    await db.transaction(tenantA, userA, async (txClient) => {
      // Tenant B の商談が不可視
      const rlsDeals = await txClient.query(`SELECT * FROM deals WHERE id = $1`, [dealB1]);
      expect(rlsDeals.rows.length).toBe(0);

      // Tenant B の契約が不可視
      const rlsContracts = await txClient.query(`SELECT * FROM contracts WHERE id = $1`, [contractB1]);
      expect(rlsContracts.rows.length).toBe(0);

      // Tenant B の購買が不可視
      const rlsPR = await txClient.query(`SELECT * FROM purchase_requests WHERE request_no = 'PR-B-01'`);
      expect(rlsPR.rows.length).toBe(0);
    });
    console.log('  -> RLS実効実証: app_runtime ロール下で Tenant B の商談・契約・購買が直接不可視 (0件) であることを確認');

    // --------------------------------------------------------------------------
    // 5. Tenant A 集計API実行 & 計算整合性検証 (app_runtime / RLS経由)
    // --------------------------------------------------------------------------
    console.log('[5] Tenant A 横断KPI集計API実行 & 計算整合性検証');
    const summaryA = await dashboardService.getSummary(tenantA, userA, ['owner']);

    // (1) 承認ワークフロー
    expect(summaryA.approvals?.pending_total_count).toBe(4);
    expect(summaryA.approvals?.pending_by_target.contract).toBe(1);
    expect(summaryA.approvals?.pending_by_target.purchase_request).toBe(2);
    expect(summaryA.approvals?.pending_by_target.general_request).toBe(1);
    console.log('  -> (1) 承認ワークフローKPI: 整合確認 (pending_total=4, contract=1, PR=2, general=1)');

    // (2) 契約・更新期限
    expect(summaryA.contracts?.active_contracts_count).toBe(3);
    expect(summaryA.contracts?.expiring_soon_count).toBe(1); // 15日後のみ
    expect(summaryA.contracts?.expiring_within_30_days).toBe(1); // 15日後のみ
    expect(summaryA.contracts?.expiring_within_60_days).toBe(2); // 15日後 + 45日後
    console.log('  -> (2) 契約更新KPI: 整合確認 (active=3, expiring_soon=1, 30d=1, 60d=2)');

    // (3) 購買
    expect(summaryA.purchase?.pending_approval_count).toBe(1);
    expect(summaryA.purchase?.pending_approval_amount).toBe(300000);
    expect(summaryA.purchase?.current_month_order_amount).toBe(500000);
    expect(summaryA.purchase?.pending_receipts_count).toBe(1);
    console.log('  -> (3) 購買KPI: 整合確認 (pending=1件/30万円, order_amount=50万円, receipt=1件)');

    // (4) 人事労務
    expect(summaryA.hr?.active_employees_count).toBe(2);
    expect(summaryA.hr?.unresolved_attendance_count).toBe(1);
    expect(summaryA.hr?.pending_attendance_approvals).toBe(1);
    expect(summaryA.hr?.overtime_alert_count).toBe(1);
    console.log('  -> (4) 人事労務KPI: 整合確認 (active_emp=2, 未退勤=1, 申請中=1, 残業超過=1)');

    // (5) 営業
    expect(summaryA.sales?.open_deals_count).toBe(1);
    expect(summaryA.sales?.open_deals_amount).toBe(1000000);
    expect(summaryA.sales?.win_rate).toBeCloseTo(0.5, 4); // won 1 / (won 1 + lost 1)
    expect(summaryA.sales?.quotation_conversion_rate).toBeCloseTo(0.5, 4); // accepted 1 / (sent 1 + accepted 1)
    expect(summaryA.sales?.renewal_proposal_rate).toBeCloseTo(1.0, 4); // 1 / 1
    console.log('  -> (5) 営業KPI: 整合確認 (open=1件/100万円, 勝率=50%, 成約率=50%, 起票率=100%)');

    // --------------------------------------------------------------------------
    // 6. テナント分離検証 (Tenant B の巨大データ混入なし)
    // --------------------------------------------------------------------------
    console.log('[6] テナント分離検証 (Tenant B の巨大データ混入なし)');
    expect(summaryA.purchase?.pending_approval_amount).toBe(300000); // Bの999,999,999円が混入していない
    expect(summaryA.sales?.open_deals_amount).toBe(1000000); // Bの888,888,888円が混入していない
    expect(summaryA.hr?.active_employees_count).toBe(2); // Bの従業員が混入していない
    console.log('  -> Tenant B の巨大データが一切混入していないことを確認');

    // --------------------------------------------------------------------------
    // 7. ゼロ除算安全性 (Tenant C: 空テナント)
    // --------------------------------------------------------------------------
    console.log('[7] ゼロ除算安全性検証 (Tenant C: 空テナント)');
    const summaryC = await dashboardService.getSummary(tenantC, userC, ['owner']);
    expect(summaryC.approvals?.pending_total_count).toBe(0);
    expect(summaryC.contracts?.active_contracts_count).toBe(0);
    expect(summaryC.purchase?.pending_approval_amount).toBe(0);
    expect(summaryC.hr?.active_employees_count).toBe(0);
    expect(summaryC.sales?.win_rate).toBe(0);
    expect(summaryC.sales?.quotation_conversion_rate).toBe(0);
    expect(summaryC.sales?.renewal_proposal_rate).toBe(0);
    console.log('  -> 空データ時でも NaN/Infinity/エラーなく 0 を安全返却することを確認');

    // --------------------------------------------------------------------------
    // 8. RBAC 多層防御・ドメイン別二重認可検証
    // --------------------------------------------------------------------------
    console.log('[8] RBAC 多層防御・ドメイン別二重認可検証');

    // (1) dashboard.executive_view を持たないロールの遮断
    let employeeBlocked = false;
    try {
      await dashboardService.getSummary(tenantA, userA, ['employee']);
    } catch (err: any) {
      if (err instanceof AppException && err.getStatus() === 403) {
        employeeBlocked = true;
      }
    }
    expect(employeeBlocked).toBe(true);

    let externalBlocked = false;
    try {
      await dashboardService.getSummary(tenantA, userA, ['viewer_external']);
    } catch (err: any) {
      if (err instanceof AppException && err.getStatus() === 403) {
        externalBlocked = true;
      }
    }
    expect(externalBlocked).toBe(true);

    // PermissionsGuard レベルでの遮断確認
    const employeeCtx = createMockContext(dashboardController.getSummary, ['employee'], tenantA, userA);
    let guardBlocked = false;
    try {
      guard.canActivate(employeeCtx);
    } catch (err: any) {
      if (err instanceof AppException && err.getStatus() === 403) {
        guardBlocked = true;
      }
    }
    expect(guardBlocked).toBe(true);
    console.log('  -> PermissionsGuard & Service層: employee / viewer_external を 403 遮断');

    // (2) ドメイン別部分返却検証: legal_admin は労務権限を持たないため hr: null
    const summaryLegal = await dashboardService.getSummary(tenantA, userA, ['legal_admin']);
    expect(summaryLegal.contracts).not.toBeNull();
    expect(summaryLegal.approvals).not.toBeNull();
    expect(summaryLegal.sales).not.toBeNull();
    expect(summaryLegal.hr).toBeNull(); // 労務権限なしのため null
    expect(summaryLegal.available_domains.includes('hr')).toBe(false);
    console.log('  -> legal_admin: 労務権限なしのため hr: null となることを確認 (情報推測防止)');

    // (3) ドメイン別部分返却検証: payroll_admin は契約・購買・営業権限を持たない
    const summaryPayroll = await dashboardService.getSummary(tenantA, userA, ['payroll_admin']);
    expect(summaryPayroll.hr).not.toBeNull();
    expect(summaryPayroll.contracts).toBeNull();
    expect(summaryPayroll.purchase).toBeNull();
    expect(summaryPayroll.sales).toBeNull();
    expect(summaryPayroll.available_domains).toEqual(['hr']);
    console.log('  -> payroll_admin: 契約・購買・営業権限なしのため hr のみ返却されることを確認');

    // --------------------------------------------------------------------------
    // 9. 既存 WORM 不変性・データ破壊なし確認
    // --------------------------------------------------------------------------
    console.log('[9] 既存 WORM 不変性・データ破壊なし確認');
    const countCheck = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM approval_requests WHERE tenant_id = $1) AS approval_count,
         (SELECT COUNT(*) FROM contracts WHERE tenant_id = $1) AS contract_count,
         (SELECT COUNT(*) FROM purchase_requests WHERE tenant_id = $1) AS purchase_count,
         (SELECT COUNT(*) FROM employees WHERE tenant_id = $1) AS employee_count,
         (SELECT COUNT(*) FROM deals WHERE tenant_id = $1) AS deal_count`,
      [tenantA],
    );
    expect(Number(countCheck.rows[0].approval_count)).toBe(4);
    expect(Number(countCheck.rows[0].contract_count)).toBe(3);
    expect(Number(countCheck.rows[0].purchase_count)).toBe(2);
    expect(Number(countCheck.rows[0].employee_count)).toBe(2);
    expect(Number(countCheck.rows[0].deal_count)).toBe(3);
    console.log('  -> 集計実行後も既存レコード件数・整合性が完全保持されていることを確認');

    console.log(`=== P5-T1 横断KPIダッシュボード基盤 実DB E2E検証 全項目合格 (ALL PASS: 全${totalAssertions}検証項目合格) ===`);
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('P5-T1 E2E Error:', err);
  process.exit(1);
});
