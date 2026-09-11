import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { SuppliersService } from '../modules/suppliers/suppliers.service';
import { SuppliersController } from '../modules/suppliers/suppliers.controller';
import { PurchaseRequestsService } from '../modules/purchase-requests/purchase-requests.service';
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
    getClass: () => SuppliersController,
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
  console.log('=== [P2-T2] サプライヤーマスタ 実DB E2E検証開始 ===');

  const dsn = process.argv[2] || process.env.DATABASE_URL;
  const pool = dsn
    ? new Pool({ connectionString: dsn })
    : new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DB_NAME || 'keiri_kaikei',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
      });

  const dbService = new DatabaseService();
  (dbService as any).pool = pool;
  const auditLogsService = new AuditLogsService(dbService);
  const suppliersService = new SuppliersService(dbService, auditLogsService);
  const purchaseRequestsService = new PurchaseRequestsService(dbService, auditLogsService);
  const controller = new SuppliersController(suppliersService);
  const guard = new PermissionsGuard(new Reflector());

  const tenantA = randomUUID();
  const tenantB = randomUUID();

  const userA_Owner = randomUUID();
  const userA_Accountant = randomUUID();
  const userA_Employee = randomUUID();
  const userB_Owner = randomUUID();

  try {
    // --------------------------------------------------------------------------
    // 0. テスト用テナント・ユーザー・ロールのシード
    // --------------------------------------------------------------------------
    console.log('1. テスト環境セットアップ (テナント・ユーザー・ロール作成)...');
    await pool.query(`INSERT INTO tenants (id, name) VALUES ($1, 'テストテナントA')`, [tenantA]);
    await pool.query(`INSERT INTO tenants (id, name) VALUES ($1, 'テストテナントB')`, [tenantB]);

    await pool.query(
      `INSERT INTO users (id, email, name, password_hash)
       VALUES ($1, 'owner-a@example.com', 'テナントAオーナー', 'dummy-hash')`,
      [userA_Owner],
    );
    await pool.query(
      `INSERT INTO users (id, email, name, password_hash)
       VALUES ($1, 'accountant-a@example.com', 'テナントA経理', 'dummy-hash')`,
      [userA_Accountant],
    );
    await pool.query(
      `INSERT INTO users (id, email, name, password_hash)
       VALUES ($1, 'employee-a@example.com', 'テナントA社員', 'dummy-hash')`,
      [userA_Employee],
    );
    await pool.query(
      `INSERT INTO users (id, email, name, password_hash)
       VALUES ($1, 'owner-b@example.com', 'テナントBオーナー', 'dummy-hash')`,
      [userB_Owner],
    );

    await pool.query(`INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)`, [tenantA, userA_Owner]);
    await pool.query(`INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)`, [tenantA, userA_Accountant]);
    await pool.query(`INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)`, [tenantA, userA_Employee]);
    await pool.query(`INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)`, [tenantB, userB_Owner]);

    // ロール割り当て
    const { rows: ownerRole } = await pool.query<{ id: string }>(`SELECT id FROM roles WHERE code = 'owner'`);
    const { rows: accountantRole } = await pool.query<{ id: string }>(`SELECT id FROM roles WHERE code = 'accountant'`);
    const { rows: employeeRole } = await pool.query<{ id: string }>(`SELECT id FROM roles WHERE code = 'employee'`);

    await pool.query(`INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)`, [tenantA, userA_Owner, ownerRole[0].id]);
    await pool.query(`INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)`, [tenantA, userA_Accountant, accountantRole[0].id]);
    await pool.query(`INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)`, [tenantA, userA_Employee, employeeRole[0].id]);
    await pool.query(`INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)`, [tenantB, userB_Owner, ownerRole[0].id]);

    console.log('   -> シード完了');

    // --------------------------------------------------------------------------
    // 1. RBAC 二重防御 (API Guard + Service層)
    // --------------------------------------------------------------------------
    console.log('2. RBAC 二重防御の検証 (employeeロールによるサプライヤー登録試行)...');

    // (1) Controller/Guard層での遮断
    const employeeCtx = createMockContext(controller.create, ['employee'], tenantA, userA_Employee);
    let guardBlocked = false;
    try {
      guard.canActivate(employeeCtx);
    } catch (err: unknown) {
      if (err instanceof AppException && err.getStatus() === 403) {
        guardBlocked = true;
      }
    }
    expect(guardBlocked).toBe(true);
    console.log('   -> [PASS] Guard層で 403 Forbidden 遮断成功');

    // (2) Service層での二重認可遮断
    let serviceBlocked = false;
    try {
      await suppliersService.create(tenantA, userA_Employee, {
        name: '社員による不正登録',
        status: 'active',
      });
    } catch (err: unknown) {
      if (err instanceof AppException && err.getStatus() === 403) {
        serviceBlocked = true;
      }
    }
    expect(serviceBlocked).toBe(true);
    console.log('   -> [PASS] Service層で 403 Forbidden 遮断成功 (二重防御)');

    // --------------------------------------------------------------------------
    // 2. テナント整合性トリガー (suppliers.created_by)
    // --------------------------------------------------------------------------
    console.log('3. テナント整合性トリガーの検証 (他テナントcreated_byの拒否)...');
    let triggerBlocked = false;
    try {
      await pool.query(
        `INSERT INTO suppliers (tenant_id, name, created_by)
         VALUES ($1, '他テナントユーザー起票サプライヤー', $2)`,
        [tenantA, userB_Owner],
      );
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === '23503') {
        triggerBlocked = true;
      }
    }
    expect(triggerBlocked).toBe(true);
    console.log('   -> [PASS] 他テナントのcreated_byがDBトリガー(23503)で拒否されることを確認');

    // --------------------------------------------------------------------------
    // 3. サプライヤー登録・更新・一意制約の検証
    // --------------------------------------------------------------------------
    console.log('4. サプライヤーCRUDおよび一意制約の検証...');
    const supplierA = await suppliersService.create(tenantA, userA_Owner, {
      name: '株式会社テックサプライ',
      contact_name: '山田 太郎',
      contact_email: 'yamada@techsupply.example.com',
      contact_phone: '03-1111-2222',
      payment_terms: '月末締め翌月末払い',
      status: 'active',
    });
    expect(supplierA.name).toBe('株式会社テックサプライ');
    expect(supplierA.status).toBe('active');
    console.log(`   -> [PASS] サプライヤー登録成功 (ID: ${supplierA.id})`);

    // 同名サプライヤーの重複登録が拒否されること (409 Conflict)
    let dupBlocked = false;
    try {
      await suppliersService.create(tenantA, userA_Accountant, {
        name: '株式会社テックサプライ',
        status: 'active',
      });
    } catch (err: unknown) {
      if (err instanceof AppException && err.getStatus() === 409) {
        dupBlocked = true;
      }
    }
    expect(dupBlocked).toBe(true);
    console.log('   -> [PASS] 同名サプライヤーの重複登録が 409 Conflict で拒否されることを確認');

    // サプライヤー更新
    const updatedA = await suppliersService.update(tenantA, userA_Accountant, supplierA.id, {
      contact_name: '山田 次郎',
      payment_terms: '20日締め翌月10日払い',
    });
    expect(updatedA.contact_name).toBe('山田 次郎');
    expect(updatedA.payment_terms).toBe('20日締め翌月10日払い');
    console.log('   -> [PASS] サプライヤー情報の更新成功');

    // --------------------------------------------------------------------------
    // 4. purchase_requests と suppliers の連携および不整合防止 (SO重点確認観点)
    // --------------------------------------------------------------------------
    console.log('5. purchase_requests と suppliers の連携・整合性検証 (SO重点観点)...');

    // (1) 他テナントのサプライヤーIDを指定した発注申請がDBトリガーで遮断されること (23503)
    const supplierB = await suppliersService.create(tenantB, userB_Owner, {
      name: 'テナントB専用サプライヤー',
      status: 'active',
    });

    let crossTenantSupplierBlocked = false;
    try {
      await pool.query(
        `INSERT INTO purchase_requests (
           tenant_id, request_no, title, supplier_id, supplier_name, item_description,
           quantity, unit_price, total_amount, currency, status, created_by
         ) VALUES (
           $1, 'PR-TEST-CROSS', '他テナントサプライヤー参照申請', $2, 'テナントB専用サプライヤー', '品目',
           1, 1000, 1000, 'JPY', 'draft', $3
         )`,
        [tenantA, supplierB.id, userA_Owner],
      );
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === '23503') {
        crossTenantSupplierBlocked = true;
      }
    }
    expect(crossTenantSupplierBlocked).toBe(true);
    console.log('   -> [PASS] 他テナントのsupplier_idがDBトリガー(23503)で拒否されることを確認');

    // (2) supplier_id はA社だが、supplier_name にB社を指定した場合、DBトリガーで23514遮断されること (不整合防止)
    let mismatchNameBlocked = false;
    try {
      await pool.query(
        `INSERT INTO purchase_requests (
           tenant_id, request_no, title, supplier_id, supplier_name, item_description,
           quantity, unit_price, total_amount, currency, status, created_by
         ) VALUES (
           $1, 'PR-TEST-MISMATCH', '名前不整合申請', $2, 'まったく別の会社名', '品目',
           1, 1000, 1000, 'JPY', 'draft', $3
         )`,
        [tenantA, supplierA.id, userA_Owner],
      );
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === '23514') {
        mismatchNameBlocked = true;
      }
    }
    expect(mismatchNameBlocked).toBe(true);
    console.log('   -> [PASS] supplier_idとsupplier_nameの不整合がDBトリガー(23514)で拒否されることを確認 (二重管理防止)');

    // (3) supplier_id を指定し、supplier_name を空にした場合、マスタ名で自動補完されること
    const prWithMaster = await purchaseRequestsService.create(tenantA, userA_Owner, {
      title: 'マスタ連携発注申請',
      supplier_id: supplierA.id,
      item_description: 'サーバーラック 1式',
      quantity: 1,
      unit_price: 150000,
      total_amount: 150000,
      currency: 'JPY',
    });
    expect(prWithMaster.supplier_id).toBe(supplierA.id);
    expect(prWithMaster.supplier_name).toBe('株式会社テックサプライ');
    console.log('   -> [PASS] supplier_id指定時にsupplier_nameがマスタから自動補完されることを確認');

    // (4) supplier_id = NULL のフリーテキスト起票が正常に行えること (後方互換性保証)
    const prLegacy = await purchaseRequestsService.create(tenantA, userA_Owner, {
      title: '従来通りのフリーテキスト発注申請',
      supplier_name: '新規スポット取引先 (未登録)',
      item_description: '臨時オフィス用品',
      quantity: 2,
      unit_price: 5000,
      total_amount: 10000,
      currency: 'JPY',
    });
    expect(prLegacy.supplier_id).toBeNull();
    expect(prLegacy.supplier_name).toBe('新規スポット取引先 (未登録)');
    console.log('   -> [PASS] supplier_id未指定のフリーテキスト起票も後方互換で正常動作することを確認');

    // (5) 【BLOCKER-01検証】参照中サプライヤーの名前変更がDBトリガー(23514)で拒否されること
    // supplierA は prWithMaster から参照されている。
    let nameChangeBlockedByTrigger = false;
    try {
      await pool.query(
        `UPDATE suppliers SET name = '勝手に変更した会社名' WHERE id = $1`,
        [supplierA.id],
      );
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === '23514') {
        nameChangeBlockedByTrigger = true;
      }
    }
    expect(nameChangeBlockedByTrigger).toBe(true);
    console.log('   -> [PASS] 発注申請で参照中のサプライヤーの名前変更がDBトリガー(23514)で拒否されることを確認 (過去データの不整合防止)');

    // Service層経由でも 409 Conflict で拒否されること
    let serviceNameChangeBlocked = false;
    try {
      await suppliersService.update(tenantA, userA_Accountant, supplierA.id, {
        name: '勝手に変更した会社名2',
      });
    } catch (err: unknown) {
      if (err instanceof AppException && err.getStatus() === 409) {
        serviceNameChangeBlocked = true;
      }
    }
    expect(serviceNameChangeBlocked).toBe(true);
    console.log('   -> [PASS] Service層でも参照中サプライヤーの名前変更が 409 Conflict で拒否されることを確認 (二重防御)');

    // suppliers.name と purchase_requests.supplier_name の両方が変更前の値のまま維持されていることを確認
    const { rows: supCheck } = await pool.query<{ name: string }>(
      `SELECT name FROM suppliers WHERE id = $1`,
      [supplierA.id],
    );
    expect(supCheck[0].name).toBe('株式会社テックサプライ');

    const { rows: prCheck } = await pool.query<{ supplier_name: string }>(
      `SELECT supplier_name FROM purchase_requests WHERE id = $1`,
      [prWithMaster.id],
    );
    expect(prCheck[0].supplier_name).toBe('株式会社テックサプライ');
    console.log('   -> [PASS] suppliers.name と purchase_requests.supplier_name の両方が変更前の値を維持していることを確認');

    // (6) 【巻き添え防止確認】参照中サプライヤーであっても、連絡先や支払条件等の他の列の更新は正常に行えること
    const updatedContact = await suppliersService.update(tenantA, userA_Accountant, supplierA.id, {
      contact_name: '連絡先 変更担当者',
      payment_terms: '翌々月5日払い',
    });
    expect(updatedContact.contact_name).toBe('連絡先 変更担当者');
    expect(updatedContact.payment_terms).toBe('翌々月5日払い');
    console.log('   -> [PASS] 参照中サプライヤーでも名前以外の列 (contact情報等) は問題なく更新できることを確認 (ピンポイント制御)');

    // (7) 【未参照サプライヤーの名前変更確認】どの発注申請からも参照されていないサプライヤーは名前変更が成功すること
    const supplierC = await suppliersService.create(tenantA, userA_Owner, {
      name: '未参照テストサプライヤー',
      status: 'active',
    });
    const updatedC = await suppliersService.update(tenantA, userA_Accountant, supplierC.id, {
      name: '未参照テストサプライヤー (社名変更後)',
    });
    expect(updatedC.name).toBe('未参照テストサプライヤー (社名変更後)');
    console.log('   -> [PASS] 未参照のサプライヤーであれば通常通り名前変更できることを確認');

    // (8) 【P2-T2-FIX2実証】並行実行下での advisory lock による race condition 防止検証
    // Transaction A: 既存supplierの名前変更
    // Transaction B: 同じsupplierを参照するpurchase_request作成
    // を並行実行し、advisory lockにより直列化され、最終状態に不整合が生じないことを実証。
    console.log('   -> 並行実行テスト 1: supplier.name変更 (Tx A先行) vs purchase_request作成 (Tx B)...');
    const supplierRace = await suppliersService.create(tenantA, userA_Owner, {
      name: 'レース検証サプライヤー1',
      status: 'active',
    });

    const clientA = await pool.connect();
    const clientB = await pool.connect();

    try {
      await clientA.query('BEGIN');
      await clientB.query('BEGIN');

      // Tx A: 名前変更を実行 (advisory lock を取得)
      await clientA.query(
        `UPDATE suppliers SET name = 'レース検証サプライヤー1 (変更後A)' WHERE id = $1`,
        [supplierRace.id],
      );

      // Tx B: 同一 supplier_id を参照する purchase_request の INSERT を非同期で開始
      // advisory lock により Tx A が COMMIT/ROLLBACK するまでブロックされる
      let bFinished = false;
      let bError: any = null;
      const bPromise = clientB
        .query(
          `INSERT INTO purchase_requests (
             tenant_id, request_no, title, supplier_id, supplier_name, item_description,
             quantity, unit_price, total_amount, currency, status, created_by
           ) VALUES (
             $1, 'PR-RACE-001', 'レース検証申請', $2, 'レース検証サプライヤー1', '品目',
             1, 1000, 1000, 'JPY', 'draft', $3
           )`,
          [tenantA, supplierRace.id, userA_Owner],
        )
        .then(() => {
          bFinished = true;
        })
        .catch((err) => {
          bError = err;
          bFinished = true;
        });

      // Tx A がロックを保持している間、Tx B が完了していない（待機中である）ことを確認
      await new Promise((r) => setTimeout(r, 100));
      expect(bFinished).toBe(false);

      // Tx A を COMMIT してロックを解放
      await clientA.query('COMMIT');

      // Tx B の完了を待機
      await bPromise;
      if (bError) {
        await clientB.query('ROLLBACK');
      } else {
        await clientB.query('COMMIT');
      }

      // 検証: Tx B は Tx A の変更後名称 ('... (変更後A)') との不一致を検知して 23514 で拒否されること
      expect(bError).not.toBeNull();
      expect(bError.code).toBe('23514');
      console.log('      [PASS] Tx A先行時: Tx Bが直列化され、新名称との不一致を検知して23514で安全に遮断された');

      // 最終状態の整合性確認: 不整合が一切存在しないこと
      const { rows: raceSupRows } = await pool.query<{ name: string }>(
        `SELECT name FROM suppliers WHERE id = $1`,
        [supplierRace.id],
      );
      const { rows: racePrRows } = await pool.query<{ supplier_name: string }>(
        `SELECT supplier_name FROM purchase_requests WHERE supplier_id = $1`,
        [supplierRace.id],
      );
      expect(raceSupRows[0].name).toBe('レース検証サプライヤー1 (変更後A)');
      expect(racePrRows).toHaveLength(0); // Tx B は rollback されている
    } finally {
      clientA.release();
      clientB.release();
    }

    // パターン 2: purchase_request作成 (Tx B) が先行し、未commit中に supplier.name変更 (Tx A) が実行された場合
    console.log('   -> 並行実行テスト 2: purchase_request作成 (Tx B先行) vs supplier.name変更 (Tx A)...');
    const supplierRace2 = await suppliersService.create(tenantA, userA_Owner, {
      name: 'レース検証サプライヤー2',
      status: 'active',
    });

    const clientA2 = await pool.connect();
    const clientB2 = await pool.connect();

    try {
      await clientA2.query('BEGIN');
      await clientB2.query('BEGIN');

      // Tx B: purchase_request を INSERT (advisory lock を取得)
      await clientB2.query(
        `INSERT INTO purchase_requests (
           tenant_id, request_no, title, supplier_id, supplier_name, item_description,
           quantity, unit_price, total_amount, currency, status, created_by
         ) VALUES (
           $1, 'PR-RACE-002', 'レース検証申請2', $2, 'レース検証サプライヤー2', '品目',
           1, 1000, 1000, 'JPY', 'draft', $3
         )`,
        [tenantA, supplierRace2.id, userA_Owner],
      );

      // Tx A: suppliers の名前変更を非同期で開始 (Tx B が保持する advisory lock により待機)
      let aFinished = false;
      let aError: any = null;
      const aPromise = clientA2
        .query(
          `UPDATE suppliers SET name = 'レース検証サプライヤー2 (変更後)' WHERE id = $1`,
          [supplierRace2.id],
        )
        .then(() => {
          aFinished = true;
        })
        .catch((err) => {
          aError = err;
          aFinished = true;
        });

      // Tx B が未commitの間、Tx A は待機中であること
      await new Promise((r) => setTimeout(r, 100));
      expect(aFinished).toBe(false);

      // Tx B を COMMIT して確定 & ロック解放
      await clientB2.query('COMMIT');

      // Tx A の完了を待機
      await aPromise;
      if (aError) {
        await clientA2.query('ROLLBACK');
      } else {
        await clientA2.query('COMMIT');
      }

      // 検証: Tx A はブロック解除後に purchase_requests の存在を検知し、23514 で拒否されること
      expect(aError).not.toBeNull();
      expect(aError.code).toBe('23514');
      console.log('      [PASS] Tx B先行時: Tx Aが直列化され、確定した参照を検知して名前変更が23514で安全に遮断された');

      // 最終状態の整合性確認: suppliers.name と purchase_requests.supplier_name が一致していること
      const { rows: race2SupRows } = await pool.query<{ name: string }>(
        `SELECT name FROM suppliers WHERE id = $1`,
        [supplierRace2.id],
      );
      const { rows: race2PrRows } = await pool.query<{ supplier_name: string }>(
        `SELECT supplier_name FROM purchase_requests WHERE supplier_id = $1`,
        [supplierRace2.id],
      );
      expect(race2SupRows[0].name).toBe('レース検証サプライヤー2'); // 変更は遮断された
      expect(race2PrRows[0].supplier_name).toBe('レース検証サプライヤー2'); // 変更前名称のまま両者一致！
      console.log('      [PASS] 最終状態: suppliers.name と purchase_requests.supplier_name が完全に一致していることを確認');
    } finally {
      clientA2.release();
      clientB2.release();
    }

    // --------------------------------------------------------------------------
    // 5. 完全テナント分離 (RLS)
    // --------------------------------------------------------------------------
    console.log('6. 行レベルセキュリティ (RLS) による完全テナント分離の検証...');
    await dbService.transaction(tenantB, userB_Owner, async (client) => {
      // アプリケーションロールに切り替え
      await client.query(`SET LOCAL ROLE app_runtime`);

      // テナントBからテナントAのサプライヤーを直接SELECT
      const { rows: directRows } = await client.query(
        `SELECT * FROM suppliers WHERE id = $1`,
        [supplierA.id],
      );
      expect(directRows).toHaveLength(0);

      // テナントBから全件取得してもテナントAのものは含まれない
      const { rows: allRows } = await client.query(
        `SELECT * FROM suppliers`,
      );
      expect(allRows).toHaveLength(1);
      expect(allRows[0].id).toBe(supplierB.id);
    });
    console.log('   -> [PASS] app_runtime ロールで他テナントのサプライヤーが不可視であることを確認 (RLS)');

    console.log('======================================================================');
    console.log('🎉 [P2-T2] サプライヤーマスタ 実DB E2E検証: 全項目合格 (PASS)');
    console.log('======================================================================');
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('❌ E2E検証失敗:', err);
  process.exit(1);
});
