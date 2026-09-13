import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { PurchaseRequestsService } from '../modules/purchase-requests/purchase-requests.service';
import { PurchaseRequestsController } from '../modules/purchase-requests/purchase-requests.controller';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { AppException } from '../common/exceptions/app.exception';
import { RequestContext } from '../common/context/request-context';

function createMockContext(
  handler: Function,
  roles: string[],
  tenantId: string,
  userId: string,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => PurchaseRequestsController,
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
    toHaveLength(expected: number) {
      const arr = actual as unknown[];
      if (!arr || arr.length !== expected) {
        throw new Error(`Expected length ${expected} but received ${arr ? arr.length : arr}`);
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error(`Expected null but got ${JSON.stringify(actual)}`);
      }
    },
    not: {
      toBeNull() {
        if (actual === null) {
          throw new Error(`Expected not null but got null`);
        }
      },
    },
  };
}

async function run() {
  const dsn = process.argv[2] || process.env.DATABASE_URL;
  if (!dsn) {
    console.error('Usage: ts-node verify-purchase-receipts-billing-e2e.ts <database_dsn>');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dsn });
  const db = new DatabaseService();
  (db as any).pool = pool;
  const auditLogs = new AuditLogsService(db);
  const prService = new PurchaseRequestsService(db, auditLogs);
  const prController = new PurchaseRequestsController(prService);
  const guard = new PermissionsGuard(new Reflector());

  console.log('=== P2-T3 発注〜検収〜請求の連携 実DB E2E検証開始 ===');

  try {
    // --------------------------------------------------------------------------
    // 1. テストデータセットアップ (Tenant A, Tenant B)
    // --------------------------------------------------------------------------
    console.log('1. テスト用テナント・ユーザー・マスタのセットアップ...');
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const userA_Owner = randomUUID();
    const userA_Employee = randomUUID();
    const userA_Accountant = randomUUID();
    const userA_Viewer = randomUUID();
    const userB_Owner = randomUUID();

    const vendorA = randomUUID();
    const vendorB = randomUUID();

    await pool.query(`INSERT INTO tenants (id, name) VALUES ($1, '検収検証テナントA'), ($2, '検収検証テナントB')`, [tenantA, tenantB]);

    await pool.query(
      `INSERT INTO users (id, email, password_hash, name) VALUES
       ($1, 'owner_a@test.com', 'hash', 'Tenant A Owner'),
       ($2, 'emp_a@test.com', 'hash', 'Tenant A Employee'),
       ($3, 'acct_a@test.com', 'hash', 'Tenant A Accountant'),
       ($4, 'viewer_a@test.com', 'hash', 'Tenant A Viewer'),
       ($5, 'owner_b@test.com', 'hash', 'Tenant B Owner')`,
      [userA_Owner, userA_Employee, userA_Accountant, userA_Viewer, userB_Owner],
    );

    await pool.query(
      `INSERT INTO tenant_users (tenant_id, user_id) VALUES
       ($1, $2), ($1, $3), ($1, $4), ($1, $5), ($6, $7)`,
      [tenantA, userA_Owner, userA_Employee, userA_Accountant, userA_Viewer, tenantB, userB_Owner],
    );

    // ロール割当 (owner, employee, accountant, viewer_external)
    const { rows: roles } = await pool.query<{ id: string; code: string }>('SELECT id, code FROM roles');
    const roleMap = new Map(roles.map((r) => [r.code, r.id]));

    await pool.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES
       ($1, $2, $3),
       ($4, $5, $6),
       ($7, $8, $9),
       ($10, $11, $12),
       ($13, $14, $15)`,
      [
        tenantA, userA_Owner, roleMap.get('owner'),
        tenantA, userA_Employee, roleMap.get('employee'),
        tenantA, userA_Accountant, roleMap.get('accountant'),
        tenantA, userA_Viewer, roleMap.get('viewer_external'),
        tenantB, userB_Owner, roleMap.get('owner'),
      ],
    );

    // 既存 vendor, tax_categories, accounts セットアップ
    await pool.query(
      `INSERT INTO vendors (id, tenant_id, code, name) VALUES
       ($1, $2, 'V-001', '株式会社仕入先A'),
       ($3, $4, 'V-002', '株式会社仕入先B')`,
      [vendorA, tenantA, vendorB, tenantB],
    );

    // 発注申請の準備:
    // pr1: active (数量 10, 単価 1,000, 金額 10,000)
    const pr1Id = randomUUID();
    await pool.query(
      `INSERT INTO purchase_requests (
         id, tenant_id, request_no, title, supplier_name, item_description,
         quantity, unit_price, total_amount, currency, status, created_by
       ) VALUES (
         $1, $2, 'PR-2026-T301', 'テスト発注1', 'テストサプライヤー', 'サーバーラック',
         10, 1000, 10000, 'JPY', 'active', $3
       )`,
      [pr1Id, tenantA, userA_Owner],
    );

    // pr2: draft (数量 5)
    const pr2Id = randomUUID();
    await pool.query(
      `INSERT INTO purchase_requests (
         id, tenant_id, request_no, title, supplier_name, item_description,
         quantity, unit_price, total_amount, currency, status, created_by
       ) VALUES (
         $1, $2, 'PR-2026-T302', '下書き発注2', 'テストサプライヤー', 'モニター',
         5, 2000, 10000, 'JPY', 'draft', $3
       )`,
      [pr2Id, tenantA, userA_Owner],
    );

    // prB: Tenant B の active 発注
    const prBId = randomUUID();
    await pool.query(
      `INSERT INTO purchase_requests (
         id, tenant_id, request_no, title, supplier_name, item_description,
         quantity, unit_price, total_amount, currency, status, created_by
       ) VALUES (
         $1, $2, 'PR-2026-TB01', 'テナントB発注', 'テナントBサプライヤー', '机',
         10, 500, 5000, 'JPY', 'active', $3
       )`,
      [prBId, tenantB, userB_Owner],
    );

    // 仕入請求書準備:
    // vb1: Tenant A
    const vb1Id = randomUUID();
    await pool.query(
      `INSERT INTO vendor_bills (
         id, tenant_id, bill_no, vendor_id, bill_date, due_date, status,
         subtotal_amount, tax_amount, created_by
       ) VALUES (
         $1, $2, 'VB-2026-0001', $3, '2026-09-15', '2026-10-31', 'draft',
         10000, 1000, $4
       )`,
      [vb1Id, tenantA, vendorA, userA_Owner],
    );

    // vbB: Tenant B
    const vbBId = randomUUID();
    await pool.query(
      `INSERT INTO vendor_bills (
         id, tenant_id, bill_no, vendor_id, bill_date, due_date, status,
         subtotal_amount, tax_amount, created_by
       ) VALUES (
         $1, $2, 'VB-2026-B001', $3, '2026-09-15', '2026-10-31', 'draft',
         5000, 500, $4
       )`,
      [vbBId, tenantB, vendorB, userB_Owner],
    );

    console.log('   -> [PASS] テストデータのセットアップ完了');

    // --------------------------------------------------------------------------
    // 2. active 発注への検収登録 & 部分納品 (正常系)
    // --------------------------------------------------------------------------
    console.log('2. active 発注への検収登録 & 部分納品 (正常系)...');
    // 1回目: 4個検収
    const rec1 = await prService.addReceipt(tenantA, userA_Employee, pr1Id, {
      received_quantity: 4,
      received_date: '2026-09-15',
      notes: '1回目分納 (4個)',
    });
    expect(rec1.received_quantity).toBe(4);
    expect(rec1.notes).toBe('1回目分納 (4個)');

    let detail1 = await prService.getById(tenantA, userA_Owner, pr1Id);
    expect(detail1.receipts).toHaveLength(1);
    expect(detail1.total_received_quantity).toBe(4);
    expect(detail1.remaining_quantity).toBe(6); // 10 - 4 = 6
    console.log('   -> [PASS] 1回目検収登録 (4個) 成功、残数 6個');

    // 2回目: 6個検収 (完納)
    const rec2 = await prService.addReceipt(tenantA, userA_Employee, pr1Id, {
      received_quantity: 6,
      received_date: '2026-09-16',
      notes: '2回目完納 (6個)',
    });
    expect(rec2.received_quantity).toBe(6);

    let detail2 = await prService.getById(tenantA, userA_Owner, pr1Id);
    expect(detail2.receipts).toHaveLength(2);
    expect(detail2.total_received_quantity).toBe(10);
    expect(detail2.remaining_quantity).toBe(0); // 10 - 10 = 0
    console.log('   -> [PASS] 2回目検収登録 (6個) 成功、完納 (残数 0個)');

    // --------------------------------------------------------------------------
    // 3. draft / pending_approval 等の非active発注への検収拒否 (状態一貫性)
    // --------------------------------------------------------------------------
    console.log('3. draft 状態の発注申請に対する検収登録拒否 (状態整合性検証)...');
    let draftError: any = null;
    try {
      await prService.addReceipt(tenantA, userA_Employee, pr2Id, {
        received_quantity: 1,
        received_date: '2026-09-15',
      });
    } catch (err) {
      draftError = err;
    }
    expect(draftError).not.toBeNull();
    console.log('   -> [PASS] Service層/DBトリガーで draft への検収登録が正しく拒否された');

    // --------------------------------------------------------------------------
    // 4. 発注数量超過の検収拒否 (数量整合性検証)
    // --------------------------------------------------------------------------
    console.log('4. 発注数量超過の検収登録拒否 (数量整合性検証)...');
    // すでに 10個完納済みの pr1 に対してさらに 1個追加検収を試行
    let overflowError: any = null;
    try {
      await prService.addReceipt(tenantA, userA_Employee, pr1Id, {
        received_quantity: 1,
        received_date: '2026-09-17',
      });
    } catch (err: any) {
      overflowError = err;
    }
    expect(overflowError).not.toBeNull();
    console.log('   -> [PASS] 発注数量 (10) を超える検収登録が DBトリガー (23514) で拒否された');

    // --------------------------------------------------------------------------
    // 5. 並行実行下での advisory lock による race condition 防止実証
    // --------------------------------------------------------------------------
    console.log('5. 並行実行下での advisory lock による数量超過 race condition 防止実証...');
    // 発注数量 10 の新規 active 発注申請を作成
    const prRaceId = randomUUID();
    await pool.query(
      `INSERT INTO purchase_requests (
         id, tenant_id, request_no, title, supplier_name, item_description,
         quantity, unit_price, total_amount, currency, status, created_by
       ) VALUES (
         $1, $2, 'PR-2026-RACE', 'レース検証発注', 'サプライヤー', '品目',
         10, 100, 1000, 'JPY', 'active', $3
       )`,
      [prRaceId, tenantA, userA_Owner],
    );

    const clientA = await pool.connect();
    const clientB = await pool.connect();

    try {
      await clientA.query('BEGIN');
      await clientB.query('BEGIN');

      // Tx A: 数量 6 の検収を INSERT (advisory lock を取得)
      await clientA.query(
        `INSERT INTO purchase_receipts (
           tenant_id, purchase_request_id, received_quantity, received_date, received_by
         ) VALUES ($1, $2, 6, '2026-09-15', $3)`,
        [tenantA, prRaceId, userA_Owner],
      );

      // Tx B: 並行して同一 purchase_request_id に対して数量 6 の検収 INSERT を非同期で開始
      // advisory lock により Tx A が COMMIT するまでブロックされる
      let bFinished = false;
      let bError: any = null;
      const bPromise = clientB
        .query(
          `INSERT INTO purchase_receipts (
             tenant_id, purchase_request_id, received_quantity, received_date, received_by
           ) VALUES ($1, $2, 6, '2026-09-15', $3)`,
          [tenantA, prRaceId, userA_Owner],
        )
        .then(() => {
          bFinished = true;
        })
        .catch((err) => {
          bError = err;
          bFinished = true;
        });

      // Tx A がロック保持中は Tx B が待機中であることを確認
      await new Promise((r) => setTimeout(r, 100));
      expect(bFinished).toBe(false);

      // Tx A を COMMIT してロック解放
      await clientA.query('COMMIT');

      // Tx B の完了待機
      await bPromise;
      if (bError) {
        await clientB.query('ROLLBACK');
      } else {
        await clientB.query('COMMIT');
      }

      // Tx B は直列化後に合計数量 12 > 10 を検知し、DBトリガーで 23514 で安全に遮断されること
      expect(bError).not.toBeNull();
      expect(bError.code).toBe('23514');
      console.log('   -> [PASS] 並行実行時: Tx Bが直列化され、数量超過 (12 > 10) を検知して 23514 で安全に遮断された');

      // 最終状態の確認: 検収は Tx A の 6個のみ記録されていること
      const { rows: raceReceipts } = await pool.query<{ received_quantity: string }>(
        'SELECT received_quantity FROM purchase_receipts WHERE purchase_request_id = $1',
        [prRaceId],
      );
      expect(raceReceipts).toHaveLength(1);
      expect(Number(raceReceipts[0].received_quantity)).toBe(6);
    } finally {
      clientA.release();
      clientB.release();
    }

    // --------------------------------------------------------------------------
    // 6. 他テナント越境の拒否 (DB 23503 トリガー保証)
    // --------------------------------------------------------------------------
    console.log('6. 他テナント越境の拒否 (DB 23503 トリガー保証)...');
    // Case A: Tenant A のコンテキストで Tenant B の purchase_request_id を指定
    let crossPrError: any = null;
    try {
      await pool.query(
        `INSERT INTO purchase_receipts (
           tenant_id, purchase_request_id, received_quantity, received_date, received_by
         ) VALUES ($1, $2, 1, '2026-09-15', $3)`,
        [tenantA, prBId, userA_Owner],
      );
    } catch (err: any) {
      crossPrError = err;
    }
    expect(crossPrError).not.toBeNull();
    expect(crossPrError.code).toBe('23503');
    console.log('   -> [PASS] 他テナントの purchase_request_id を指定した検収登録が DBトリガー (23503) で遮断された');

    // Case B: Tenant A のコンテキストで Tenant B のユーザー (userB_Owner) を received_by に指定
    let crossUserError: any = null;
    try {
      await pool.query(
        `INSERT INTO purchase_receipts (
           tenant_id, purchase_request_id, received_quantity, received_date, received_by
         ) VALUES ($1, $2, 1, '2026-09-15', $3)`,
        [tenantA, pr1Id, userB_Owner],
      );
    } catch (err: any) {
      crossUserError = err;
    }
    expect(crossUserError).not.toBeNull();
    expect(crossUserError.code).toBe('23503');
    console.log('   -> [PASS] 他テナントの received_by ユーザーを指定した検収登録が DBトリガー (23503) で遮断された');

    // --------------------------------------------------------------------------
    // 7. vendor_bills との紐付け & テナント整合性検証
    // --------------------------------------------------------------------------
    console.log('7. vendor_bills との紐付け & テナント整合性検証...');
    // 同一テナントの仕入請求書紐付け (正常系)
    await prService.linkVendorBill(tenantA, userA_Accountant, pr1Id, {
      vendor_bill_id: vb1Id,
    });

    const detailWithBill = await prService.getById(tenantA, userA_Owner, pr1Id);
    expect(detailWithBill.linked_vendor_bills).toHaveLength(1);
    expect(detailWithBill.linked_vendor_bills[0].id).toBe(vb1Id);
    expect(detailWithBill.linked_vendor_bills[0].bill_no).toBe('VB-2026-0001');
    console.log('   -> [PASS] 同一テナントの仕入請求書を正常に紐付け完了');

    // 他テナントの vendor_bill 紐付け試行 (DBトリガーで遮断)
    let crossVbError: any = null;
    try {
      await pool.query(
        `UPDATE vendor_bills SET purchase_request_id = $1 WHERE id = $2`,
        [pr1Id, vbBId], // Tenant A の pr1 を Tenant B の vbB に紐付けようとする
      );
    } catch (err: any) {
      crossVbError = err;
    }
    expect(crossVbError).not.toBeNull();
    expect(crossVbError.code).toBe('23503');
    console.log('   -> [PASS] 他テナントの vendor_bill 紐付けが DBトリガー (23503) で遮断された');

    // 紐付け解除
    await prService.unlinkVendorBill(tenantA, userA_Accountant, pr1Id, vb1Id);
    const detailUnlinked = await prService.getById(tenantA, userA_Owner, pr1Id);
    expect(detailUnlinked.linked_vendor_bills).toHaveLength(0);
    console.log('   -> [PASS] 仕入請求書の紐付け解除が正常に完了');

    // --------------------------------------------------------------------------
    // 8. RBAC 多層防御の検証
    // --------------------------------------------------------------------------
    console.log('8. RBAC 多層防御の検証...');
    // viewer_external は purchase_request.receive 権限を持たない -> 403
    let rbacReceiveErr: any = null;
    try {
      const ctx = createMockContext(
        prController.addReceipt,
        ['viewer_external'],
        tenantA,
        userA_Viewer,
      );
      guard.canActivate(ctx);
    } catch (err) {
      rbacReceiveErr = err;
    }
    expect(rbacReceiveErr).not.toBeNull();
    expect(rbacReceiveErr.getStatus()).toBe(403);
    console.log('   -> [PASS] purchase_request.receive 権限を持たない viewer_external による検収登録が Guard 層で 403 遮断された');

    // employee は purchase_request.link_bill 権限を持たない -> 403
    let rbacLinkErr: any = null;
    try {
      const ctx = createMockContext(
        prController.linkVendorBill,
        ['employee'],
        tenantA,
        userA_Employee,
      );
      guard.canActivate(ctx);
    } catch (err) {
      rbacLinkErr = err;
    }
    expect(rbacLinkErr).not.toBeNull();
    expect(rbacLinkErr.getStatus()).toBe(403);
    console.log('   -> [PASS] purchase_request.link_bill 権限を持たない employee による請求書紐付けが Guard 層で 403 遮断された');

    // accountant は purchase_request.link_bill 権限を持つ -> 許可
    const ctxAcct = createMockContext(
      prController.linkVendorBill,
      ['accountant'],
      tenantA,
      userA_Accountant,
    );
    expect(guard.canActivate(ctxAcct)).toBe(true);
    console.log('   -> [PASS] accountant ロールによる請求書紐付けが認可された');

    // --------------------------------------------------------------------------
    // 9. 改ざん防止 (WORM) トリガー検証
    // --------------------------------------------------------------------------
    // --------------------------------------------------------------------------
    // 9. 検収記録の改ざん・削除防止 (WORM) トリガー & 権限検証 (P2-T3-FIX)
    // --------------------------------------------------------------------------
    console.log('9. 検収記録の改ざん・削除防止 (WORM) トリガー & 権限検証...');
    // 9-1. UPDATE試行 -> 23514 で拒否
    let wormUpdateError: any = null;
    try {
      await pool.query(
        `UPDATE purchase_receipts SET received_quantity = 99 WHERE id = $1`,
        [rec1.id],
      );
    } catch (err: any) {
      wormUpdateError = err;
    }
    expect(wormUpdateError).not.toBeNull();
    expect(wormUpdateError.code).toBe('23514');
    console.log('   -> [PASS] purchase_receipts の UPDATE が DBトリガーで安全に遮断された (23514)');

    // 9-2. DELETE試行 (DBトリガーによる23514拒否: スーパーユーザー/トリガー検証)
    let wormDeleteError: any = null;
    try {
      await pool.query(
        `DELETE FROM purchase_receipts WHERE id = $1`,
        [rec1.id],
      );
    } catch (err: any) {
      wormDeleteError = err;
    }
    expect(wormDeleteError).not.toBeNull();
    expect(wormDeleteError.code).toBe('23514');
    console.log('   -> [PASS] purchase_receipts の DELETE が DBトリガーで安全に遮断された (23514)');

    // 9-3. app_runtime ロールでの DELETE 権限剥奪検証 (42501 / 23514)
    let appRuntimeDeleteError: any = null;
    await db.transaction(tenantA, userA_Owner, async (client) => {
      await client.query(`SET LOCAL ROLE app_runtime`);
      try {
        await client.query(
          `DELETE FROM purchase_receipts WHERE id = $1`,
          [rec1.id],
        );
      } catch (err: any) {
        appRuntimeDeleteError = err;
      }
    });
    expect(appRuntimeDeleteError).not.toBeNull();
    expect(appRuntimeDeleteError.code === '42501' || appRuntimeDeleteError.code === '23514').toBe(true);
    console.log('   -> [PASS] app_runtime ロールでの DELETE 試行が多層防御で安全に遮断された');

    // 9-4. 操作後もレコードが変更されずに残存していることの確認
    const { rows: survivingRows } = await pool.query<{ id: string; received_quantity: string }>(
      `SELECT id, received_quantity FROM purchase_receipts WHERE id = $1`,
      [rec1.id],
    );
    expect(survivingRows).toHaveLength(1);
    expect(Number(survivingRows[0].received_quantity)).toBe(4); // 作成時の数量4のまま無傷
    console.log('   -> [PASS] UPDATE/DELETE 試行後も検収レコードが改変・削除されずに完全に残存していることを確認');

    // --------------------------------------------------------------------------
    // 10. 完全テナント分離 (RLS)
    // --------------------------------------------------------------------------
    console.log('10. 完全テナント分離 (RLS) の検証...');
    await db.transaction(tenantA, userA_Owner, async (client) => {
      await client.query(`SET LOCAL ROLE app_runtime`);
      const { rows: aRows } = await client.query('SELECT id FROM purchase_receipts');
      expect(aRows.length >= 2).toBe(true);
    });

    await db.transaction(tenantB, userB_Owner, async (client) => {
      await client.query(`SET LOCAL ROLE app_runtime`);
      const { rows: bRows } = await client.query('SELECT id FROM purchase_receipts');
      // Tenant B からは Tenant A の検収記録が一切見えない
      expect(bRows).toHaveLength(0);
    });

    console.log('   -> [PASS] app_runtime ロールで他テナントの検収記録が不可視であることを確認 (RLS)');

    console.log('=== P2-T3 実DB E2E検証 全項目 PASS ===');
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('[E2E ERROR]:', err);
  process.exit(1);
});
