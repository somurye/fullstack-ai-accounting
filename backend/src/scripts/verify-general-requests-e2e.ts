import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { GeneralRequestsService } from '../modules/general-requests/general-requests.service';
import { GeneralRequestsController } from '../modules/general-requests/general-requests.controller';
import { ApprovalRequestsService } from '../modules/approval-requests/approval-requests.service';
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
    getClass: () => GeneralRequestsController,
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

async function run() {
  const dsn = process.argv[2] || process.env.DATABASE_URL;
  if (!dsn) {
    console.error('Usage: ts-node verify-general-requests-e2e.ts <dsn>');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dsn });
  const db = new DatabaseService();
  (db as any).pool = pool;
  const auditLogs = new AuditLogsService(db);
  const generalRequestsService = new GeneralRequestsService(db, auditLogs);
  const generalRequestsController = new GeneralRequestsController(generalRequestsService);
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

    console.log(`[P1-T5 E2E] 開始: tenantA=${tenantAId}, tenantB=${tenantBId}, userA1=${userA1}, userA2=${userA2}`);

    // =========================================================================
    // 1. Controller レベルでの RBAC 認可検証 (PermissionsGuard)
    // =========================================================================
    console.log('[P1-T5 E2E] 1. GeneralRequestsController の PermissionsGuard 認可検証...');

    // 1-1. employee ロールは create, view, edit が許可され、approve は拒否される
    const empCreateCtx = createMockContext(generalRequestsController.create, ['employee'], tenantAId, userA1);
    expect(permissionsGuard.canActivate(empCreateCtx)).toBe(true);
    console.log('  [PASS] employee ロールによる POST /general-requests (create) が許可された');

    const empViewCtx = createMockContext(generalRequestsController.list, ['employee'], tenantAId, userA1);
    expect(permissionsGuard.canActivate(empViewCtx)).toBe(true);
    console.log('  [PASS] employee ロールによる GET /general-requests (view) が許可された');

    const empEditCtx = createMockContext(generalRequestsController.update, ['employee'], tenantAId, userA1);
    expect(permissionsGuard.canActivate(empEditCtx)).toBe(true);
    console.log('  [PASS] employee ロールによる PUT /general-requests/:id (edit) が許可された');

    // 1-2. 権限なしロール (ロールなし) によるアクセス拒否 (fail-closed)
    const noRoleCtx = createMockContext(generalRequestsController.create, [], tenantAId, userA1);
    let noRoleDenied = false;
    try {
      permissionsGuard.canActivate(noRoleCtx);
    } catch (e: any) {
      if (e instanceof AppException && e.getStatus() === 403) noRoleDenied = true;
    }
    if (!noRoleDenied) throw new Error('FAIL: ロールなしでの general_request.create が 403 で拒否されていません');
    console.log('  [PASS] ロールなしユーザーによる POST /general-requests が 403 で拒否された');

    // =========================================================================
    // 2. 下書き(draft) 作成・更新・削除の動作確認
    // =========================================================================
    console.log('[P1-T5 E2E] 2. 下書き作成・更新・削除の検証...');

    const draft = await generalRequestsService.create(tenantAId, userA1, {
      title: '備品ディスプレイ購入申請',
      description: '開発効率向上のため4Kモニターを購入したい',
      category: 'equipment',
      amount: 55000,
    });
    expect(draft.status).toBe('draft');
    expect(draft.request_no).toMatch(/^REQ-\d{6}-\d{4}$/);
    console.log(`  [PASS] 下書き稟議作成完了 (request_no=${draft.request_no})`);

    const updatedDraft = await generalRequestsService.update(tenantAId, userA1, draft.id, {
      title: '備品4Kディスプレイ購入申請 (改訂)',
      amount: 60000,
    });
    expect(updatedDraft.title).toBe('備品4Kディスプレイ購入申請 (改訂)');
    expect(updatedDraft.amount).toBe(60000);
    console.log('  [PASS] 下書き稟議の更新完了');

    await generalRequestsService.delete(tenantAId, userA1, draft.id);
    let getDeletedFailed = false;
    try {
      await generalRequestsService.getById(tenantAId, userA1, draft.id);
    } catch (e: any) {
      if (e instanceof AppException && e.getStatus() === 404) getDeletedFailed = true;
    }
    if (!getDeletedFailed) throw new Error('FAIL: 削除した下書きが取得できてしまいます');
    console.log('  [PASS] 下書き稟議の物理削除完了');

    // =========================================================================
    // 3. 承認ルール未設定時の安全策検証 (自動 active 化の防止)
    // =========================================================================
    console.log('[P1-T5 E2E] 3. 承認ルール未設定テナントでの申請拒否検証...');

    // テナントAの既存 general_request ルールを一時退避
    await client.query(
      `DELETE FROM approval_rules WHERE tenant_id = $1 AND target_type = 'general_request'`,
      [tenantAId],
    );

    const noRuleDraft = await generalRequestsService.create(tenantAId, userA1, {
      title: 'ルール未設定テスト申請',
      description: 'ルール未設定時の安全挙動テスト',
    });

    let submitNoRuleDenied = false;
    try {
      await generalRequestsService.submitForApproval(tenantAId, userA1, noRuleDraft.id);
    } catch (e: any) {
      if (e instanceof AppException && (e.getStatus() === 400 || e.getStatus() === 422)) {
        submitNoRuleDenied = true;
      }
    }
    if (!submitNoRuleDenied) {
      throw new Error('FAIL: 承認ルール未設定テナントで申請がエラーにならず実行されました');
    }

    // ステータスが draft のままであることを確認
    const recheckDraft = await generalRequestsService.getById(tenantAId, userA1, noRuleDraft.id);
    if (recheckDraft.status !== 'draft') {
      throw new Error(`FAIL: ルール未設定なのに status が ${recheckDraft.status} に変更されました`);
    }
    console.log('  [PASS] 承認ルール未設定時はエラーとなり、暗黙自動承認(active化)が防止された');

    // =========================================================================
    // 4. 通常承認フローの検証 (1ステップ承認 -> 承認完了で active 化)
    // =========================================================================
    console.log('[P1-T5 E2E] 4. 通常承認フロー (draft -> pending_approval -> active) の検証...');

    // テナントAに userA2 を承認者とする 1-step ルールを登録
    await client.query(
      `INSERT INTO approval_rules (tenant_id, target_type, step_number, approver_user_id, is_active)
       VALUES ($1, 'general_request', 1, $2, TRUE)`,
      [tenantAId, userA2],
    );

    // userA2 に general_request.approve 権限ロールを付与
    await client.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id)
       SELECT $1, $2, r.id FROM roles r WHERE r.code = 'approver'
       ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING`,
      [tenantAId, userA2],
    );

    const reqForApproval = await generalRequestsService.create(tenantAId, userA1, {
      title: '通常承認テスト稟議',
      description: '通常多段階承認フローの動作検証',
      amount: 100000,
    });

    const pendingReq = await generalRequestsService.submitForApproval(tenantAId, userA1, reqForApproval.id);
    expect(pendingReq.status).toBe('pending_approval');
    console.log('  [PASS] 承認申請により pending_approval へ遷移した');

    // approval_requests の存在確認
    const arRes = await client.query(
      `SELECT id, status, current_step, total_steps FROM approval_requests
       WHERE tenant_id = $1 AND target_type = 'general_request' AND target_id = $2`,
      [tenantAId, reqForApproval.id],
    );
    expect(arRes.rowCount).toBe(1);
    const arId = arRes.rows[0].id;
    expect(arRes.rows[0].status).toBe('pending');
    console.log(`  [PASS] approval_requests レコード起票確認 (id=${arId})`);

    // userA2 による承認実行 (ApprovalRequestsService 経由)
    await approvalRequestsService.approve(tenantAId, userA2, arId, {
      comment: '稟議内容を確認し、承認します。',
    });

    // general_requests のステータスが active になり、approved_at が記録されたか確認
    const approvedReq = await generalRequestsService.getById(tenantAId, userA1, reqForApproval.id);
    expect(approvedReq.status).toBe('active');
    expect(approvedReq.approved_at).not.toBeNull();
    console.log('  [PASS] 承認完了により general_requests.status が active に遷移し approved_at が記録された');

    // =========================================================================
    // 5. 明示的自動承認ルール (0-step, 1人テナント) の検証
    // =========================================================================
    console.log('[P1-T5 E2E] 5. 明示的自動承認ルール (is_explicit_auto_approve=true) の検証...');

    await client.query(
      `DELETE FROM approval_rules WHERE tenant_id = $1 AND target_type = 'general_request'`,
      [tenantAId],
    );
    await client.query(
      `INSERT INTO approval_rules (tenant_id, target_type, step_number, is_explicit_auto_approve, is_active)
       VALUES ($1, 'general_request', 0, TRUE, TRUE)`,
      [tenantAId],
    );

    const autoApproveDraft = await generalRequestsService.create(tenantAId, userA1, {
      title: '1人テナント用即時承認稟議',
      description: '明示的自動承認の動作検証',
    });

    const activeReq = await generalRequestsService.submitForApproval(tenantAId, userA1, autoApproveDraft.id);
    expect(activeReq.status).toBe('active');
    expect(activeReq.approved_at).not.toBeNull();
    console.log('  [PASS] 明示的自動承認ルールにより即座に active へ遷移した');

    // =========================================================================
    // 6. DBトリガーによるテナント整合性保証 (他テナントのリソース拒否)
    // =========================================================================
    console.log('[P1-T5 E2E] 6. DBトリガーによるテナント整合性検証...');

    // テナントBに添付ファイルを1件作成
    const attBRes = await client.query(
      `INSERT INTO attachments (tenant_id, file_name, mime_type, file_hash, storage_path, document_category, uploaded_by)
       VALUES ($1, 'secret_b.pdf', 'application/pdf', 'hash_b', '/tmp/secret_b.pdf', 'other', $2)
       RETURNING id`,
      [tenantBId, userB1],
    );
    const attachmentBId = attBRes.rows[0].id;

    // 6-1. テナントAの稟議にテナントBの attachment_id を指定して INSERT -> DBトリガーで拒否
    let crossAttDenied = false;
    try {
      await client.query(
        `INSERT INTO general_requests (tenant_id, request_no, title, description, category, attachment_id, status, created_by)
         VALUES ($1, 'REQ-TEST-001', '不正添付稟議', '他テナントの添付ファイル指定', 'general', $2, 'draft', $3)`,
        [tenantAId, attachmentBId, userA1],
      );
    } catch (e: any) {
      if (e.message.includes('does not belong to tenant') || e.code === '23503' || e.code === '23514' || e.code === 'P0001') {
        crossAttDenied = true;
      }
    }
    if (!crossAttDenied) throw new Error('FAIL: 他テナントの attachment_id が DBトリガーで拒否されませんでした');
    console.log('  [PASS] 他テナントの attachment_id 指定が DBトリガー(fn_validate_general_request_tenant_consistency)で拒否された');

    // 6-2. テナントAの稟議にテナントBのユーザー(created_by)を指定して INSERT -> DBトリガーで拒否
    let crossUserDenied = false;
    try {
      await client.query(
        `INSERT INTO general_requests (tenant_id, request_no, title, description, category, status, created_by)
         VALUES ($1, 'REQ-TEST-002', '不正起票者稟議', '他テナントユーザー指定', 'general', 'draft', $2)`,
        [tenantAId, userB1],
      );
    } catch (e: any) {
      if (e.message.includes('not a member of tenant') || e.code === '23503' || e.code === '23514' || e.code === 'P0001') {
        crossUserDenied = true;
      }
    }
    if (!crossUserDenied) throw new Error('FAIL: 他テナントの created_by が DBトリガーで拒否されませんでした');
    console.log('  [PASS] 他テナントの created_by 指定が DBトリガーで拒否された');

    // =========================================================================
    // 7. active 後の改ざん防止・削除禁止トリガー検証
    // =========================================================================
    console.log('[P1-T5 E2E] 7. active 後の改ざん防止トリガー検証...');

    // active 状態の稟議のタイトルを直接変更しようとすると拒否される
    let activeUpdateDenied = false;
    try {
      await client.query(
        `UPDATE general_requests SET title = '改変タイトル' WHERE id = $1`,
        [activeReq.id],
      );
    } catch (e: any) {
      if (e.message.includes('immutable') || e.code === '23001' || e.code === 'P0001' || e.code === '23514') {
        activeUpdateDenied = true;
      }
    }
    if (!activeUpdateDenied) throw new Error('FAIL: active状態の稟議タイトル変更がDBトリガーで拒否されませんでした');
    console.log('  [PASS] active 稟議の主要項目改変が DBトリガー(fn_guard_general_request_transition)で拒否された');

    // active 状態の稟議を物理削除しようとすると拒否される
    let activeDeleteDenied = false;
    try {
      await client.query(
        `DELETE FROM general_requests WHERE id = $1`,
        [activeReq.id],
      );
    } catch (e: any) {
      if (e.message.includes('cannot be physically deleted') || e.code === '23001' || e.code === 'P0001' || e.code === '23514') {
        activeDeleteDenied = true;
      }
    }
    if (!activeDeleteDenied) throw new Error('FAIL: active状態の稟議削除がDBトリガーで拒否されませんでした');
    console.log('  [PASS] active 稟議の物理削除が DBトリガーで拒否された');

    // =========================================================================
    // 8. RLS によるテナント分離検証 (他テナントから完全不可視)
    // =========================================================================
    console.log('[P1-T5 E2E] 8. RLS テナント分離の検証...');

    // テナントB の RLS コンテキストでクエリ (app_runtime ロールに切り替えてスーパーユーザーのRLSバイパスを防止)
    const rlsResultB = await db.transaction(tenantBId, userB1, async (txClient) => {
      await txClient.query('SET LOCAL ROLE app_runtime');
      const { rows } = await txClient.query<any>(
        'SELECT id, title, tenant_id FROM general_requests WHERE id = $1',
        [activeReq.id],
      );
      return rows;
    });
    expect(rlsResultB).toHaveLength(0);
    console.log('  [PASS] テナントBからはテナントAの稟議がRLSにより一切不可視(0件)であることを確認');

    // サービスレイヤでもテナントBからアクセスすると404になること
    let crossTenantServiceBlocked = false;
    try {
      await generalRequestsService.getById(tenantBId, userB1, activeReq.id);
    } catch (err: any) {
      if (err.message.includes('見つかりません') || err.status === 404) {
        crossTenantServiceBlocked = true;
      }
    }
    if (!crossTenantServiceBlocked) {
      throw new Error('FAIL: テナントBからテナントAの稟議が取得できてしまいました (テナント分離違反)');
    }
    console.log('  [PASS] テナントBからのgetByIdアクセスが404で遮断された');

    // テナントBの一覧にテナントAの稟議が漏洩しないこと
    const listB = await generalRequestsService.list(tenantBId, userB1, { page: 1, page_size: 50 });
    const leaked = listB.data.some((r: any) => r.id === activeReq.id || r.tenant_id === tenantAId);
    if (leaked) {
      throw new Error('FAIL: テナントBの稟議一覧にテナントAの稟議が漏洩しています');
    }
    console.log('  [PASS] テナントBの稟議一覧にテナントAのデータは一切含まれないことを確認');

    console.log('\n=================================================================');
    console.log(' [SUCCESS] P1-T5 汎用稟議 実DB E2E検証 全項目完全合格 (PASS)');
    console.log('=================================================================\n');
  } finally {
    client.release();
    await pool.end();
  }
}

function expect(actual: any) {
  return {
    toBe(expected: any) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected} but received ${actual}`);
      }
    },
    toHaveLength(expected: number) {
      if (!actual || actual.length !== expected) {
        throw new Error(`Expected length ${expected} but received ${actual ? actual.length : actual}`);
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error(`Expected null but received ${actual}`);
      }
    },
    not: {
      toBeNull() {
        if (actual === null) {
          throw new Error(`Expected not null but received null`);
        }
      },
    },
    toMatch(regex: RegExp) {
      if (!regex.test(actual)) {
        throw new Error(`Expected ${actual} to match ${regex}`);
      }
    },
  };
}

run().catch((err) => {
  console.error('\n[P1-T5 E2E] エラー発生:', err);
  process.exit(1);
});
