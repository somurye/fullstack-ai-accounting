import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { SalesDashboardService } from '../modules/sales-dashboard/sales-dashboard.service';
import { SalesDashboardController } from '../modules/sales-dashboard/sales-dashboard.controller';
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
    getClass: () => SalesDashboardController,
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
  return {
    toBe(expected: unknown) {
      totalAssertions++;
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
    toBeCloseTo(expected: number, precision = 2) {
      totalAssertions++;
      if (typeof actual !== 'number' || Math.abs(actual - expected) > Math.pow(10, -precision)) {
        throw new Error(`Expected ${actual} to be close to ${expected} (diff > 10^-${precision})`);
      }
    },
    toEqual(expected: unknown) {
      totalAssertions++;
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
  };
}

async function run() {
  const dsn = process.argv[2] || process.env.DATABASE_URL;
  if (!dsn) {
    console.error('Usage: ts-node verify-sales-dashboard-e2e.ts <database_dsn>');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dsn });
  const db = new DatabaseService();
  (db as any).pool = pool;

  // --------------------------------------------------------------------------
  // 【BLOCKER-01対応】DatabaseService.transaction に SET LOCAL ROLE app_runtime をフック
  // superuser (postgres) の RLS バイパスを防止し、正規の app_runtime ロール下で
  // app.current_tenant_id / app.current_user_id による RLS ポリシーを確実に発動させる
  // --------------------------------------------------------------------------
  const origRunTransaction = (db as any).runTransaction.bind(db);
  (db as any).runTransaction = async (tenantId: string | null, userId: string | null, callback: any) => {
    return origRunTransaction(tenantId, userId, async (client: any) => {
      // 1. RLS適用対象ロール app_runtime へ切り替え
      await client.query('SET LOCAL ROLE app_runtime');
      // 2. コールバック（SalesDashboardService の集計クエリ）を実行
      return callback(client);
    });
  };

  const dashboardService = new SalesDashboardService(db);
  const dashboardController = new SalesDashboardController(dashboardService);
  const guard = new PermissionsGuard(new Reflector());

  console.log('=== P4-T4 営業ダッシュボード・レポート 実DB E2E検証開始 (RLS/app_runtime検証強化) ===');

  try {
    // --------------------------------------------------------------------------
    // 1. テストデータセットアップ (Tenant A, Tenant B, Tenant C: 空テナント)
    // --------------------------------------------------------------------------
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const tenantC = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    const userC = randomUUID();

    console.log(`[1] テナント初期化: Tenant A=${tenantA}, Tenant B=${tenantB}, Tenant C=${tenantC}`);

    // テナント登録
    for (const t of [
      { id: tenantA, name: 'Sales Dash Co A' },
      { id: tenantB, name: 'Sales Dash Co B' },
      { id: tenantC, name: 'Sales Dash Co C (Empty)' },
    ]) {
      await pool.query(
        `INSERT INTO tenants (id, name, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())`,
        [t.id, t.name],
      );
    }

    // ユーザー登録 & テナント紐付け
    const timestamp = Date.now();
    for (const u of [
      { id: userA, tenant_id: tenantA, email: `sales-a-${timestamp}@example.com` },
      { id: userB, tenant_id: tenantB, email: `sales-b-${timestamp}@example.com` },
      { id: userC, tenant_id: tenantC, email: `sales-c-${timestamp}@example.com` },
    ]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, name, created_at, updated_at)
         VALUES ($1, $2, 'dummy_hash', 'Sales User', NOW(), NOW())`,
        [u.id, u.email],
      );
      await pool.query(
        `INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)`,
        [u.tenant_id, u.id],
      );
    }

    // ロール取得 & user_roles 登録
    const rolesRes = await pool.query(`SELECT id, code FROM roles WHERE code IN ('owner', 'employee', 'accountant', 'legal_admin', 'viewer_external')`);
    const roleMap = new Map<string, string>();
    for (const r of rolesRes.rows) {
      roleMap.set(r.code, r.id);
    }
    const empRoleId = roleMap.get('employee');
    if (empRoleId) {
      await pool.query(`INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)`, [tenantA, userA, empRoleId]);
      await pool.query(`INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)`, [tenantB, userB, empRoleId]);
      await pool.query(`INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)`, [tenantC, userC, empRoleId]);
    }

    // 顧客（customers）作成
    const customerA1 = randomUUID();
    const customerB1 = randomUUID();
    await pool.query(
      `INSERT INTO customers (id, tenant_id, code, name, is_active, created_at, updated_at)
       VALUES ($1, $2, 'CA1', 'Client A1', true, NOW(), NOW())`,
      [customerA1, tenantA],
    );
    await pool.query(
      `INSERT INTO customers (id, tenant_id, code, name, is_active, created_at, updated_at)
       VALUES ($1, $2, 'CB1', 'Client B1', true, NOW(), NOW())`,
      [customerB1, tenantB],
    );

    // --------------------------------------------------------------------------
    // 2. 商談（deals）データ登録
    // --------------------------------------------------------------------------
    console.log('[2] 商談（deals）データ作成');
    // Tenant A:
    // - lead: 2件 (100,000 + 200,000 = 300,000)
    // - qualified: 1件 (400,000)
    // - proposal: 1件 (500,000)
    // - negotiation: 1件 (800,000)
    // - won: 3件 (1,000,000 + 1,200,000 + 800,000 = 3,000,000)
    // - lost: 1件 (500,000)
    // 合計: 9件, 5,500,000円
    // open_deals (lead+qual+prop+nego): 5件, 2,000,000円
    // won: 3件 (3,000,000円), lost: 1件 (500,000円)
    // 勝率: 3 / (3 + 1) = 75.0%

    const dealWonA1 = randomUUID();
    const dealWonA2 = randomUUID();
    const dealWonA3 = randomUUID();
    const dealLostA1 = randomUUID();
    const dealLeadA1 = randomUUID();
    const dealLeadA2 = randomUUID();
    const dealQualA1 = randomUUID();
    const dealPropA1 = randomUUID();
    const dealNegoA1 = randomUUID();

    const dealsA = [
      { id: dealLeadA1, title: 'Lead 1', stage: 'lead', amount: 100000, lost_reason: null },
      { id: dealLeadA2, title: 'Lead 2', stage: 'lead', amount: 200000, lost_reason: null },
      { id: dealQualA1, title: 'Qual 1', stage: 'qualified', amount: 400000, lost_reason: null },
      { id: dealPropA1, title: 'Prop 1', stage: 'proposal', amount: 500000, lost_reason: null },
      { id: dealNegoA1, title: 'Nego 1', stage: 'negotiation', amount: 800000, lost_reason: null },
      { id: dealWonA1, title: 'Won 1', stage: 'won', amount: 1000000, lost_reason: null },
      { id: dealWonA2, title: 'Won 2', stage: 'won', amount: 1200000, lost_reason: null },
      { id: dealWonA3, title: 'Won 3', stage: 'won', amount: 800000, lost_reason: null },
      { id: dealLostA1, title: 'Lost 1', stage: 'lost', amount: 500000, lost_reason: '予算超過のため' },
    ];

    for (const d of dealsA) {
      await pool.query(
        `INSERT INTO deals (id, tenant_id, customer_id, title, stage, expected_amount, currency_code, expected_close_date, owner_user_id, lost_reason, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'JPY', CURRENT_DATE + interval '10 days', $7, $8, $7, NOW(), NOW())`,
        [d.id, tenantA, customerA1, d.title, d.stage, d.amount, userA, d.lost_reason],
      );
    }

    // Tenant B: 独立した商談 (混入確認用)
    const dealWonB1 = randomUUID();
    await pool.query(
      `INSERT INTO deals (id, tenant_id, customer_id, title, stage, expected_amount, currency_code, expected_close_date, owner_user_id, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, 'Tenant B Deal', 'won', 9999999, 'JPY', CURRENT_DATE, $4, $4, NOW(), NOW())`,
      [dealWonB1, tenantB, customerB1, userB],
    );

    // --------------------------------------------------------------------------
    // 3. 見積（quotations）データ登録
    // --------------------------------------------------------------------------
    console.log('[3] 見積（quotations）データ作成');
    // Tenant A:
    // - draft: 1件 (150,000)
    // - sent: 2件 (200,000 + 300,000 = 500,000)
    // - accepted: 3件 (600,000 + 700,000 + 800,000 = 2,100,000)
    // - rejected: 1件 (250,000)
    // - expired: 2件 (100,000 + 100,000 = 200,000)
    // 合計: 9件, 3,200,000円
    // actionable_count (sent + accepted + rejected + expired): 2 + 3 + 1 + 2 = 8件
    // 成約率: 3 / 8 = 37.5%

    const quotationsA = [
      { id: randomUUID(), num: `QT-${timestamp}-001`, status: 'draft', subtotal: 136363.64, tax: 13636.36 }, // total 150000
      { id: randomUUID(), num: `QT-${timestamp}-002`, status: 'sent', subtotal: 181818.18, tax: 18181.82 }, // total 200000
      { id: randomUUID(), num: `QT-${timestamp}-003`, status: 'sent', subtotal: 272727.27, tax: 27272.73 }, // total 300000
      { id: randomUUID(), num: `QT-${timestamp}-004`, status: 'accepted', subtotal: 545454.55, tax: 54545.45 }, // total 600000
      { id: randomUUID(), num: `QT-${timestamp}-005`, status: 'accepted', subtotal: 636363.64, tax: 63636.36 }, // total 700000
      { id: randomUUID(), num: `QT-${timestamp}-006`, status: 'accepted', subtotal: 727272.73, tax: 72727.27 }, // total 800000
      { id: randomUUID(), num: `QT-${timestamp}-007`, status: 'rejected', subtotal: 227272.73, tax: 22727.27 }, // total 250000
      { id: randomUUID(), num: `QT-${timestamp}-008`, status: 'expired', subtotal: 90909.09, tax: 9090.91 }, // total 100000
      { id: randomUUID(), num: `QT-${timestamp}-009`, status: 'expired', subtotal: 90909.09, tax: 9090.91 }, // total 100000
    ];

    for (const q of quotationsA) {
      await pool.query(
        `INSERT INTO quotations (id, tenant_id, customer_id, quote_no, title, issue_date, valid_until, status, subtotal, tax_amount, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'Quotation Title', CURRENT_DATE, CURRENT_DATE + interval '30 days', $5, $6, $7, $8, NOW(), NOW())`,
        [q.id, tenantA, customerA1, q.num, q.status, q.subtotal, q.tax, userA],
      );
    }

    // Tenant B: 独立した見積 (混入確認用)
    await pool.query(
      `INSERT INTO quotations (id, tenant_id, customer_id, quote_no, title, issue_date, valid_until, status, subtotal, tax_amount, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, 'QT-B-999', 'Tenant B Quotation', CURRENT_DATE, CURRENT_DATE + interval '30 days', 'accepted', 9090909.09, 909090.91, $4, NOW(), NOW())`,
      [randomUUID(), tenantB, customerB1, userB],
    );

    // --------------------------------------------------------------------------
    // 4. 契約（contracts）および契約更新連携（contract_renewal_links）データ登録
    // --------------------------------------------------------------------------
    console.log('[4] 契約および契約更新連携データ作成');
    // Tenant A:
    // P1-T4 アラート対象契約の条件:
    // status = 'active' AND end_date IS NOT NULL AND end_date <= CURRENT_DATE + renewal_notice_days AND end_date >= CURRENT_DATE
    // 契約1: active, end_date = CURRENT_DATE + 15 days, notice_days = 30 -> アラート対象 (リンクあり: dealWonA1)
    // 契約2: active, end_date = CURRENT_DATE + 20 days, notice_days = 30 -> アラート対象 (リンクあり: dealPropA1)
    // 契約3: active, end_date = CURRENT_DATE + 5 days, notice_days = 30 -> アラート対象 (リンクなし)
    // 契約4: active, end_date = CURRENT_DATE + 60 days, notice_days = 30 -> 期限到来前 (アラート対象外)
    // 契約5: terminated, end_date = CURRENT_DATE + 10 days -> 非active (アラート対象外)
    // -> アラート対象契約数: 3件 (契約1, 契約2, 契約3)
    // -> リンク作成済み契約数: 2件 (契約1, 契約2)
    // -> 起票率: 2 / 3 = 66.67%
    // -> リンク案件のステージ分布:
    //    won: 1件 (dealWonA1: 1,000,000円)
    //    proposal: 1件 (dealPropA1: 500,000円)
    //    total: 2件 (1,500,000円)

    const contract1 = randomUUID();
    const contract2 = randomUUID();
    const contract3 = randomUUID();
    const contract4 = randomUUID();
    const contract5 = randomUUID();

    // 契約1 (アラート対象・リンクあり)
    await pool.query(
      `INSERT INTO contracts (id, tenant_id, contract_no, title, counterparty_name, contract_type, status, start_date, end_date, renewal_notice_days, auto_renewal, contract_amount, created_by, created_at, updated_at)
       VALUES ($1, $2, 'CNT-A-001', 'Contract 1', 'Client A1', 'service', 'active', CURRENT_DATE - interval '1 year', CURRENT_DATE + interval '15 days', 30, false, 1200000, $3, NOW(), NOW())`,
      [contract1, tenantA, userA],
    );

    // 契約2 (アラート対象・リンクあり)
    await pool.query(
      `INSERT INTO contracts (id, tenant_id, contract_no, title, counterparty_name, contract_type, status, start_date, end_date, renewal_notice_days, auto_renewal, contract_amount, created_by, created_at, updated_at)
       VALUES ($1, $2, 'CNT-A-002', 'Contract 2', 'Client A1', 'service', 'active', CURRENT_DATE - interval '1 year', CURRENT_DATE + interval '20 days', 30, false, 600000, $3, NOW(), NOW())`,
      [contract2, tenantA, userA],
    );

    // 契約3 (アラート対象・リンクなし)
    await pool.query(
      `INSERT INTO contracts (id, tenant_id, contract_no, title, counterparty_name, contract_type, status, start_date, end_date, renewal_notice_days, auto_renewal, contract_amount, created_by, created_at, updated_at)
       VALUES ($1, $2, 'CNT-A-003', 'Contract 3', 'Client A1', 'service', 'active', CURRENT_DATE - interval '1 year', CURRENT_DATE + interval '5 days', 30, false, 800000, $3, NOW(), NOW())`,
      [contract3, tenantA, userA],
    );

    // 契約4 (期限遠い・アラート対象外)
    await pool.query(
      `INSERT INTO contracts (id, tenant_id, contract_no, title, counterparty_name, contract_type, status, start_date, end_date, renewal_notice_days, auto_renewal, contract_amount, created_by, created_at, updated_at)
       VALUES ($1, $2, 'CNT-A-004', 'Contract 4', 'Client A1', 'service', 'active', CURRENT_DATE - interval '1 year', CURRENT_DATE + interval '60 days', 30, false, 500000, $3, NOW(), NOW())`,
      [contract4, tenantA, userA],
    );

    // 契約5 (終了済・アラート対象外)
    await pool.query(
      `INSERT INTO contracts (id, tenant_id, contract_no, title, counterparty_name, contract_type, status, start_date, end_date, renewal_notice_days, auto_renewal, contract_amount, created_by, created_at, updated_at)
       VALUES ($1, $2, 'CNT-A-005', 'Contract 5', 'Client A1', 'service', 'terminated', CURRENT_DATE - interval '1 year', CURRENT_DATE + interval '10 days', 30, false, 300000, $3, NOW(), NOW())`,
      [contract5, tenantA, userA],
    );

    // contract_renewal_links 作成
    const link1 = randomUUID();
    const link2 = randomUUID();
    await pool.query(
      `INSERT INTO contract_renewal_links (id, tenant_id, contract_id, deal_id, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [link1, tenantA, contract1, dealWonA1, userA],
    );
    await pool.query(
      `INSERT INTO contract_renewal_links (id, tenant_id, contract_id, deal_id, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [link2, tenantA, contract2, dealPropA1, userA],
    );

    // Tenant B: 独立した契約 & リンク (混入確認用)
    const contractB1 = randomUUID();
    await pool.query(
      `INSERT INTO contracts (id, tenant_id, contract_no, title, counterparty_name, contract_type, status, start_date, end_date, renewal_notice_days, auto_renewal, contract_amount, created_by, created_at, updated_at)
       VALUES ($1, $2, 'CNT-B-001', 'Tenant B Contract', 'Client B1', 'service', 'active', CURRENT_DATE - interval '1 year', CURRENT_DATE + interval '10 days', 30, false, 10000000, $3, NOW(), NOW())`,
      [contractB1, tenantB, userB],
    );
    await pool.query(
      `INSERT INTO contract_renewal_links (id, tenant_id, contract_id, deal_id, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [randomUUID(), tenantB, contractB1, dealWonB1, userB],
    );

    // --------------------------------------------------------------------------
    // 5-0. 【BLOCKER-01対応】RLSコンテキストおよび app_runtime ロールの実証
    // --------------------------------------------------------------------------
    console.log('[5-0] RLSコンテキストおよび app_runtime ロールの接続実証');
    await db.transaction(tenantA, userA, async (txClient) => {
      // 実行ロールが app_runtime であることを検証
      const roleCheck = await txClient.query<{ current_user: string; session_user: string }>(
        'SELECT current_user, session_user',
      );
      expect(roleCheck.rows[0].current_user).toBe('app_runtime');
      console.log(`  -> 実行ロール実証: current_user=${roleCheck.rows[0].current_user} (RLS適用対象ロールであることを確認)`);

      // app.current_tenant_id が Tenant A であることを検証
      const tenantCheck = await txClient.query<{ tenant_id: string }>(
        `SELECT current_setting('app.current_tenant_id', true) AS tenant_id`,
      );
      expect(tenantCheck.rows[0].tenant_id).toBe(tenantA);
      console.log(`  -> テナントコンテキスト実証: app.current_tenant_id=${tenantCheck.rows[0].tenant_id}`);
    });

    // --------------------------------------------------------------------------
    // 5-1. 【BLOCKER-01対応】RLSによる他テナントデータの直接不可視検証 (DB最終防御)
    // app_runtime ロール下では WHERE tenant_id 句なしでも Tenant B のデータが 0件になることを実証
    // --------------------------------------------------------------------------
    console.log('[5-1] RLSによる他テナントデータ直接不可視検証 (app_runtime下でのDB最終防御実証)');
    await db.transaction(tenantA, userA, async (txClient) => {
      // Tenant B の商談 (dealWonB1: 9,999,999円) が Tenant A の RLS コンテキストから不可視であること
      const rlsDeals = await txClient.query(
        `SELECT * FROM deals WHERE id = $1`,
        [dealWonB1],
      );
      expect(rlsDeals.rows.length).toBe(0);

      // Tenant B の見積 (QT-B-999: 10,000,000円) が不可視であること
      const rlsQuotes = await txClient.query(
        `SELECT * FROM quotations WHERE quote_no = 'QT-B-999'`,
      );
      expect(rlsQuotes.rows.length).toBe(0);

      // Tenant B の契約 (CNT-B-001) が不可視であること
      const rlsContracts = await txClient.query(
        `SELECT * FROM contracts WHERE contract_no = 'CNT-B-001'`,
      );
      expect(rlsContracts.rows.length).toBe(0);

      // Tenant B の更新リンクが不可視であること
      const rlsLinks = await txClient.query(
        `SELECT * FROM contract_renewal_links WHERE contract_id = $1`,
        [contractB1],
      );
      expect(rlsLinks.rows.length).toBe(0);
    });
    console.log('  -> RLS実効実証: app_runtime ロール下で Tenant B の商談・見積・契約・更新リンクが不可視 (0件) であることを確認');

    // --------------------------------------------------------------------------
    // 5. Tenant A 集計結果の完全性・計算式検証 (正規 RLS コンテキスト経由)
    // --------------------------------------------------------------------------
    console.log('[5] Tenant A 集計API実行 & 計算整合性検証 (app_runtime / RLS経由)');
    const summaryA = await dashboardService.getSummary(tenantA, userA, ['employee']);

    // (1) 案件パイプライン検証
    console.log('  -> (1) 案件パイプライン検証');
    expect(summaryA.pipeline.lead.count).toBe(2);
    expect(summaryA.pipeline.lead.total_amount).toBe(300000);
    expect(summaryA.pipeline.qualified.count).toBe(1);
    expect(summaryA.pipeline.qualified.total_amount).toBe(400000);
    expect(summaryA.pipeline.proposal.count).toBe(1);
    expect(summaryA.pipeline.proposal.total_amount).toBe(500000);
    expect(summaryA.pipeline.negotiation.count).toBe(1);
    expect(summaryA.pipeline.negotiation.total_amount).toBe(800000);
    expect(summaryA.pipeline.won.count).toBe(3);
    expect(summaryA.pipeline.won.total_amount).toBe(3000000);
    expect(summaryA.pipeline.lost.count).toBe(1);
    expect(summaryA.pipeline.lost.total_amount).toBe(500000);

    expect(summaryA.pipeline.open_deals.count).toBe(5);
    expect(summaryA.pipeline.open_deals.total_amount).toBe(2000000);
    expect(summaryA.pipeline.won_deals.count).toBe(3);
    expect(summaryA.pipeline.won_deals.total_amount).toBe(3000000);
    expect(summaryA.pipeline.lost_deals.count).toBe(1);
    expect(summaryA.pipeline.lost_deals.total_amount).toBe(500000);
    expect(summaryA.pipeline.total_deals.count).toBe(9);
    expect(summaryA.pipeline.total_deals.total_amount).toBe(5500000);

    // 勝率: 3 / (3 + 1) = 0.75 (75.0%)
    expect(summaryA.pipeline.win_rate).toBeCloseTo(0.75, 2);

    // (2) 見積ステータス別集計検証
    console.log('  -> (2) 見積ステータス別集計検証');
    expect(summaryA.quotations.draft.count).toBe(1);
    expect(summaryA.quotations.draft.total_amount).toBe(150000);
    expect(summaryA.quotations.sent.count).toBe(2);
    expect(summaryA.quotations.sent.total_amount).toBe(500000);
    expect(summaryA.quotations.accepted.count).toBe(3);
    expect(summaryA.quotations.accepted.total_amount).toBe(2100000);
    expect(summaryA.quotations.rejected.count).toBe(1);
    expect(summaryA.quotations.rejected.total_amount).toBe(250000);
    expect(summaryA.quotations.expired.count).toBe(2);
    expect(summaryA.quotations.expired.total_amount).toBe(200000);

    expect(summaryA.quotations.total_quotations.count).toBe(9);
    expect(summaryA.quotations.total_quotations.total_amount).toBe(3200000);
    // 送信済以上 (sent:2 + accepted:3 + rejected:1 + expired:2) = 8件
    expect(summaryA.quotations.actionable_count).toBe(8);
    // 成約率: 3 / 8 = 0.375 (37.5%)
    expect(summaryA.quotations.conversion_rate).toBeCloseTo(0.375, 2);

    // (3) 契約更新連携進捗検証
    console.log('  -> (3) 契約更新連携進捗検証');
    expect(summaryA.renewals.expiring_contracts_count).toBe(3);
    expect(summaryA.renewals.linked_contracts_count).toBe(2);
    // 起票率: 2 / 3 = 0.6667 (66.67%)
    expect(summaryA.renewals.renewal_proposal_rate).toBeCloseTo(0.6667, 2);
    expect(summaryA.renewals.total_renewal_links_count).toBe(2);

    // リンク商談のステージ分布
    expect(summaryA.renewals.linked_deals_stage_distribution.won.count).toBe(1);
    expect(summaryA.renewals.linked_deals_stage_distribution.won.total_amount).toBe(1000000);
    expect(summaryA.renewals.linked_deals_stage_distribution.proposal.count).toBe(1);
    expect(summaryA.renewals.linked_deals_stage_distribution.proposal.total_amount).toBe(500000);
    expect(summaryA.renewals.linked_deals_stage_distribution.total.count).toBe(2);
    expect(summaryA.renewals.linked_deals_stage_distribution.total.total_amount).toBe(1500000);

    // --------------------------------------------------------------------------
    // 6. テナント分離（Multi-tenant Isolation）検証
    // --------------------------------------------------------------------------
    console.log('[6] テナント分離検証 (Tenant Bのデータ混入ゼロ確認)');
    // Tenant Bのデータ: deal 1件(9,999,999円), quotation 1件(10,000,000円), contract 1件(10,000,000円)
    // Tenant Aの集計にこれらが一切混ざっていないことを確認済み (上記検証で厳密値一致)
    const summaryB = await dashboardService.getSummary(tenantB, userB, ['accountant']);
    expect(summaryB.pipeline.won.count).toBe(1);
    expect(summaryB.pipeline.won.total_amount).toBe(9999999);
    expect(summaryB.pipeline.total_deals.count).toBe(1);
    expect(summaryB.quotations.accepted.count).toBe(1);
    expect(summaryB.quotations.accepted.total_amount).toBe(10000000);
    expect(summaryB.renewals.linked_contracts_count).toBe(1);
    expect(summaryB.renewals.total_renewal_links_count).toBe(1);
    console.log('  -> Tenant A / Tenant B の相互データ漏洩ゼロを確認');

    // --------------------------------------------------------------------------
    // 7. ゼロ除算安全処理（空テナント C での検証）
    // --------------------------------------------------------------------------
    console.log('[7] ゼロ除算安全処理検証 (Tenant C: 空テナント)');
    const summaryC = await dashboardService.getSummary(tenantC, userC, ['owner']);
    expect(summaryC.pipeline.total_deals.count).toBe(0);
    expect(summaryC.pipeline.total_deals.total_amount).toBe(0);
    expect(summaryC.pipeline.win_rate).toBe(0); // 0除算なし
    expect(summaryC.quotations.total_quotations.count).toBe(0);
    expect(summaryC.quotations.actionable_count).toBe(0);
    expect(summaryC.quotations.conversion_rate).toBe(0); // 0除算なし
    expect(summaryC.renewals.expiring_contracts_count).toBe(0);
    expect(summaryC.renewals.linked_contracts_count).toBe(0);
    expect(summaryC.renewals.renewal_proposal_rate).toBe(0); // 0除算なし
    expect(summaryC.renewals.linked_deals_stage_distribution.total.count).toBe(0);
    console.log('  -> 空データ時も NaN/Infinity やゼロ除算例外が発生せず 0 を安全返却することを確認');

    // --------------------------------------------------------------------------
    // 8. 個別エンドポイント (pipeline, quotations, renewals) の検証
    // --------------------------------------------------------------------------
    console.log('[8] 個別集計エンドポイントの動作検証');
    const pipelineOnly = await dashboardService.getPipelineSummary(tenantA, userA, ['employee']);
    expect(pipelineOnly.win_rate).toBeCloseTo(0.75, 2);
    const quotationsOnly = await dashboardService.getQuotationSummary(tenantA, userA, ['employee']);
    expect(quotationsOnly.conversion_rate).toBeCloseTo(0.375, 2);
    const renewalsOnly = await dashboardService.getRenewalSummary(tenantA, userA, ['employee']);
    expect(renewalsOnly.renewal_proposal_rate).toBeCloseTo(0.6667, 2);

    // --------------------------------------------------------------------------
    // 9. RBAC 多層防御（Controller層 & Service層）
    // --------------------------------------------------------------------------
    console.log('[9] RBAC 多層防御（Controller & Service）検証');
    // (A) Service 層チェック: dashboard.view 権限を持たない viewer_external は 403 Forbidden
    let serviceRbacBlocked = false;
    try {
      await dashboardService.getSummary(tenantA, userA, ['viewer_external']);
    } catch (err: any) {
      if (err instanceof AppException && err.getStatus() === 403) {
        serviceRbacBlocked = true;
      }
    }
    expect(serviceRbacBlocked).toBe(true);
    console.log('  -> Service層: viewer_external ロールに対する 403 Forbidden 遮断を確認');

    // (B) Controller 層チェック: PermissionsGuard によるガード
    const forbiddenCtx = createMockContext(
      dashboardController.getSummary,
      ['viewer_external'],
      tenantA,
      userA,
    );
    let guardPassed = true;
    try {
      guardPassed = guard.canActivate(forbiddenCtx);
    } catch (err: any) {
      guardPassed = false;
    }
    expect(guardPassed).toBe(false);
    console.log('  -> Controller層: PermissionsGuard による viewer_external 遮断を確認');

    // (C) 正常系権限チェック: employee, accountant, legal_admin, owner
    for (const allowedRole of ['employee', 'accountant', 'legal_admin', 'owner']) {
      const allowedCtx = createMockContext(
        dashboardController.getSummary,
        [allowedRole],
        tenantA,
        userA,
      );
      const canAccess = guard.canActivate(allowedCtx);
      expect(canAccess).toBe(true);
    }
    console.log('  -> PermissionsGuard: employee, accountant, legal_admin, owner によるアクセス許可を確認');

    // --------------------------------------------------------------------------
    // 10. 既存 WORM 不変性・データの非破壊性確認
    // --------------------------------------------------------------------------
    console.log('[10] 既存 WORM 不変性確認 (集計実行によるデータ改ざん・重複ゼロの確認)');
    const countCheck = await pool.query(
      `SELECT
         (SELECT count(*) FROM deals WHERE tenant_id = $1) as deal_count,
         (SELECT count(*) FROM quotations WHERE tenant_id = $1) as quotation_count,
         (SELECT count(*) FROM contracts WHERE tenant_id = $1) as contract_count,
         (SELECT count(*) FROM contract_renewal_links WHERE tenant_id = $1) as link_count`,
      [tenantA],
    );
    expect(Number(countCheck.rows[0].deal_count)).toBe(9);
    expect(Number(countCheck.rows[0].quotation_count)).toBe(9);
    expect(Number(countCheck.rows[0].contract_count)).toBe(5);
    expect(Number(countCheck.rows[0].link_count)).toBe(2);
    console.log(`=== P4-T4 営業ダッシュボード・レポート 実DB E2E検証 全項目合格 (ALL PASS: 全${totalAssertions}検証項目合格) ===`);
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('P4-T4 E2E Verification Failed:', err);
  process.exit(1);
});
