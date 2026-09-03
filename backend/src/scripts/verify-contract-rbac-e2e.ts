import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { AiSuggestionsService } from '../modules/ai-suggestions/ai-suggestions.service';
import { ContractsService } from '../modules/contracts/contracts.service';
import { ContractsController } from '../modules/contracts/contracts.controller';
import { ApprovalRequestsService } from '../modules/approval-requests/approval-requests.service';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { AppException } from '../common/exceptions/app.exception';

function createMockContext(handler: Function, roles: string[], tenantId: string, userId: string): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => ContractsController,
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
    console.error('Usage: ts-node verify-contract-rbac-e2e.ts <dsn>');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dsn });
  const db = new DatabaseService();
  (db as any).pool = pool;
  const auditLogs = new AuditLogsService(db);
  const aiSuggestions = new AiSuggestionsService(db);
  const contractsService = new ContractsService(db, auditLogs, aiSuggestions);
  const contractsController = new ContractsController(contractsService);
  const approvalRequestsService = new ApprovalRequestsService(db, auditLogs);

  const reflector = new Reflector();
  const permissionsGuard = new PermissionsGuard(reflector);

  const client = await pool.connect();

  try {
    const tenantRes = await client.query('SELECT id FROM tenants LIMIT 1');
    if (tenantRes.rowCount === 0) throw new Error('テナントが見つかりません');
    const tenantId = tenantRes.rows[0].id;

    const userRes = await client.query('SELECT user_id AS id FROM tenant_users WHERE tenant_id = $1 LIMIT 1', [tenantId]);
    if (userRes.rowCount === 0) throw new Error('ユーザーが見つかりません');
    const ownerUserId = userRes.rows[0].id;

    console.log(`[RBAC E2E] 開始: tenantId=${tenantId}, ownerUserId=${ownerUserId}`);

    // =========================================================================
    // 1. DEBT-005: PermissionsGuard によるコントローラーレベルの認可検証
    // =========================================================================
    console.log('[RBAC E2E] 1. ContractsController の PermissionsGuard 認可検証...');

    // 1-1. legal_viewer による書き込み系エンドポイントの 403 拒否
    const createCtx = createMockContext(contractsController.create, ['legal_viewer'], tenantId, 'viewer-user');
    let createDenied = false;
    try {
      permissionsGuard.canActivate(createCtx);
    } catch (e: any) {
      if (e instanceof AppException && e.getStatus() === 403) createDenied = true;
    }
    if (!createDenied) throw new Error('FAIL: legal_viewer での contract.create が 403 で拒否されていません');
    console.log('  [PASS] legal_viewer による POST /contracts (作成) が 403 で拒否された');

    const updateCtx = createMockContext(contractsController.update, ['legal_viewer'], tenantId, 'viewer-user');
    let updateDenied = false;
    try {
      permissionsGuard.canActivate(updateCtx);
    } catch (e: any) {
      if (e instanceof AppException && e.getStatus() === 403) updateDenied = true;
    }
    if (!updateDenied) throw new Error('FAIL: legal_viewer での contract.edit が 403 で拒否されていません');
    console.log('  [PASS] legal_viewer による PUT /contracts/:id (編集) が 403 で拒否された');

    const terminateCtx = createMockContext(contractsController.terminate, ['legal_viewer'], tenantId, 'viewer-user');
    let terminateDenied = false;
    try {
      permissionsGuard.canActivate(terminateCtx);
    } catch (e: any) {
      if (e instanceof AppException && e.getStatus() === 403) terminateDenied = true;
    }
    if (!terminateDenied) throw new Error('FAIL: legal_viewer での contract.terminate が 403 で拒否されていません');
    console.log('  [PASS] legal_viewer による POST /contracts/:id/terminate (解約) が 403 で拒否された');

    const submitApprovalCtx = createMockContext(contractsController.submitForApproval, ['legal_viewer'], tenantId, 'viewer-user');
    let submitDenied = false;
    try {
      permissionsGuard.canActivate(submitApprovalCtx);
    } catch (e: any) {
      if (e instanceof AppException && e.getStatus() === 403) submitDenied = true;
    }
    if (!submitDenied) throw new Error('FAIL: legal_viewer での submitForApproval が 403 で拒否されていません');
    console.log('  [PASS] legal_viewer による POST /contracts/:id/submit-approval が 403 で拒否された');

    // 1-2. legal_viewer による閲覧系エンドポイントの許可
    const listCtx = createMockContext(contractsController.list, ['legal_viewer'], tenantId, 'viewer-user');
    const listAllowed = permissionsGuard.canActivate(listCtx);
    if (!listAllowed) throw new Error('FAIL: legal_viewer での GET /contracts (閲覧) が許可されていません');
    console.log('  [PASS] legal_viewer による GET /contracts (一覧閲覧) が正常に許可された');

    const getByIdCtx = createMockContext(contractsController.getById, ['legal_viewer'], tenantId, 'viewer-user');
    const getByIdAllowed = permissionsGuard.canActivate(getByIdCtx);
    if (!getByIdAllowed) throw new Error('FAIL: legal_viewer での GET /contracts/:id (詳細閲覧) が許可されていません');
    console.log('  [PASS] legal_viewer による GET /contracts/:id (詳細閲覧) が正常に許可された');

    // 1-3. legal_admin による操作の全許可
    const adminCreateAllowed = permissionsGuard.canActivate(createMockContext(contractsController.create, ['legal_admin'], tenantId, 'admin-user'));
    const adminUpdateAllowed = permissionsGuard.canActivate(createMockContext(contractsController.update, ['legal_admin'], tenantId, 'admin-user'));
    const adminTermAllowed = permissionsGuard.canActivate(createMockContext(contractsController.terminate, ['legal_admin'], tenantId, 'admin-user'));
    if (!adminCreateAllowed || !adminUpdateAllowed || !adminTermAllowed) {
      throw new Error('FAIL: legal_admin での契約作成・編集・解約が許可されていません');
    }
    console.log('  [PASS] legal_admin による全契約操作 (作成・編集・解約) が正常に許可された');

    // =========================================================================
    // 2. target_type='contract' の承認時における contract.approve 権限検証
    // =========================================================================
    console.log('[RBAC E2E] 2. 契約書承認時の contract.approve 権限検証...');
    // legal_viewer に相当するロールのユーザー (contract.approve 権限なし) を作成
    const viewerUserId = randomUUID();
    await client.query(`INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, 'dummy', 'Viewer User')`, [viewerUserId, `viewer_${viewerUserId}@example.com`]);
    await client.query(`INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)`, [tenantId, viewerUserId]);
    const viewerRoleRes = await client.query(`SELECT id FROM roles WHERE code = 'legal_viewer'`);
    await client.query(`INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)`, [tenantId, viewerUserId, viewerRoleRes.rows[0].id]);

    // テスト用契約と承認リクエストを作成
    const testContract = await contractsService.create(tenantId, ownerUserId, {
      title: '承認権限テスト契約書',
      counterparty_name: '株式会社テスト',
      contract_type: 'service',
      currency: 'JPY',
      start_date: '2026-04-01',
      auto_renewal: false,
      renewal_notice_days: 30,
    });

    const arId = randomUUID();
    await client.query(
      `INSERT INTO approval_requests (id, tenant_id, target_type, target_id, submitted_by, total_steps, current_step, status)
       VALUES ($1, $2, 'contract', $3, $4, 1, 1, 'pending')`,
      [arId, tenantId, testContract.id, ownerUserId],
    );

    // legal_viewer ユーザーで承認を試みると 403 Forbidden になること
    let approveDenied = false;
    try {
      await approvalRequestsService.approve(tenantId, viewerUserId, arId, { comment: '不正承認試行' });
    } catch (e: any) {
      if (e instanceof AppException && e.getStatus() === 403) approveDenied = true;
    }
    if (!approveDenied) throw new Error('FAIL: contract.approve 権限のない legal_viewer による承認が 403 で拒否されていません');
    console.log('  [PASS] contract.approve 権限のない legal_viewer による契約書承認が 403 で拒否された');

    // =========================================================================
    // 3. ai_suggestions target_type='attachment' 統一 & contracts.source_suggestion_id ライフサイクル
    // =========================================================================
    console.log('[RBAC E2E] 3. ai_suggestions target_type 統一 & contracts.source_suggestion_id ライフサイクル検証...');
    const attId = randomUUID();
    await client.query(
      `INSERT INTO attachments (id, tenant_id, file_name, mime_type, file_hash, storage_path, document_category, uploaded_by)
       VALUES ($1, $2, 'dummy_contract.pdf', 'application/pdf', 'hash123', '/tmp/dummy.pdf', 'contract', $3)`,
      [attId, tenantId, ownerUserId],
    );

    const suggestion = await aiSuggestions.generateContractSuggestion(
      client,
      tenantId,
      attId,
      'Title: Service Agreement\nAmount: JPY 500000\nParty A: Company A\nParty B: Company B',
    );

    if (suggestion.target_type !== 'attachment') {
      throw new Error(`FAIL: suggestion.target_type が 'attachment' ではありません: ${suggestion.target_type}`);
    }
    if (suggestion.target_id !== attId) {
      throw new Error(`FAIL: suggestion.target_id が attachment.id と一致していません`);
    }
    console.log('  [PASS] 条項抽出 AI提案の target_type が attachment として保存された (監査ログと一貫)');

    // 3-1. 他テナントの source_suggestion_id による INSERT 拒否 (BLOCKER-02: DBテナント整合性トリガー)
    const otherTenantRes = await client.query('SELECT id FROM tenants WHERE id <> $1 LIMIT 1', [tenantId]);
    if ((otherTenantRes.rowCount ?? 0) > 0) {
      const otherTenantId = otherTenantRes.rows[0].id;
      const otherSugId = randomUUID();
      const otherAttId = randomUUID();
      await client.query(
        `INSERT INTO attachments (id, tenant_id, file_name, mime_type, file_hash, storage_path, document_category, uploaded_by)
         VALUES ($1, $2, 'other.pdf', 'application/pdf', 'hash_other', '/tmp/other.pdf', 'contract', $3)`,
        [otherAttId, otherTenantId, ownerUserId],
      );
      await client.query(
        `INSERT INTO ai_suggestions (id, tenant_id, target_type, target_id, suggestion_type, payload, confidence_score, model_name, provider)
         VALUES ($1, $2, 'attachment', $3, 'contract_terms', '{}'::jsonb, 0.9, 'contract-extractor-v1', 'rule_engine')`,
        [otherSugId, otherTenantId, otherAttId],
      );

      let crossTenantBlocked = false;
      try {
        await client.query(
          `INSERT INTO contracts (
             id, tenant_id, contract_no, title, counterparty_name, contract_type,
             contract_amount, currency, start_date, auto_renewal, renewal_notice_days,
             status, source_suggestion_id, created_by
           ) VALUES (
             $1, $2, 'CNT-CROSS-TENANT-TEST', '不正テナント提案参照契約書', 'テスト社', 'service',
             1000, 'JPY', '2026-04-01', false, 30,
             'draft', $3, $4
           )`,
          [randomUUID(), tenantId, otherSugId, ownerUserId],
        );
      } catch (e: any) {
        if (e.code === '23503' && e.message.includes('does not belong to tenant')) {
          crossTenantBlocked = true;
        }
      }
      if (!crossTenantBlocked) {
        throw new Error('FAIL: 他テナントの source_suggestion_id を指定した contracts INSERT が DB トリガーで拒否されていません');
      }
      console.log('  [PASS] 他テナントの source_suggestion_id 指定が DB トリガー (23503) で拒否された (BLOCKER-02)');
    }

    // source_suggestion_id を紐付けて契約を作成
    const linkedContract = await contractsService.create(tenantId, ownerUserId, {
      title: 'AI起草連携契約書',
      counterparty_name: 'Company B',
      contract_type: 'service',
      currency: 'JPY',
      start_date: '2026-04-01',
      auto_renewal: false,
      renewal_notice_days: 30,
      attachment_id: attId,
      source_suggestion_id: suggestion.id,
    });

    if (linkedContract.source_suggestion_id !== suggestion.id) {
      throw new Error(`FAIL: contract.source_suggestion_id が保存されていません`);
    }
    console.log('  [PASS] contracts.source_suggestion_id が AI提案 ID と正しく紐付いて作成された');

    // 解約 (terminate) の実動作確認
    // まず active 状態へ更新
    await client.query(`UPDATE contracts SET status = 'active' WHERE id = $1`, [linkedContract.id]);
    const terminatedContract = await contractsService.terminate(tenantId, ownerUserId, linkedContract.id);
    if (terminatedContract.status !== 'terminated') {
      throw new Error(`FAIL: 契約ステータスが terminated に遷移していません: ${terminatedContract.status}`);
    }
    console.log('  [PASS] active 状態の契約書が terminated (解約) 状態へ正常に遷移した');

    // =========================================================================
    // 4. DEBT-006: approval_rules の自動承認ルールと通常ルールの混在防止
    // =========================================================================
    console.log('[RBAC E2E] 4. approval_rules 自動承認ルールと通常ルールの混在防止 (DEBT-006, BLOCKER-01)...');

    const testTargetType = 'contract';
    // 既存ルールを一旦クリーンアップ
    await client.query(`DELETE FROM approval_rules WHERE tenant_id = $1 AND target_type = $2`, [tenantId, testTargetType]);

    // 4-1. 自動承認ルール (0-step, is_explicit_auto_approve=true) を登録
    const autoRuleId = randomUUID();
    await client.query(
      `INSERT INTO approval_rules (id, tenant_id, target_type, step_number, is_explicit_auto_approve, is_active)
       VALUES ($1, $2, $3, 0, TRUE, TRUE)`,
      [autoRuleId, tenantId, testTargetType],
    );
    console.log('  [PASS] 自動承認ルール (step 0, is_explicit_auto_approve=true) を登録成功');

    // 4-2. 自動承認ルールが存在する状態で通常ルール (step 1) を追加しようとすると DB トリガーで拒否されること
    const normalRuleId = randomUUID();
    let mixBlocked1 = false;
    try {
      await client.query(
        `INSERT INTO approval_rules (id, tenant_id, target_type, step_number, approver_user_id, is_explicit_auto_approve, is_active)
         VALUES ($1, $2, $3, 1, $4, FALSE, TRUE)`,
        [normalRuleId, tenantId, testTargetType, ownerUserId],
      );
    } catch (e: any) {
      if (e.code === '23514') mixBlocked1 = true;
    }
    if (!mixBlocked1) throw new Error('FAIL: 自動承認ルールが存在する状態での通常ルール登録が拒否されていません');
    console.log('  [PASS] 自動承認ルールが存在する状態での通常ルール追加が DB トリガー (23514) により拒否された');

    // 4-3. 逆に通常ルールが存在する状態で自動承認ルールを追加しようとすると拒否されること
    await client.query(`DELETE FROM approval_rules WHERE id = $1`, [autoRuleId]);
    await client.query(
      `INSERT INTO approval_rules (id, tenant_id, target_type, step_number, approver_user_id, is_explicit_auto_approve, is_active)
       VALUES ($1, $2, $3, 1, $4, FALSE, TRUE)`,
      [normalRuleId, tenantId, testTargetType, ownerUserId],
    );

    let mixBlocked2 = false;
    try {
      await client.query(
        `INSERT INTO approval_rules (id, tenant_id, target_type, step_number, is_explicit_auto_approve, is_active)
         VALUES ($1, $2, $3, 0, TRUE, TRUE)`,
        [autoRuleId, tenantId, testTargetType],
      );
    } catch (e: any) {
      if (e.code === '23514') mixBlocked2 = true;
    }
    if (!mixBlocked2) throw new Error('FAIL: 通常ルールが存在する状態での自動承認ルール登録が拒否されていません');
    console.log('  [PASS] 通常ルールが存在する状態での自動承認ルール追加が DB トリガー (23514) により拒否された');

    // 4-4. BLOCKER-01: 並行INSERT耐性テスト (2つの独立トランザクションによる同時実行混在防止)
    console.log('  [BLOCKER-01] 並行トランザクションによる自動承認 vs 通常ルール同時INSERT検証...');
    await client.query(`DELETE FROM approval_rules WHERE tenant_id = $1 AND target_type = $2`, [tenantId, testTargetType]);

    const client1 = await pool.connect();
    const client2 = await pool.connect();

    try {
      // 2つのクライアントで同時にトランザクション開始しINSERT試行
      const task1 = async () => {
        try {
          await client1.query('BEGIN');
          await client1.query(
            `INSERT INTO approval_rules (id, tenant_id, target_type, step_number, is_explicit_auto_approve, is_active)
             VALUES ($1, $2, $3, 0, TRUE, TRUE)`,
            [randomUUID(), tenantId, testTargetType],
          );
          // 少し待機してロック保持中に相手を待たせる
          await new Promise((r) => setTimeout(r, 50));
          await client1.query('COMMIT');
          return { success: true };
        } catch (e: any) {
          await client1.query('ROLLBACK');
          return { success: false, error: e };
        }
      };

      const task2 = async () => {
        try {
          await client2.query('BEGIN');
          await client2.query(
            `INSERT INTO approval_rules (id, tenant_id, target_type, step_number, approver_user_id, is_explicit_auto_approve, is_active)
             VALUES ($1, $2, $3, 1, $4, FALSE, TRUE)`,
            [randomUUID(), tenantId, testTargetType, ownerUserId],
          );
          await new Promise((r) => setTimeout(r, 50));
          await client2.query('COMMIT');
          return { success: true };
        } catch (e: any) {
          await client2.query('ROLLBACK');
          return { success: false, error: e };
        }
      };

      const [res1, res2] = await Promise.all([task1(), task2()]);
      const successCount = (res1.success ? 1 : 0) + (res2.success ? 1 : 0);
      const failCount = (!res1.success ? 1 : 0) + (!res2.success ? 1 : 0);

      if (successCount !== 1 || failCount !== 1) {
        throw new Error(`FAIL: 並行INSERTで混在または全滅が発生しました (success=${successCount}, fail=${failCount})`);
      }
      const failedRes = res1.success ? res2 : res1;
      if (failedRes.error?.code !== '23514') {
        throw new Error(`FAIL: 並行INSERTの失敗エラーコードが 23514 ではありません: ${failedRes.error?.code}`);
      }
      console.log('  [PASS] 並行INSERTテスト成功: advisory lockにより一方のみ成功、もう一方は23514で確実に拒否された (BLOCKER-01)');
    } finally {
      client1.release();
      client2.release();
    }

    console.log('[RBAC E2E] 全ての検証項目に合格しました！');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('[RBAC E2E エラー]:', err);
  process.exit(1);
});
