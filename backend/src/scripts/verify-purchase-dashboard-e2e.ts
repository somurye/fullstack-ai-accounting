import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PurchaseDashboardService } from '../modules/purchase-dashboard/purchase-dashboard.service';
import { PurchaseDashboardController } from '../modules/purchase-dashboard/purchase-dashboard.controller';
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
    getClass: () => PurchaseDashboardController,
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

function expect(actual: unknown) {
  return {
    toBe(expected: unknown) {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
    toEqual(expected: unknown) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
    toBeGreaterThan(expected: number) {
      if (typeof actual !== 'number' || actual <= expected) {
        throw new Error(`Expected ${actual} > ${expected}`);
      }
    },
    toBeLessThan(expected: number) {
      if (typeof actual !== 'number' || actual >= expected) {
        throw new Error(`Expected ${actual} < ${expected}`);
      }
    },
    toContain(expected: string) {
      if (typeof actual !== 'string' || !actual.includes(expected)) {
        throw new Error(`Expected string to contain ${expected}`);
      }
    },
  };
}

function addMonths(
  year: number,
  monthIndex0: number,
  delta: number,
): { year: number; monthIndex0: number; label: string; dateStr: string; receiptDateStr: string } {
  const total = year * 12 + monthIndex0 + delta;
  const y = Math.floor(total / 12);
  const m0 = ((total % 12) + 12) % 12;
  const mm = String(m0 + 1).padStart(2, '0');
  const label = `${y}-${mm}`;
  const dateStr = `${y}-${mm}-15T10:00:00Z`;
  const receiptDateStr = `${y}-${mm}-16`;
  return { year: y, monthIndex0: m0, label, dateStr, receiptDateStr };
}

async function run() {
  const dsn = process.argv[2] || process.env.DATABASE_URL;
  if (!dsn) {
    console.error('Usage: ts-node verify-purchase-dashboard-e2e.ts <database_dsn>');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dsn });
  const db = new DatabaseService();
  (db as any).pool = pool;
  const dashboardService = new PurchaseDashboardService(db);
  const dashboardController = new PurchaseDashboardController(dashboardService);
  const guard = new PermissionsGuard(new Reflector());

  console.log('=== P2-T4 購買ダッシュボード・レポート 実DB E2E検証開始 ===');

  try {
    // --------------------------------------------------------------------------
    // 1. テストデータセットアップ (Tenant A, Tenant B)
    // --------------------------------------------------------------------------
    console.log('1. テスト用テナント・ユーザー・マスタ・6ヶ月分発注データのセットアップ...');
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const userA_Owner = randomUUID();
    const userA_Viewer = randomUUID(); // purchase_request.view なし
    const userB_Owner = randomUUID();
    const supA1 = randomUUID();
    const supA2 = randomUUID();
    const supB1 = randomUUID();

    // 6ヶ月分の日付コンテキスト計算 (m-5 〜 m-0)
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonthIndex0 = now.getUTCMonth();

    const m0 = addMonths(currentYear, currentMonthIndex0, 0); // 当月
    const m1_prev = addMonths(currentYear, currentMonthIndex0, -1); // 1ヶ月前
    const m2_prev = addMonths(currentYear, currentMonthIndex0, -2); // 2ヶ月前
    const m3_prev = addMonths(currentYear, currentMonthIndex0, -3); // 3ヶ月前
    const m4_prev = addMonths(currentYear, currentMonthIndex0, -4); // 4ヶ月前
    const m5_prev = addMonths(currentYear, currentMonthIndex0, -5); // 5ヶ月前

    console.log(`   検証対象期間: ${m5_prev.label} 〜 ${m0.label} (計6ヶ月)`);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // テナント作成
      await client.query(
        `INSERT INTO tenants (id, name) VALUES ($1, 'Dashboard Test Tenant A'), ($2, 'Dashboard Test Tenant B')`,
        [tenantA, tenantB],
      );

      // ユーザー作成
      await client.query(
        `INSERT INTO users (id, email, password_hash, name) VALUES
         ($1, 'owner_a_${tenantA.slice(0, 8)}@example.com', 'hash', 'Owner A'),
         ($2, 'viewer_a_${tenantA.slice(0, 8)}@example.com', 'hash', 'Viewer A (No View Perm)'),
         ($3, 'owner_b_${tenantB.slice(0, 8)}@example.com', 'hash', 'Owner B')`,
        [userA_Owner, userA_Viewer, userB_Owner],
      );

      // tenant_users
      await client.query(
        `INSERT INTO tenant_users (tenant_id, user_id) VALUES
         ($1, $2), ($1, $3), ($4, $5)`,
        [tenantA, userA_Owner, userA_Viewer, tenantB, userB_Owner],
      );

      // ロール割り当て:
      // userA_Owner -> owner
      // userB_Owner -> owner
      // userA_Viewer -> なし（権限なし）
      await client.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_id)
         SELECT $1::uuid, $2::uuid, id FROM roles WHERE code = 'owner'
         UNION ALL
         SELECT $3::uuid, $4::uuid, id FROM roles WHERE code = 'owner'`,
        [tenantA, userA_Owner, tenantB, userB_Owner],
      );

      // 会計期間 (fiscal_years) - 過去6ヶ月から当月末までを確実に包括する年度を設定
      const fyStart = `${m5_prev.year}-01-01`;
      const fyEnd = `${currentYear}-12-31`;
      await client.query(
        `INSERT INTO fiscal_years (id, tenant_id, start_date, end_date, status) VALUES
         (gen_random_uuid(), $1::uuid, $3, $4, 'open'),
         (gen_random_uuid(), $2::uuid, $3, $4, 'open')`,
        [tenantA, tenantB, fyStart, fyEnd],
      );

      // サプライヤー作成
      await client.query(
        `INSERT INTO suppliers (id, tenant_id, name, created_by) VALUES
         ($1, $2, 'Supplier Alpha 1', $3),
         ($4, $2, 'Supplier Alpha 2', $3),
         ($5, $6, 'Supplier Beta 1', $7)`,
        [supA1, tenantA, userA_Owner, supA2, supB1, tenantB, userB_Owner],
      );

      // [m-5]: 2件 (active: 110k [SupA1], draft: 15k [SupA1]) -> active: 110k, total: 125k, count: 2
      const pr_m5_act = randomUUID();
      const pr_m5_drf = randomUUID();
      await client.query(
        `INSERT INTO purchase_requests (
           id, tenant_id, request_no, title, supplier_id, supplier_name,
           item_description, quantity, unit_price, total_amount, status, created_by, created_at
         ) VALUES
         ($1, $3, 'PR-M5-01', 'M5 Active', $4, 'Supplier Alpha 1', 'M5 Item 1', 11, 10000, 110000, 'active', $5, $6::timestamptz),
         ($2, $3, 'PR-M5-02', 'M5 Draft',  $4, 'Supplier Alpha 1', 'M5 Item 2', 3,  5000,  15000,  'draft',  $5, $6::timestamptz)`,
        [pr_m5_act, pr_m5_drf, tenantA, supA1, userA_Owner, m5_prev.dateStr],
      );
      // 過去のactiveは検収済みとする
      await client.query(
        `INSERT INTO purchase_receipts (tenant_id, purchase_request_id, received_quantity, received_date, received_by)
         VALUES ($1, $2, 11, $3, $4)`,
        [tenantA, pr_m5_act, m5_prev.receiptDateStr, userA_Owner],
      );

      // [m-4]: 2件 (active: 220k [SupA2], rejected: 25k [SupA2]) -> active: 220k, total: 245k, count: 2
      const pr_m4_act = randomUUID();
      const pr_m4_rej = randomUUID();
      await client.query(
        `INSERT INTO purchase_requests (
           id, tenant_id, request_no, title, supplier_id, supplier_name,
           item_description, quantity, unit_price, total_amount, status, created_by, created_at
         ) VALUES
         ($1, $3, 'PR-M4-01', 'M4 Active',   $4, 'Supplier Alpha 2', 'M4 Item 1', 22, 10000, 220000, 'active',   $5, $6::timestamptz),
         ($2, $3, 'PR-M4-02', 'M4 Rejected', $4, 'Supplier Alpha 2', 'M4 Item 2', 5,  5000,  25000,  'rejected', $5, $6::timestamptz)`,
        [pr_m4_act, pr_m4_rej, tenantA, supA2, userA_Owner, m4_prev.dateStr],
      );
      await client.query(
        `INSERT INTO purchase_receipts (tenant_id, purchase_request_id, received_quantity, received_date, received_by)
         VALUES ($1, $2, 22, $3, $4)`,
        [tenantA, pr_m4_act, m4_prev.receiptDateStr, userA_Owner],
      );

      // [m-3]: 2件 (active: 130k [SupA1], active: 140k [SupA2]) -> active: 270k, total: 270k, count: 2
      const pr_m3_act1 = randomUUID();
      const pr_m3_act2 = randomUUID();
      await client.query(
        `INSERT INTO purchase_requests (
           id, tenant_id, request_no, title, supplier_id, supplier_name,
           item_description, quantity, unit_price, total_amount, status, created_by, created_at
         ) VALUES
         ($1, $3, 'PR-M3-01', 'M3 Active 1', $4, 'Supplier Alpha 1', 'M3 Item 1', 13, 10000, 130000, 'active', $6, $7::timestamptz),
         ($2, $3, 'PR-M3-02', 'M3 Active 2', $5, 'Supplier Alpha 2', 'M3 Item 2', 14, 10000, 140000, 'active', $6, $7::timestamptz)`,
        [pr_m3_act1, pr_m3_act2, tenantA, supA1, supA2, userA_Owner, m3_prev.dateStr],
      );
      await client.query(
        `INSERT INTO purchase_receipts (tenant_id, purchase_request_id, received_quantity, received_date, received_by)
         VALUES ($1, $2, 13, $4, $5), ($1, $3, 14, $4, $5)`,
        [tenantA, pr_m3_act1, pr_m3_act2, m3_prev.receiptDateStr, userA_Owner],
      );

      // [m-2]: 2件 (active: 310k [SupA2], pending_approval: 40k [SupA1]) -> active: 310k, total: 350k, count: 2
      const pr_m2_act = randomUUID();
      const pr_m2_pnd = randomUUID();
      await client.query(
        `INSERT INTO purchase_requests (
           id, tenant_id, request_no, title, supplier_id, supplier_name,
           item_description, quantity, unit_price, total_amount, status, created_by, created_at
         ) VALUES
         ($1, $3, 'PR-M2-01', 'M2 Active',  $4, 'Supplier Alpha 2', 'M2 Item 1', 31, 10000, 310000, 'active',           $6, $7::timestamptz),
         ($2, $3, 'PR-M2-02', 'M2 Pending', $5, 'Supplier Alpha 1', 'M2 Item 2', 4,  10000, 40000,  'pending_approval', $6, $7::timestamptz)`,
        [pr_m2_act, pr_m2_pnd, tenantA, supA2, supA1, userA_Owner, m2_prev.dateStr],
      );
      await client.query(
        `INSERT INTO purchase_receipts (tenant_id, purchase_request_id, received_quantity, received_date, received_by)
         VALUES ($1, $2, 31, $3, $4)`,
        [tenantA, pr_m2_act, m2_prev.receiptDateStr, userA_Owner],
      );

      // [m-1]: 1件 (active: 180k [SupA2]) -> active: 180k, total: 180k, count: 1
      const pr_m1_act = randomUUID();
      await client.query(
        `INSERT INTO purchase_requests (
           id, tenant_id, request_no, title, supplier_id, supplier_name,
           item_description, quantity, unit_price, total_amount, status, created_by, created_at
         ) VALUES
         ($1, $2, 'PR-M1-01', 'M1 Active', $3, 'Supplier Alpha 2', 'M1 Item 1', 18, 10000, 180000, 'active', $4, $5::timestamptz)`,
        [pr_m1_act, tenantA, supA2, userA_Owner, m1_prev.dateStr],
      );
      await client.query(
        `INSERT INTO purchase_receipts (tenant_id, purchase_request_id, received_quantity, received_date, received_by)
         VALUES ($1, $2, 18, $3, $4)`,
        [tenantA, pr_m1_act, m1_prev.receiptDateStr, userA_Owner],
      );

      // ------------------------------------------------------------------------
      // [m-0] 当月発注申請作成 (Tenant A: 計6件) -> active: 600k, total: 760k, count: 6
      // ------------------------------------------------------------------------
      const prA_active_fully_received = randomUUID();
      const prA_active_partially_received = randomUUID();
      const prA_active_unreceived = randomUUID();
      const prA_draft = randomUUID();
      const prA_pending = randomUUID();
      const prA_rejected = randomUUID();

      await client.query(
        `INSERT INTO purchase_requests (
           id, tenant_id, request_no, title, supplier_id, supplier_name,
           item_description, quantity, unit_price, total_amount, status, created_by, created_at
         ) VALUES
         ($1, $7, 'PR-A-01', 'Active Fully Received',     $8,  'Supplier Alpha 1', 'Item 1', 10, 10000, 100000, 'active',           $9, $11::timestamptz),
         ($2, $7, 'PR-A-02', 'Active Partially Received', $8,  'Supplier Alpha 1', 'Item 2', 20, 10000, 200000, 'active',           $9, $11::timestamptz),
         ($3, $7, 'PR-A-03', 'Active Unreceived',         $10, 'Supplier Alpha 2', 'Item 3', 30, 10000, 300000, 'active',           $9, $11::timestamptz),
         ($4, $7, 'PR-A-04', 'Draft Request',             $10, 'Supplier Alpha 2', 'Item 4', 5,  10000, 50000,  'draft',            $9, $11::timestamptz),
         ($5, $7, 'PR-A-05', 'Pending Approval Request',  $8,  'Supplier Alpha 1', 'Item 5', 7,  10000, 70000,  'pending_approval', $9, $11::timestamptz),
         ($6, $7, 'PR-A-06', 'Rejected Request',          $8,  'Supplier Alpha 1', 'Item 6', 4,  10000, 40000,  'rejected',         $9, $11::timestamptz)`,
        [
          prA_active_fully_received,
          prA_active_partially_received,
          prA_active_unreceived,
          prA_draft,
          prA_pending,
          prA_rejected,
          tenantA,
          supA1,
          userA_Owner,
          supA2,
          m0.dateStr,
        ],
      );

      // 当月検収登録 (Tenant A)
      // PR-A-01: 数量10発注に対し10受領 (完全検収)
      await client.query(
        `INSERT INTO purchase_receipts (tenant_id, purchase_request_id, received_quantity, received_date, received_by)
         VALUES ($1, $2, 10, $3, $4)`,
        [tenantA, prA_active_fully_received, m0.receiptDateStr, userA_Owner],
      );
      // PR-A-02: 数量20発注に対し10受領 (一部検収中、残り10未受領)
      await client.query(
        `INSERT INTO purchase_receipts (tenant_id, purchase_request_id, received_quantity, received_date, received_by)
         VALUES ($1, $2, 10, $3, $4)`,
        [tenantA, prA_active_partially_received, m0.receiptDateStr, userA_Owner],
      );
      // PR-A-03: 検収なし (未検収)

      // ------------------------------------------------------------------------
      // 発注申請作成 (Tenant B: 1件, 999,999円)
      // ------------------------------------------------------------------------
      const prB1 = randomUUID();
      await client.query(
        `INSERT INTO purchase_requests (
           id, tenant_id, request_no, title, supplier_id, supplier_name,
           item_description, quantity, unit_price, total_amount, status, created_by, created_at
         ) VALUES
         ($1, $2, 'PR-B-01', 'Tenant B Large Order', $3, 'Supplier Beta 1', 'Item B', 1, 999999, 999999, 'active', $4, $5::timestamptz)`,
        [prB1, tenantB, supB1, userB_Owner, m0.dateStr],
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    console.log('  -> セットアップ完了');

    // --------------------------------------------------------------------------
    // 2. RBAC検証 (Controller層 & Service層)
    // --------------------------------------------------------------------------
    console.log('2. RBAC認可検証 (Controller & Service 二重チェック)...');

    // 2.1 Controller層: purchase_request.view を持たないユーザーからのアクセス拒否 (403 Forbidden)
    const mockCtxNoPerm = createMockContext(
      PurchaseDashboardController.prototype.getSummary,
      [], // ロールなし
      tenantA,
      userA_Viewer,
    );
    let controllerBlocked = false;
    try {
      const canActivate = await guard.canActivate(mockCtxNoPerm);
      if (!canActivate) {
        controllerBlocked = true;
      }
    } catch (e: any) {
      if (e instanceof AppException && e.getStatus() === 403) {
        controllerBlocked = true;
      }
    }
    expect(controllerBlocked).toBe(true);
    console.log('  [PASS] Controller層: PermissionsGuardによりpurchase_request.view未保持ユーザーを403拒否');

    // 2.2 Service層: purchase_request.view を持たないユーザーからの直接呼び出し拒否 (403 Forbidden)
    let serviceBlocked = false;
    try {
      await dashboardService.getSummary(tenantA, userA_Viewer, { supplier_limit: 5 });
    } catch (e: any) {
      if (e instanceof AppException && e.getStatus() === 403) {
        serviceBlocked = true;
      }
    }
    expect(serviceBlocked).toBe(true);
    console.log('  [PASS] Service層: assertUserPermissionによりpurchase_request.view未保持ユーザーを403拒否 (二重防御)');

    // --------------------------------------------------------------------------
    // 3. テナント完全分離実証 (Tenant A と Tenant B の集計完全独立性)
    // --------------------------------------------------------------------------
    console.log('3. テナント完全分離検証 (Tenant A vs Tenant B)...');

    const summaryA = await dashboardService.getSummary(tenantA, userA_Owner, { supplier_limit: 5 });
    const summaryB = await dashboardService.getSummary(tenantB, userB_Owner, { supplier_limit: 5 });

    // Tenant A に Tenant B の 999,999 円が混入していないこと
    expect(summaryA.amount_summary.current_month_active_amount).toBe(600000);
    expect(summaryA.amount_summary.current_month_total_amount).toBe(760000);
    expect(summaryA.amount_summary.current_period_active_amount).toBe(1690000);
    expect(summaryA.amount_summary.current_period_total_amount).toBe(1930000);

    // Tenant B に Tenant A の金額が混入していないこと
    expect(summaryB.amount_summary.current_month_active_amount).toBe(999999);
    expect(summaryB.amount_summary.current_month_total_amount).toBe(999999);
    expect(summaryB.amount_summary.current_period_active_amount).toBe(999999);
    expect(summaryB.amount_summary.current_period_total_amount).toBe(999999);

    // サプライヤーランキングに他テナントのサプライヤーが混入していないこと
    const supNamesA = summaryA.supplier_ranking.map((s) => s.supplier_name);
    if (supNamesA.includes('Supplier Beta 1')) {
      throw new Error('Tenant A ranking contains Tenant B supplier: Supplier Beta 1');
    }
    const supNamesB = summaryB.supplier_ranking.map((s) => s.supplier_name);
    if (supNamesB.some((name) => name.includes('Alpha'))) {
      throw new Error('Tenant B ranking contains Tenant A supplier!');
    }
    console.log('  [PASS] テナント完全分離: Tenant A と Tenant B の集計値・サプライヤーランキングが相互に完全遮断されていることを実証');

    // --------------------------------------------------------------------------
    // 4. ステータス別集計の正確性実証
    // --------------------------------------------------------------------------
    console.log('4. ステータス別件数・合計金額の検証...');
    expect(summaryA.status_counts.draft).toEqual({ count: 2, total_amount: 65000 });
    expect(summaryA.status_counts.pending_approval).toEqual({ count: 2, total_amount: 110000 });
    expect(summaryA.status_counts.active).toEqual({ count: 9, total_amount: 1690000 });
    expect(summaryA.status_counts.rejected).toEqual({ count: 2, total_amount: 65000 });
    expect(summaryA.status_counts.terminated).toEqual({ count: 0, total_amount: 0 });
    expect(summaryA.status_counts.total).toEqual({ count: 15, total_amount: 1930000 });
    console.log('  [PASS] ステータス別集計: draft, pending_approval, active, rejected, terminated, total の全件数・金額が正確に一致');

    // --------------------------------------------------------------------------
    // 5. サプライヤー別発注金額ランキングの検証
    // --------------------------------------------------------------------------
    console.log('5. サプライヤー別発注ランキングの検証...');
    // Active な発注:
    // SupA2: PR-M4-01(220k) + PR-M3-02(140k) + PR-M2-01(310k) + PR-M1-01(180k) + PR-A-03(300k) = 1,150,000 (5件)
    // SupA1: PR-M5-01(110k) + PR-M3-01(130k) + PR-A-01(100k) + PR-A-02(200k) = 540,000 (4件)
    expect(summaryA.supplier_ranking.length).toBe(2);
    expect(summaryA.supplier_ranking[0]).toEqual({
      supplier_id: supA2,
      supplier_name: 'Supplier Alpha 2',
      request_count: 5,
      total_amount: 1150000,
    });
    expect(summaryA.supplier_ranking[1]).toEqual({
      supplier_id: supA1,
      supplier_name: 'Supplier Alpha 1',
      request_count: 4,
      total_amount: 540000,
    });
    console.log('  [PASS] サプライヤー別ランキング: 金額降順ソートおよび件数が正確に算出されていることを実証');

    // --------------------------------------------------------------------------
    // 6. 検収待ち発注件数 (未検収 + 一部検収中) の検証
    // --------------------------------------------------------------------------
    console.log('6. 検収待ち発注件数の検証...');
    // Active な発注 9件のうち:
    // 過去5ヶ月の6件: すべて数量全数検収済み -> 対象外
    // 当月の3件:
    // PR-A-01: 10/10受領 (検収完了) -> 対象外
    // PR-A-02: 10/20受領 (一部検収中) -> partially_received
    // PR-A-03: 0/30受領 (完全未検収) -> unreceived
    expect(summaryA.pending_receipts.total_pending_receipt_count).toBe(2);
    expect(summaryA.pending_receipts.unreceived_count).toBe(1);
    expect(summaryA.pending_receipts.partially_received_count).toBe(1);
    console.log('  [PASS] 検収待ち集計: 未検収(1件)・一部検収中(1件)・合計検収待ち(2件)が正確に抽出されていることを実証');

    // --------------------------------------------------------------------------
    // 7. 今月 / 今期発注金額集計の検証
    // --------------------------------------------------------------------------
    console.log('7. 今月 / 今期発注金額集計の検証...');
    expect(summaryA.amount_summary.current_month_active_amount).toBe(600000);
    expect(summaryA.amount_summary.current_month_total_amount).toBe(760000);
    expect(summaryA.amount_summary.current_period_active_amount).toBe(1690000);
    expect(summaryA.amount_summary.current_period_total_amount).toBe(1930000);
    console.log('  [PASS] 今月・今期金額集計: 当月確定(600k)/当月全体(760k)、当期確定(1,690k)/当期全体(1,930k)が正確に集計されていることを実証');

    // --------------------------------------------------------------------------
    // 8. 【BLOCKER-01対応】直近6ヶ月月次推移 (monthly_trends) の厳密な値照合
    // --------------------------------------------------------------------------
    console.log('8. 直近6ヶ月の月次推移 (monthly_trends) の厳密値照合...');
    const trends = summaryA.monthly_trends;
    expect(trends.length).toBe(6);

    // 6ヶ月分それぞれの期待値定義 (全月で値が異なる)
    const expectedTrends = [
      { month: m5_prev.label, active_amount: 110000, total_amount: 125000, request_count: 2 },
      { month: m4_prev.label, active_amount: 220000, total_amount: 245000, request_count: 2 },
      { month: m3_prev.label, active_amount: 270000, total_amount: 270000, request_count: 2 },
      { month: m2_prev.label, active_amount: 310000, total_amount: 350000, request_count: 2 },
      { month: m1_prev.label, active_amount: 180000, total_amount: 180000, request_count: 1 },
      { month: m0.label,      active_amount: 600000, total_amount: 760000, request_count: 6 },
    ];

    for (let i = 0; i < 6; i++) {
      const exp = expectedTrends[i];
      const act = trends[i];
      if (!act || !exp) {
        throw new Error(`Monthly trend at index ${i} is missing`);
      }
      expect(act.month).toBe(exp.month);
      expect(act.active_amount).toBe(exp.active_amount);
      expect(act.total_amount).toBe(exp.total_amount);
      expect(act.request_count).toBe(exp.request_count);
      console.log(`     [Trend M${i - 5}] ${act.month}: active=${act.active_amount}円, total=${act.total_amount}円, count=${act.request_count}件 (PASS)`);
    }
    console.log('  [PASS] 月次推移検証: 6ヶ月分すべての月・確定発注額・全体申請額・件数の照合が完全に一致');

    // --------------------------------------------------------------------------
    // 9. 【BLOCKER-02対応】集計クエリのEXPLAIN ANALYZE & インデックス利用可能性の厳密実証
    // --------------------------------------------------------------------------
    console.log('9. 集計クエリのEXPLAIN ANALYZE実行時間計測 & インデックス利用可能性の厳密実証...');
    const explainClient = await pool.connect();
    try {
      // 9.1 実測パフォーマンス計測 (EXPLAIN ANALYZE, BUFFERS)
      const analyzeRes = await explainClient.query<{ 'QUERY PLAN': any }>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
         SELECT status, COUNT(*), SUM(total_amount)
         FROM purchase_requests
         WHERE tenant_id = $1
         GROUP BY status`,
        [tenantA],
      );
      const planData = analyzeRes.rows[0]?.['QUERY PLAN']?.[0];
      const executionTime = planData?.['Execution Time'];
      const planningTime = planData?.['Planning Time'];
      const actualRows = planData?.Plan?.['Actual Rows'];
      const sharedHitBlocks = planData?.Plan?.['Shared Hit Blocks'] ?? 0;

      console.log(`     実測Execution Time: ${executionTime} ms, Planning Time: ${planningTime} ms`);
      console.log(`     集計行数: ${actualRows} rows, Shared Hit Blocks: ${sharedHitBlocks}`);

      // 実行時間が50ms未満で瞬時に完了していることをアサーション
      expect(typeof executionTime).toBe('number');
      expect(executionTime).toBeLessThan(50.0);

      // 9.2 オプティマイザのインデックス利用可能性の実証 (SET LOCAL enable_seqscan = off)
      // 小規模テーブルでのSeq Scan選択に頼らず、オプティマイザが ix_purchase_requests_tenant_status を
      // 認識し、インデックススキャン可能であることを明示的に証明する
      await explainClient.query('BEGIN');
      await explainClient.query('SET LOCAL enable_seqscan = off');

      const indexExplainRes = await explainClient.query<{ 'QUERY PLAN': any }>(
        `EXPLAIN (FORMAT JSON)
         SELECT status, COUNT(*), SUM(total_amount)
         FROM purchase_requests
         WHERE tenant_id = $1
         GROUP BY status`,
        [tenantA],
      );
      await explainClient.query('ROLLBACK');

      const indexPlanStr = JSON.stringify(indexExplainRes.rows[0]?.['QUERY PLAN']);
      // 実行計画に ix_purchase_requests_tenant_status が含まれていることを厳密検証
      expect(indexPlanStr).toContain('ix_purchase_requests_tenant_status');
      if (!indexPlanStr.includes('Index Scan') && !indexPlanStr.includes('Bitmap')) {
        throw new Error(`Expected Index Scan or Bitmap Index Scan but got: ${indexPlanStr}`);
      }

      console.log('  [PASS] パフォーマンス検証: Execution Time 50ms未満の実測、および ix_purchase_requests_tenant_status インデックス適合性を実証');
    } finally {
      explainClient.release();
    }

    console.log('=== P2-T4 実DB E2E検証: 全テスト合格 ===');
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('P2-T4 E2E Verification Failed:', err);
  process.exit(1);
});
