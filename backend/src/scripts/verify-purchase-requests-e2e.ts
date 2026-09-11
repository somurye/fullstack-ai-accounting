import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { PurchaseRequestsService } from '../modules/purchase-requests/purchase-requests.service';
import { PurchaseRequestsController } from '../modules/purchase-requests/purchase-requests.controller';
import { ApprovalRequestsService } from '../modules/approval-requests/approval-requests.service';
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
  } as any;
}

function expect(actual: any) {
  return {
    toBe(expected: any) {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
    toHaveLength(expected: number) {
      if (!actual || actual.length !== expected) {
        throw new Error(`Expected length ${expected} but received ${actual ? actual.length : actual}`);
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
    console.error('Usage: ts-node verify-purchase-requests-e2e.ts <dsn>');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dsn });
  const db = new DatabaseService();
  (db as any).pool = pool;
  const auditLogs = new AuditLogsService(db);
  const purchaseRequestsService = new PurchaseRequestsService(db, auditLogs);
  const purchaseRequestsController = new PurchaseRequestsController(purchaseRequestsService);
  const approvalRequestsService = new ApprovalRequestsService(db, auditLogs);

  const reflector = new Reflector();
  const permissionsGuard = new PermissionsGuard(reflector);

  const client = await pool.connect();

  try {
    // テスト用テナントの取得
    const tenantsRes = await client.query('SELECT id FROM tenants ORDER BY created_at ASC LIMIT 2');
    if (tenantsRes.rowCount! < 2) {
      throw new Error('最低2つのテナントが必要です (クリーンDB初期化データ)');
    }
    const tenantAId = tenantsRes.rows[0].id;
    const tenantBId = tenantsRes.rows[1].id;

    // テナントAのユーザー取得
    const usersResA = await client.query(
      'SELECT user_id AS id FROM tenant_users WHERE tenant_id = $1 ORDER BY user_id ASC LIMIT 2',
      [tenantAId],
    );
    if (usersResA.rowCount! < 2) {
      throw new Error('テナントAに最低2人のユーザーが必要です');
    }
    const userA1 = usersResA.rows[0].id; // 申請者 (employee)
    const userA2 = usersResA.rows[1].id; // 承認者 (approver)

    // テナントBのユーザー取得
    const usersResB = await client.query(
      'SELECT user_id AS id FROM tenant_users WHERE tenant_id = $1 LIMIT 1',
      [tenantBId],
    );
    const userB1 = usersResB.rows[0].id;

    // ロールIDを取得して user_roles に紐付け (実DB環境での確実なRBAC設定)
    const empRoleRes = await client.query("SELECT id FROM roles WHERE code = 'employee'");
    const appRoleRes = await client.query("SELECT id FROM roles WHERE code = 'approver'");
    const ownerRoleRes = await client.query("SELECT id FROM roles WHERE code = 'owner'");
    const empRoleId = empRoleRes.rows[0]?.id;
    const appRoleId = appRoleRes.rows[0]?.id;
    const ownerRoleId = ownerRoleRes.rows[0]?.id;

    if (!empRoleId || !appRoleId || !ownerRoleId) {
      throw new Error(`ロール取得失敗: empRoleId=${empRoleId}, appRoleId=${appRoleId}, ownerRoleId=${ownerRoleId}`);
    }

    await client.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING`,
      [tenantAId, userA1, empRoleId],
    );

    await client.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING`,
      [tenantAId, userA2, appRoleId],
    );

    console.log(`[P2-T1 E2E] 開始: tenantA=${tenantAId}, tenantB=${tenantBId}, userA1=${userA1}, userA2=${userA2}`);

    // =========================================================================
    // 1. Controller レベルでの RBAC 認可検証 (PermissionsGuard)
    // =========================================================================
    console.log('[P2-T1 E2E] 1. PurchaseRequestsController の PermissionsGuard 認可検証...');

    // 1-1. employee ロールは create, view, edit が許可され、terminate は拒否される
    const empCreateCtx = createMockContext(purchaseRequestsController.create, ['employee'], tenantAId, userA1);
    expect(permissionsGuard.canActivate(empCreateCtx)).toBe(true);
    console.log('  [PASS] employee ロールによる POST /purchase-requests (create) が許可された');

    const empViewCtx = createMockContext(purchaseRequestsController.list, ['employee'], tenantAId, userA1);
    expect(permissionsGuard.canActivate(empViewCtx)).toBe(true);
    console.log('  [PASS] employee ロールによる GET /purchase-requests (view) が許可された');

    const empTermCtx = createMockContext(purchaseRequestsController.terminate, ['employee'], tenantAId, userA1);
    let empTermBlocked = false;
    try {
      permissionsGuard.canActivate(empTermCtx);
    } catch (e: any) {
      if (e.status === 403 || e.message.includes('Forbidden')) empTermBlocked = true;
    }
    if (!empTermBlocked) throw new Error('FAIL: employee が terminate エンドポイントを叩けてしまいました');
    console.log('  [PASS] employee ロールによる POST /purchase-requests/{id}/terminate が 403 で拒否された');

    // 1-2. owner ロールは terminate が許可される
    const ownerTermCtx = createMockContext(purchaseRequestsController.terminate, ['owner'], tenantAId, userA1);
    expect(permissionsGuard.canActivate(ownerTermCtx)).toBe(true);
    console.log('  [PASS] owner ロールによる terminate が許可された');

    // =========================================================================
    // 2. DB CHECK 制約と計算整合性検証 (負数・数量×単価≠合計のDB直接遮断)
    // =========================================================================
    console.log('[P2-T1 E2E] 2. DB CHECK 制約と計算整合性の検証...');

    // 2-1. 負の数量 (quantity <= 0) -> DB CHECK 拒否
    let negQtyBlocked = false;
    try {
      await client.query(
        `INSERT INTO purchase_requests (tenant_id, request_no, title, supplier_name, item_description, quantity, unit_price, total_amount, status, created_by)
         VALUES ($1, 'PR-TEST-NEG-QTY', '負数量テスト', 'テスト仕入先', '品目', 0, 1000, 0, 'draft', $2)`,
        [tenantAId, userA1],
      );
    } catch (e: any) {
      if (e.code === '23514' || e.message.includes('chk_purchase_requests_quantity_positive')) {
        negQtyBlocked = true;
      }
    }
    if (!negQtyBlocked) throw new Error('FAIL: quantity <= 0 が DB CHECK 制約で拒否されませんでした');
    console.log('  [PASS] quantity <= 0 の DB 直接 INSERT が CHECK 制約で拒否された');

    // 2-2. 負の単価 (unit_price < 0) -> DB CHECK 拒否
    let negPriceBlocked = false;
    try {
      await client.query(
        `INSERT INTO purchase_requests (tenant_id, request_no, title, supplier_name, item_description, quantity, unit_price, total_amount, status, created_by)
         VALUES ($1, 'PR-TEST-NEG-PRC', '負単価テスト', 'テスト仕入先', '品目', 1, -100, -100, 'draft', $2)`,
        [tenantAId, userA1],
      );
    } catch (e: any) {
      if (e.code === '23514' || e.message.includes('chk_purchase_requests_unit_price_nonneg')) {
        negPriceBlocked = true;
      }
    }
    if (!negPriceBlocked) throw new Error('FAIL: unit_price < 0 が DB CHECK 制約で拒否されませんでした');
    console.log('  [PASS] unit_price < 0 の DB 直接 INSERT が CHECK 制約で拒否された');

    // 2-3. 計算不整合 (quantity * unit_price != total_amount) -> DB CHECK 拒否
    let calcMismatchBlocked = false;
    try {
      await client.query(
        `INSERT INTO purchase_requests (tenant_id, request_no, title, supplier_name, item_description, quantity, unit_price, total_amount, status, created_by)
         VALUES ($1, 'PR-TEST-CALC-MISMATCH', '計算不整合テスト', 'テスト仕入先', '品目', 2, 1000, 3000, 'draft', $2)`,
        [tenantAId, userA1],
      );
    } catch (e: any) {
      if (e.code === '23514' || e.message.includes('chk_purchase_requests_calc_match')) {
        calcMismatchBlocked = true;
      }
    }
    if (!calcMismatchBlocked) throw new Error('FAIL: total_amount != quantity * unit_price が DB CHECK 制約で拒否されませんでした');
    console.log('  [PASS] total_amount != quantity * unit_price の不整合 INSERT が DB CHECK 制約 (chk_purchase_requests_calc_match) で拒否された');

    // 2-4. API 経由で不整合な金額 -> 400 BadRequest で拒否
    const reqCtx = {
      tenantId: tenantAId,
      userId: userA1,
      requestId: randomUUID(),
      ipAddress: '127.0.0.1',
      userAgent: 'verify-script',
    };

    let apiCalcBlocked = false;
    try {
      await RequestContext.run(reqCtx, async () => {
        await purchaseRequestsController.create({
          title: 'API計算不整合テスト',
          supplier_name: 'テスト仕入先',
          item_description: '品目',
          quantity: 2,
          unit_price: 1000,
          total_amount: 5000,
        });
      });
    } catch (e: any) {
      if (e instanceof AppException && e.getStatus() === 400) {
        apiCalcBlocked = true;
      }
    }
    if (!apiCalcBlocked) throw new Error('FAIL: API経由での計算不整合が 400 で拒否されませんでした');
    console.log('  [PASS] API経由での計算不整合が 400 BadRequest で拒否された');

    // =========================================================================
    // 3. 発注申請の作成と採番 (PR-YYYY-XXXX) 検証
    // =========================================================================
    console.log('[P2-T1 E2E] 3. 発注申請の正常作成と自動採番検証...');

    const createdDraft = await purchaseRequestsService.create(tenantAId, userA1, {
      title: '開発用PC・周辺機器発注',
      supplier_name: '株式会社テックサプライ',
      item_description: 'MacBook Pro 14インチ M3 Pro',
      quantity: 2,
      unit_price: 320000,
      total_amount: 640000,
      currency: 'JPY',
      description: 'エンジニア増員に伴うPC調達',
    });

    expect(createdDraft.status).toBe('draft');
    expect(createdDraft.total_amount).toBe(640000);
    const year = new Date().getFullYear();
    if (!createdDraft.request_no.startsWith(`PR-${year}-`)) {
      throw new Error(`FAIL: request_no ${createdDraft.request_no} が PR-${year}-XXXX 形式ではありません`);
    }
    console.log(`  [PASS] 下書き発注申請が正常に作成され、採番された (${createdDraft.request_no})`);

    // =========================================================================
    // 4. 暗黙自動承認の防止検証 (ルール未設定テナントで 400 エラー)
    // =========================================================================
    console.log('[P2-T1 E2E] 4. 暗黙自動承認の防止検証 (ルール未設定時)...');

    // テナントAの発注申請承認ルールをすべて削除
    await client.query(
      `DELETE FROM approval_rules WHERE tenant_id = $1 AND target_type = 'purchase_request'`,
      [tenantAId],
    );

    let noRulesBlocked = false;
    try {
      await purchaseRequestsService.submitForApproval(tenantAId, userA1, createdDraft.id);
    } catch (e: any) {
      if (e instanceof AppException && (e.getStatus() === 400 || e.getStatus() === 422)) {
        noRulesBlocked = true;
      }
    }
    if (!noRulesBlocked) {
      throw new Error('FAIL: 承認ルール未設定時に自動active化してしまった、またはエラーになりませんでした');
    }

    // ステータスが draft のままであることを確認
    const afterFailedSubmit = await purchaseRequestsService.getById(tenantAId, userA1, createdDraft.id);
    expect(afterFailedSubmit.status).toBe('draft');
    console.log('  [PASS] 承認ルール未設定時の承認申請が 400 NO_APPROVAL_RULES_CONFIGURED で安全に遮断された (暗黙自動承認の防止)');

    // =========================================================================
    // 5. 明示的自動承認ルール (0-step, 1人テナント) の検証
    // =========================================================================
    console.log('[P2-T1 E2E] 5. 明示的自動承認ルール (is_explicit_auto_approve=true) の検証...');

    await client.query(
      `INSERT INTO approval_rules (tenant_id, target_type, step_number, is_explicit_auto_approve, is_active)
       VALUES ($1, 'purchase_request', 0, TRUE, TRUE)`,
      [tenantAId],
    );

    const autoApproveReq = await purchaseRequestsService.create(tenantAId, userA1, {
      title: '少額事務用品即時発注',
      supplier_name: 'オフィスデポ',
      item_description: 'コピー用紙・文具一式',
      quantity: 5,
      unit_price: 2000,
      total_amount: 10000,
    });

    const activeAutoReq = await purchaseRequestsService.submitForApproval(tenantAId, userA1, autoApproveReq.id);
    expect(activeAutoReq.status).toBe('active');
    expect(activeAutoReq.approved_at).not.toBeNull();
    console.log('  [PASS] 明示的 0-step ルールにより安全に active へ遷移した');

    // =========================================================================
    // 6. 多段階承認ワークフローと職務分掌 (SoD 自己承認拒否) の検証
    // =========================================================================
    console.log('[P2-T1 E2E] 6. 多段階承認ワークフローと SoD 検証...');

    // 承認ルールをクリアし、2ステップ多段階ルールを設定
    await client.query(
      `DELETE FROM approval_rules WHERE tenant_id = $1 AND target_type = 'purchase_request'`,
      [tenantAId],
    );
    await client.query(
      `INSERT INTO approval_rules (tenant_id, target_type, step_number, approver_role_id, is_active)
       VALUES ($1, 'purchase_request', 1, $2, TRUE)`,
      [tenantAId, appRoleId],
    );

    const normalDraft = await purchaseRequestsService.create(tenantAId, userA1, {
      title: '高額サーバー調達申請',
      supplier_name: 'クラウドサーバー社',
      item_description: '専有物理サーバー 2台',
      quantity: 2,
      unit_price: 500000,
      total_amount: 1000000,
    });

    const pendingReq = await purchaseRequestsService.submitForApproval(tenantAId, userA1, normalDraft.id);
    expect(pendingReq.status).toBe('pending_approval');
    console.log('  [PASS] 申請送信により pending_approval に遷移した');

    // 起票された approval_requests の取得
    const appReqRes = await client.query(
      `SELECT id, status, current_step FROM approval_requests WHERE tenant_id = $1 AND target_type = 'purchase_request' AND target_id = $2`,
      [tenantAId, normalDraft.id],
    );
    if (appReqRes.rowCount === 0) throw new Error('FAIL: approval_requests レコードが作成されていません');
    const approvalRequestId = appReqRes.rows[0].id;

    // 申請者自身 (userA1) による自己承認 -> SoD で拒否されること
    // (権限なしによる403、または同一人物によるDBトリガー23514 check_violation のいずれかで必ず遮断される)
    let selfApproveBlocked = false;
    try {
      await approvalRequestsService.approve(tenantAId, userA1, approvalRequestId, { comment: '自己承認テスト' });
    } catch (e: any) {
      const status = e instanceof AppException ? e.getStatus() : null;
      if (
        (e instanceof AppException && (status === 400 || status === 403)) ||
        e.code === '23514' ||
        e.message?.includes('self-approval') ||
        e.message?.includes('権限') ||
        e.message?.includes('承認者ではありません')
      ) {
        selfApproveBlocked = true;
      } else {
        console.error('  [DEBUG self-approval error]:', e);
      }
    }
    if (!selfApproveBlocked) throw new Error('FAIL: 申請者自身による自己承認が拒否されませんでした');
    console.log('  [PASS] 申請者自身による自己承認が SoD により拒否された');

    // 正規承認者 (userA2) による承認実行 -> active へ完了
    await approvalRequestsService.approve(tenantAId, userA2, approvalRequestId, { comment: '購入承認します' });

    const finalizedReq = await purchaseRequestsService.getById(tenantAId, userA1, normalDraft.id);
    expect(finalizedReq.status).toBe('active');
    expect(finalizedReq.approved_at).not.toBeNull();
    console.log('  [PASS] 正規承認者による承認で発注申請が active に遷移した');

    // =========================================================================
    // 7. WORM 改ざん防止 & 状態遷移保護トリガー検証
    // =========================================================================
    console.log('[P2-T1 E2E] 7. WORM 改ざん防止 & 状態遷移保護トリガー検証...');

    // 7-1. active 状態の金額・数量・サプライヤー改変は DB トリガーで拒否される
    let activePriceTamperBlocked = false;
    try {
      await client.query(
        `UPDATE purchase_requests SET unit_price = 999999 WHERE id = $1`,
        [normalDraft.id],
      );
    } catch (e: any) {
      if (e.message.includes('immutable') || e.code === '23001' || e.code === 'P0001') {
        activePriceTamperBlocked = true;
      }
    }
    if (!activePriceTamperBlocked) throw new Error('FAIL: active 発注申請の単価改ざんが拒否されませんでした');
    console.log('  [PASS] active 発注申請の単価改ざんが DB トリガー (fn_guard_purchase_request_transition) で拒否された');

    // 7-2. active 状態の物理削除は DB トリガーで拒否される
    let activeDeleteBlocked = false;
    try {
      await client.query(`DELETE FROM purchase_requests WHERE id = $1`, [normalDraft.id]);
    } catch (e: any) {
      if (e.message.includes('cannot be physically deleted') || e.code === '23001' || e.code === 'P0001') {
        activeDeleteBlocked = true;
      }
    }
    if (!activeDeleteBlocked) throw new Error('FAIL: active 発注申請の物理削除が拒否されませんでした');
    console.log('  [PASS] active 発注申請の物理削除が DB トリガーで拒否された');

    // 7-3. RBAC検証: employee (userA1) による terminate は Service 層でも 403 で拒否される (二重防御)
    let empTermServiceBlocked = false;
    try {
      await purchaseRequestsService.terminate(tenantAId, userA1, normalDraft.id);
    } catch (e: any) {
      if (e instanceof AppException && e.getStatus() === 403) empTermServiceBlocked = true;
    }
    if (!empTermServiceBlocked) throw new Error('FAIL: employee による terminate が Service層で拒否されませんでした');
    console.log('  [PASS] employee による terminate が Service層 (assertUserPermission) でも 403 で遮断された (二重防御)');

    // 7-4. owner ロールによる正常解約遷移
    const ownerUserId = randomUUID();
    await client.query(
      `INSERT INTO users (id, email, name) VALUES ($1, 'owner_pr@example.com', 'PR Owner')`,
      [ownerUserId],
    );
    await client.query(
      `INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)`,
      [tenantAId, ownerUserId],
    );
    await client.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)`,
      [tenantAId, ownerUserId, ownerRoleId],
    );

    const terminatedReq = await purchaseRequestsService.terminate(tenantAId, ownerUserId, normalDraft.id);
    expect(terminatedReq.status).toBe('terminated');
    console.log('  [PASS] owner ユーザーにより active 発注申請が terminated へ正常に解約・取消された');

    // 7-5. terminated 状態からの変更・再活性化は DB トリガーで拒否される
    let terminatedUpdateBlocked = false;
    try {
      await client.query(
        `UPDATE purchase_requests SET status = 'active' WHERE id = $1`,
        [normalDraft.id],
      );
    } catch (e: any) {
      if (e.message.includes('terminal status') || e.code === '23001' || e.code === 'P0001') {
        terminatedUpdateBlocked = true;
      }
    }
    if (!terminatedUpdateBlocked) throw new Error('FAIL: terminated 状態からの再活性化が拒否されませんでした');
    console.log('  [PASS] terminated 状態からの再活性化が DB トリガーで拒否された');

    // =========================================================================
    // 8. DBトリガーによるテナント整合性保証 (他テナントのリソース拒否)
    // =========================================================================
    console.log('[P2-T1 E2E] 8. DBトリガーによるテナント整合性検証...');

    // テナントBに添付ファイル作成
    const attBRes = await client.query(
      `INSERT INTO attachments (tenant_id, file_name, mime_type, file_hash, storage_path, document_category, uploaded_by)
       VALUES ($1, 'supplier_quote_b.pdf', 'application/pdf', 'hash_quote_b', '/tmp/b.pdf', 'other', $2)
       RETURNING id`,
      [tenantBId, userB1],
    );
    const attachmentBId = attBRes.rows[0].id;

    // 8-1. テナントAの発注申請にテナントBの attachment_id を指定 -> 拒否
    let crossAttBlocked = false;
    try {
      await client.query(
        `INSERT INTO purchase_requests (tenant_id, request_no, title, supplier_name, item_description, quantity, unit_price, total_amount, attachment_id, status, created_by)
         VALUES ($1, 'PR-TEST-CROSS-ATT', '不正添付発注', '仕入先', '品目', 1, 1000, 1000, $2, 'draft', $3)`,
        [tenantAId, attachmentBId, userA1],
      );
    } catch (e: any) {
      if (e.message.includes('does not belong to tenant') || e.code === '23503' || e.code === 'P0001') {
        crossAttBlocked = true;
      }
    }
    if (!crossAttBlocked) throw new Error('FAIL: 他テナントの attachment_id が DB トリガーで拒否されませんでした');
    console.log('  [PASS] 他テナントの attachment_id 指定が DB トリガー (fn_validate_purchase_request_tenant_consistency) で拒否された');

    // 8-2. テナントAの発注申請にテナントBの created_by を指定 -> 拒否
    let crossUserBlocked = false;
    try {
      await client.query(
        `INSERT INTO purchase_requests (tenant_id, request_no, title, supplier_name, item_description, quantity, unit_price, total_amount, status, created_by)
         VALUES ($1, 'PR-TEST-CROSS-USR', '不正起票者発注', '仕入先', '品目', 1, 1000, 1000, 'draft', $2)`,
        [tenantAId, userB1],
      );
    } catch (e: any) {
      if (e.message.includes('not a member of tenant') || e.code === '23503' || e.code === 'P0001') {
        crossUserBlocked = true;
      }
    }
    if (!crossUserBlocked) throw new Error('FAIL: 他テナントの created_by が DB トリガーで拒否されませんでした');
    console.log('  [PASS] 他テナントの created_by 指定が DB トリガーで拒否された');

    // =========================================================================
    // 9. RLS による完全テナント分離検証 (他テナントから完全不可視)
    // =========================================================================
    console.log('[P2-T1 E2E] 9. RLS による完全テナント分離検証...');

    // 9-1. テナントB の RLS コンテキストでクエリ (app_runtime ロールに切り替えてスーパーユーザーのRLSバイパスを防止)
    const rlsResultB = await db.transaction(tenantBId, userB1, async (txClient) => {
      await txClient.query('SET LOCAL ROLE app_runtime');
      const { rows } = await txClient.query<any>(
        'SELECT id, title, tenant_id FROM purchase_requests WHERE id = $1',
        [normalDraft.id],
      );
      return rows;
    });
    expect(rlsResultB).toHaveLength(0);
    console.log('  [PASS] テナントBからはテナントAの発注申請がRLSにより一切不可視(0件)であることを確認');

    // 9-2. サービスレイヤでもテナントBからアクセスすると404になること
    let crossTenantServiceBlocked = false;
    try {
      await purchaseRequestsService.getById(tenantBId, userB1, normalDraft.id);
    } catch (err: any) {
      if (err.message?.includes('見つかりません') || err.status === 404) {
        crossTenantServiceBlocked = true;
      }
    }
    if (!crossTenantServiceBlocked) {
      throw new Error('FAIL: テナントBからテナントAの発注申請が取得できてしまいました (テナント分離違反)');
    }
    console.log('  [PASS] テナントBからのgetByIdアクセスが404で遮断された');

    // 9-3. テナントBの一覧にテナントAの発注申請が漏洩しないこと
    const listB = await purchaseRequestsService.list(tenantBId, userB1, { page: 1, page_size: 50 });
    const leaked = listB.purchaseRequests.some((r: any) => r.id === normalDraft.id || r.tenant_id === tenantAId);
    if (leaked) {
      throw new Error('FAIL: テナントBの発注申請一覧にテナントAの発注申請が漏洩しています');
    }
    console.log('  [PASS] テナントBの発注申請一覧にテナントAのデータは一切含まれないことを確認');

    console.log('\n=============================================================');
    console.log('✅ [P2-T1] purchase_requests の全実DB E2E検証が正常に完了しました！');
    console.log('=============================================================\n');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('\n❌ [P2-T1 E2E 検証エラー]:', err);
  process.exit(1);
});
