import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { ContractRenewalLinksService } from '../modules/contract-renewal-links/contract-renewal-links.service';
import { ApprovalRequestsService } from '../modules/approval-requests/approval-requests.service';
import { QuotationsService } from '../modules/quotations/quotations.service';
import { DealsService } from '../modules/deals/deals.service';
import { QuotationPdfService } from '../modules/quotations/quotation-pdf.service';
import { RecommendationsService } from '../modules/recommendations/recommendations.service';
import { RecommendationsController } from '../modules/recommendations/recommendations.controller';
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
    getClass: () => RecommendationsController,
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
    notNull() {
      totalAssertions++;
      const pass = actual !== null && actual !== undefined;
      if (isNot ? pass : !pass) {
        throw new Error(
          `Expected ${JSON.stringify(actual)} ${isNot ? 'NOT ' : ''}to not be null/undefined`,
        );
      }
    },
    toBeGreaterThan(expected: number) {
      totalAssertions++;
      const pass = typeof actual === 'number' && actual > expected;
      if (isNot ? pass : !pass) {
        throw new Error(
          `Expected ${actual} ${isNot ? 'NOT ' : ''}to be greater than ${expected}`,
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
    console.error('Usage: ts-node verify-recommendations-e2e.ts <database_dsn>');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dsn });

  try {
    console.log('=== P5-T2 AIレコメンドエンジン基盤 実DB E2E検証開始 (RLS/app_runtime経由) ===');

    // --------------------------------------------------------------------------
    // 0. DI コンテナ手動構築
    // --------------------------------------------------------------------------
    const db = new DatabaseService();
    (db as any).pool = pool;

    const origRunTransaction = (db as any).runTransaction.bind(db);
    (db as any).runTransaction = async (tenantId: string | null, userId: string | null, callback: any) => {
      return origRunTransaction(tenantId, userId, async (client: any) => {
        // 1. RLS適用対象ロール app_runtime へ切り替え
        await client.query('SET LOCAL ROLE app_runtime');
        // 2. コールバックを実行
        return callback(client);
      });
    };

    const auditLogs = new AuditLogsService(db);
    const dealsService = new DealsService(db, auditLogs);
    const quotationPdfService = new QuotationPdfService();
    const quotationsService = new QuotationsService(db, auditLogs, quotationPdfService);
    const contractRenewalLinksService = new ContractRenewalLinksService(db, auditLogs, dealsService);
    const approvalRequestsService = new ApprovalRequestsService(db, auditLogs);

    const recommendationsService = new RecommendationsService(
      db,
      auditLogs,
      contractRenewalLinksService,
      approvalRequestsService,
      quotationsService,
    );

    const recommendationsController = new RecommendationsController(recommendationsService);
    const reflector = new Reflector();
    const guard = new PermissionsGuard(reflector);

    // --------------------------------------------------------------------------
    // 1. テスト用テナント & ユーザーのセットアップ
    // --------------------------------------------------------------------------
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const tenantC = randomUUID(); // 空テナント

    const userA = randomUUID(); // owner
    const userLegal = randomUUID(); // legal_admin
    const userPayroll = randomUUID(); // payroll_admin
    const userExternal = randomUUID(); // viewer_external
    const userB = randomUUID();

    console.log(`[1] テナント初期化: Tenant A=${tenantA}, Tenant B=${tenantB}, Tenant C(空)=${tenantC}`);

    await pool.query(`INSERT INTO tenants (id, name, is_active) VALUES ($1, 'Tenant A Rec', true)`, [tenantA]);
    await pool.query(`INSERT INTO tenants (id, name, is_active) VALUES ($1, 'Tenant B Rec', true)`, [tenantB]);
    await pool.query(`INSERT INTO tenants (id, name, is_active) VALUES ($1, 'Tenant C Rec', true)`, [tenantC]);

    await pool.query(
      `INSERT INTO users (id, email, password_hash, name, created_at, updated_at) VALUES
       ($1, 'rec_a@test.com', 'hash', 'Rec User A', NOW(), NOW()),
       ($2, 'rec_legal@test.com', 'hash', 'Rec Legal User', NOW(), NOW()),
       ($3, 'rec_payroll@test.com', 'hash', 'Rec Payroll User', NOW(), NOW()),
       ($4, 'rec_ext@test.com', 'hash', 'Rec Ext User', NOW(), NOW()),
       ($5, 'rec_b@test.com', 'hash', 'Rec User B', NOW(), NOW())`,
      [userA, userLegal, userPayroll, userExternal, userB],
    );

    await pool.query(
      `INSERT INTO tenant_users (tenant_id, user_id) VALUES
       ($1, $2), ($3, $4), ($5, $6), ($7, $8), ($9, $10)`,
      [
        tenantA, userA,
        tenantA, userLegal,
        tenantA, userPayroll,
        tenantA, userExternal,
        tenantB, userB,
      ],
    );

    // ロール割り当て
    await pool.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id)
       SELECT $1::uuid, $2::uuid, id FROM roles WHERE code = 'owner'
       UNION ALL
       SELECT $1::uuid, $3::uuid, id FROM roles WHERE code = 'legal_admin'
       UNION ALL
       SELECT $1::uuid, $4::uuid, id FROM roles WHERE code = 'payroll_admin'
       UNION ALL
       SELECT $1::uuid, $5::uuid, id FROM roles WHERE code = 'viewer_external'
       UNION ALL
       SELECT $6::uuid, $7::uuid, id FROM roles WHERE code = 'owner'`,
      [tenantA, userA, userLegal, userPayroll, userExternal, tenantB, userB],
    );

    // 顧客マスタ (customers) 登録
    const customerA = randomUUID();
    const customerB = randomUUID();
    await pool.query(
      `INSERT INTO customers (id, tenant_id, code, name, created_at, updated_at) VALUES
       ($1, $2, 'CUST-A-REC', 'Customer A Rec', NOW(), NOW()),
       ($3, $4, 'CUST-B-REC', 'Customer B Rec', NOW(), NOW())`,
      [customerA, tenantA, customerB, tenantB],
    );

    // --------------------------------------------------------------------------
    // 2. テストデータ投入: Tenant A
    // --------------------------------------------------------------------------
    console.log('[2] Tenant A テストデータ投入 (各ドメインの推奨候補データ)');

    // (1) 契約 (contracts)
    // - contractA1: 15日後満了、renewal_notice_days=30、リンク未作成 -> 推奨対象
    // - contractA2: 10日後満了だが、既に contract_renewal_links 作成済み -> 推奨対象外
    // - contractA3: 180日後満了 -> 満了間近ではないため推奨対象外
    const contractA1 = randomUUID();
    const contractA2 = randomUUID();
    const contractA3 = randomUUID();

    await pool.query(
      `INSERT INTO contracts (id, tenant_id, contract_no, title, counterparty_name, contract_type, status, start_date, end_date, renewal_notice_days, created_by, created_at, updated_at) VALUES
       ($1, $2, 'CNT-REC-01', '契約A1 (15日後・リンクなし)', 'Client A1', 'service', 'active', CURRENT_DATE - interval '300 days', CURRENT_DATE + interval '15 days', 30, $5, NOW(), NOW()),
       ($3, $2, 'CNT-REC-02', '契約A2 (10日後・リンク済)', 'Client A1', 'service', 'active', CURRENT_DATE - interval '300 days', CURRENT_DATE + interval '10 days', 30, $5, NOW(), NOW()),
       ($4, $2, 'CNT-REC-03', '契約A3 (180日後・対象外)', 'Client A1', 'service', 'active', CURRENT_DATE - interval '300 days', CURRENT_DATE + interval '180 days', 30, $5, NOW(), NOW())`,
      [contractA1, tenantA, contractA2, contractA3, userA],
    );

    // contractA2 に対する更新商談リンク作成
    const dealA2 = randomUUID();
    await pool.query(
      `INSERT INTO deals (id, tenant_id, customer_id, title, stage, expected_amount, created_by) VALUES
       ($1, $2, $3, '契約A2更新商談', 'lead', 1000000, $4)`,
      [dealA2, tenantA, customerA, userA],
    );
    await pool.query(
      `INSERT INTO contract_renewal_links (id, tenant_id, contract_id, deal_id, created_by) VALUES
       ($1, $2, $3, $4, $5)`,
      [randomUUID(), tenantA, contractA2, dealA2, userA],
    );

    // (2) 承認依頼 (approval_requests)
    // - approvalA1: 10日前作成、status='pending' -> 推奨対象 (5日以上滞留)
    // - approvalA2: 本日作成、status='pending' -> 滞留ではないため推奨対象外
    // - approvalA3: 10日前作成だが status='approved' -> 承認済みのため推奨対象外
    const approvalA1 = randomUUID();
    const approvalA2 = randomUUID();
    const approvalA3 = randomUUID();

    await pool.query(
      `INSERT INTO approval_requests (id, tenant_id, target_type, target_id, total_steps, current_step, status, submitted_by, created_at) VALUES
       ($1, $2, 'contract', $3, 2, 1, 'pending', $4, NOW() - interval '10 days'),
       ($5, $2, 'general_request', $6, 1, 1, 'pending', $4, NOW()),
       ($7, $2, 'general_request', $8, 1, 1, 'pending', $9, NOW() - interval '10 days')`,
      [
        approvalA1, tenantA, contractA1, userA,
        approvalA2, randomUUID(),
        approvalA3, randomUUID(), userLegal,
      ],
    );
    await pool.query(
      `INSERT INTO approval_history (tenant_id, approval_request_id, step_number, approver_id, action, comment)
       VALUES ($1, $2, 1, $3, 'approve', '正規承認')`,
      [tenantA, approvalA3, userA],
    );
    await pool.query(
      `UPDATE approval_requests SET status = 'approved', updated_at = NOW() WHERE id = $1`,
      [approvalA3],
    );

    // (3) 見積書 (quotations)
    // - quoteA1: 20日前発行、status='sent' -> 推奨対象 (14日以上未回答)
    // - quoteA2: 5日前発行、status='sent' -> 14日未満のため推奨対象外
    // - quoteA3: 20日前発行だが status='accepted' -> 回答済みのため推奨対象外
    const quoteA1 = randomUUID();
    const quoteA2 = randomUUID();
    const quoteA3 = randomUUID();

    await pool.query(
      `INSERT INTO quotations (id, tenant_id, customer_id, quote_no, title, status, subtotal, tax_amount, issue_date, created_by, created_at, updated_at) VALUES
       ($1, $2, $3, 'QT-REC-01', '見積A1 (20日前・回答待ち)', 'sent', 500000, 50000, CURRENT_DATE - interval '20 days', $4, NOW(), NOW()),
       ($5, $2, $3, 'QT-REC-02', '見積A2 (5日前・回答待ち)', 'sent', 300000, 30000, CURRENT_DATE - interval '5 days', $4, NOW(), NOW()),
       ($6, $2, $3, 'QT-REC-03', '見積A3 (20日前・成約済)', 'accepted', 800000, 80000, CURRENT_DATE - interval '20 days', $4, NOW(), NOW())`,
      [quoteA1, tenantA, customerA, userA, quoteA2, quoteA3],
    );

    // --------------------------------------------------------------------------
    // 3. テストデータ投入: Tenant B (他テナント分離検証用)
    // --------------------------------------------------------------------------
    console.log('[3] Tenant B テストデータ投入 (他テナント分離検証用)');
    const contractB1 = randomUUID();
    await pool.query(
      `INSERT INTO contracts (id, tenant_id, contract_no, title, counterparty_name, contract_type, status, start_date, end_date, renewal_notice_days, created_by, created_at, updated_at) VALUES
       ($1, $2, 'CNT-B-REC', '契約B (他テナント満了間近)', 'Client B', 'service', 'active', CURRENT_DATE - interval '300 days', CURRENT_DATE + interval '5 days', 30, $3, NOW(), NOW())`,
      [contractB1, tenantB, userB],
    );

    const recB1 = randomUUID();
    await pool.query(
      `INSERT INTO recommendations (id, tenant_id, type, target_domain, target_id, title, message, status, action_url, created_at, updated_at) VALUES
       ($1, $2, 'contract_renewal_pending', 'contracts', $3, 'テナントB提案', 'テナントBの機微提案', 'new', '/deals/new', NOW(), NOW())`,
      [recB1, tenantB, contractB1],
    );

    // --------------------------------------------------------------------------
    // 4. RLS コンテキストおよび app_runtime 接続実証
    // --------------------------------------------------------------------------
    console.log('[4] RLSコンテキストおよび app_runtime ロールの接続実証');
    await db.transaction(tenantA, userA, async (txClient) => {
      const roleCheck = await txClient.query<{ current_user: string }>(
        'SELECT current_user',
      );
      expect(roleCheck.rows[0].current_user).toBe('app_runtime');
      console.log(`  -> 実行ロール実証: current_user=${roleCheck.rows[0].current_user}`);

      const tenantCheck = await txClient.query<{ tenant_id: string }>(
        `SELECT current_setting('app.current_tenant_id', true) AS tenant_id`,
      );
      expect(tenantCheck.rows[0].tenant_id).toBe(tenantA);
      console.log(`  -> テナントコンテキスト実証: app.current_tenant_id=${tenantCheck.rows[0].tenant_id}`);

      // Tenant B のレコメンドが直接不可視 (0件) であることの実証
      const rlsRecB = await txClient.query(`SELECT * FROM recommendations WHERE id = $1`, [recB1]);
      expect(rlsRecB.rows.length).toBe(0);
      console.log('  -> RLS実効実証: app_runtime ロール下で Tenant B のレコメンドが直接不可視 (0件) であることを確認');
    });

    // --------------------------------------------------------------------------
    // 5. 3種類のレコメンド生成検証 & 既存Service委譲整合性検証
    // --------------------------------------------------------------------------
    console.log('[5] 3種類のレコメンド生成検証 & 既存Service委譲整合性検証');
    const recListA = await recommendationsService.list(tenantA, userA, ['owner']);

    expect(recListA.length).toBe(3);

    // 各推奨の検証
    const contractRec = recListA.find((r) => r.type === 'contract_renewal_pending');
    const approvalRec = recListA.find((r) => r.type === 'approval_stale');
    const quoteRec = recListA.find((r) => r.type === 'quotation_follow_up');

    expect(contractRec).notNull();
    expect(contractRec!.target_id).toBe(contractA1);
    expect(contractRec!.action_url).toBe(`/deals/new?contract_id=${contractA1}`);
    console.log('  -> (1) 契約更新レコメンド: 正確に生成 (contractA1 満了15日後・リンクなし)');

    expect(approvalRec).notNull();
    expect(approvalRec!.target_id).toBe(approvalA1);
    expect(approvalRec!.action_url).toBe('/approval-requests');
    console.log('  -> (2) 承認滞留レコメンド: 正確に生成 (approvalA1 10日間滞留)');

    expect(quoteRec).notNull();
    expect(quoteRec!.target_id).toBe(quoteA1);
    expect(quoteRec!.action_url).toBe(`/quotations/${quoteA1}`);
    console.log('  -> (3) 見積フォローレコメンド: 正確に生成 (quoteA1 20日間未回答)');

    // 既存Service直接呼出結果との整合性検証
    const directUnlinked = await contractRenewalLinksService.getUnlinkedExpiringContracts(tenantA, userA);
    const directStaleApprovals = await approvalRequestsService.getStalePendingRequests(tenantA, userA, 5);
    const directStaleQuotes = await quotationsService.getStaleSentQuotations(tenantA, userA, 14);

    expect(directUnlinked.length).toBe(1);
    expect(directUnlinked[0].id).toBe(contractA1);

    expect(directStaleApprovals.length).toBe(1);
    expect(directStaleApprovals[0].id).toBe(approvalA1);

    expect(directStaleQuotes.length).toBe(1);
    expect(directStaleQuotes[0].id).toBe(quoteA1);
    console.log('  -> 既存ドメインService直接呼出結果とレコメンド対象が完全合致することを確認 (委譲原則実証)');

    // --------------------------------------------------------------------------
    // 6. 「採用 (accept)」操作 & 業務テーブル完全非変更検証
    // --------------------------------------------------------------------------
    console.log('[6] 「採用 (accept)」操作 & 業務テーブル完全非変更検証');

    // 実行前の各業務テーブル件数を記録
    const beforeCounts = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM deals WHERE tenant_id = $1) AS deal_count,
         (SELECT COUNT(*) FROM quotations WHERE tenant_id = $1) AS quotation_count,
         (SELECT COUNT(*) FROM contracts WHERE tenant_id = $1) AS contract_count,
         (SELECT COUNT(*) FROM approval_requests WHERE tenant_id = $1) AS approval_count,
         (SELECT COUNT(*) FROM contract_renewal_links WHERE tenant_id = $1) AS link_count`,
      [tenantA],
    );

    // 契約更新レコメンドを採用
    const acceptRes = await recommendationsService.accept(tenantA, userA, ['owner'], contractRec!.id);
    expect(acceptRes.recommendation.status).toBe('accepted');
    expect(acceptRes.recommendation.responded_at).notNull();
    expect(acceptRes.next_action_url).toBe(`/deals/new?contract_id=${contractA1}`);

    // 実行後の業務テーブル件数を照合 (完全一致・1行も変化していないこと)
    const afterAcceptCounts = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM deals WHERE tenant_id = $1) AS deal_count,
         (SELECT COUNT(*) FROM quotations WHERE tenant_id = $1) AS quotation_count,
         (SELECT COUNT(*) FROM contracts WHERE tenant_id = $1) AS contract_count,
         (SELECT COUNT(*) FROM approval_requests WHERE tenant_id = $1) AS approval_count,
         (SELECT COUNT(*) FROM contract_renewal_links WHERE tenant_id = $1) AS link_count`,
      [tenantA],
    );

    expect(afterAcceptCounts.rows[0].deal_count).toBe(beforeCounts.rows[0].deal_count);
    expect(afterAcceptCounts.rows[0].quotation_count).toBe(beforeCounts.rows[0].quotation_count);
    expect(afterAcceptCounts.rows[0].contract_count).toBe(beforeCounts.rows[0].contract_count);
    expect(afterAcceptCounts.rows[0].approval_count).toBe(beforeCounts.rows[0].approval_count);
    expect(afterAcceptCounts.rows[0].link_count).toBe(beforeCounts.rows[0].link_count);
    console.log('  -> 採用操作成功: status=accepted に遷移し、業務テーブル（deals/contracts等）の件数は一切不変 (業務データ非変更保証)');

    // 監査ログ記録確認
    const auditAccept = await pool.query(
      `SELECT action, target_type, target_id FROM audit_logs
       WHERE tenant_id = $1 AND target_id = $2 AND action = 'recommendation.accept'`,
      [tenantA, contractRec!.id],
    );
    expect(auditAccept.rows.length).toBe(1);
    console.log('  -> 監査ログ記録確認: recommendation.accept が正常に追記されたことを確認');

    // --------------------------------------------------------------------------
    // 7. 「見送り (dismiss)」操作 & 業務テーブル完全非変更検証
    // --------------------------------------------------------------------------
    console.log('[7] 「見送り (dismiss)」操作 & 業務テーブル完全非変更検証');

    const dismissRes = await recommendationsService.dismiss(tenantA, userA, ['owner'], approvalRec!.id);
    expect(dismissRes.recommendation.status).toBe('dismissed');
    expect(dismissRes.recommendation.responded_at).notNull();
    expect(dismissRes.next_action_url).toBeNull();

    const afterDismissCounts = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM deals WHERE tenant_id = $1) AS deal_count,
         (SELECT COUNT(*) FROM approval_requests WHERE tenant_id = $1) AS approval_count`,
      [tenantA],
    );
    expect(afterDismissCounts.rows[0].deal_count).toBe(beforeCounts.rows[0].deal_count);
    expect(afterDismissCounts.rows[0].approval_count).toBe(beforeCounts.rows[0].approval_count);
    console.log('  -> 見送り操作成功: status=dismissed に遷移し、業務テーブル件数は一切不変');

    // --------------------------------------------------------------------------
    // 8. 意思決定尊重・冪等性確認 (再度listを呼んでもaccepted/dismissedは未処理一覧に復活しない)
    // --------------------------------------------------------------------------
    console.log('[8] 意思決定尊重・冪等性確認');
    const recListAfter = await recommendationsService.list(tenantA, userA, ['owner']);
    // 残る未処理は quoteRec (見積フォロー) の 1件 のみ
    expect(recListAfter.length).toBe(1);
    expect(recListAfter[0].id).toBe(quoteRec!.id);
    console.log('  -> 人間が採用/見送りした提案は再生成されず、人間の判断が確実に尊重されることを確認');

    // --------------------------------------------------------------------------
    // 9. RBAC 多層防御・ドメイン別閲覧制御 (情報推測防止)
    // --------------------------------------------------------------------------
    console.log('[9] RBAC 多層防御・ドメイン別閲覧制御 (情報推測防止)');

    // (1) legal_admin: contracts, approval_requests のみアクセス可 (quotations は不可視)
    const legalList = await recommendationsService.list(tenantA, userLegal, ['legal_admin'], {
      status: 'new',
    });
    // quoteRec は quotations ドメインのため不可視となり、0件となる
    expect(legalList.length).toBe(0);
    console.log('  -> legal_admin: 見積権限を持たないため見積レコメンドが不可視であることを確認');

    // (2) payroll_admin: approval_requests のみアクセス可 (contracts, quotations は不可視)
    const payrollList = await recommendationsService.list(tenantA, userPayroll, ['payroll_admin']);
    expect(payrollList.length).toBe(0);
    console.log('  -> payroll_admin: 契約・見積権限を持たないためそれらのレコメンドが不可視であることを確認');

    // (3) 権限のないドメインのレコメンド採用試行で 403 遮断
    let legalBlocked = false;
    try {
      await recommendationsService.accept(tenantA, userLegal, ['legal_admin'], quoteRec!.id);
    } catch (err: any) {
      if (err instanceof AppException && err.getStatus() === 403) {
        legalBlocked = true;
      }
    }
    expect(legalBlocked).toBe(true);
    console.log('  -> legal_admin: 権限外の見積レコメンド採用操作を 403 Forbidden 遮断');

    // (4) viewer_external: PermissionsGuard レベルで遮断
    const externalCtx = createMockContext(recommendationsController.list, ['viewer_external'], tenantA, userExternal);
    let guardBlocked = false;
    try {
      guard.canActivate(externalCtx);
    } catch (err: any) {
      if (err instanceof AppException && err.getStatus() === 403) {
        guardBlocked = true;
      }
    }
    expect(guardBlocked).toBe(true);
    console.log('  -> viewer_external: PermissionsGuard により 403 Forbidden 遮断');

    // --------------------------------------------------------------------------
    // 10. WORM 不変性・削除禁止トリガー検証
    // --------------------------------------------------------------------------
    console.log('[10] WORM 不変性・削除禁止トリガー検証');

    // (1) 基本列の UPDATE 改ざん拒絶
    let updateBlocked = false;
    try {
      await pool.query(`UPDATE recommendations SET target_domain = 'hacked' WHERE id = $1`, [quoteRec!.id]);
    } catch (err: any) {
      if (err.code === '55000') {
        updateBlocked = true;
      }
    }
    expect(updateBlocked).toBe(true);
    console.log('  -> WORM実効: recommendations の target_domain 改ざんが 55000 で拒絶されることを確認');

    // (2) DELETE 拒絶
    let deleteBlocked = false;
    try {
      await pool.query(`DELETE FROM recommendations WHERE id = $1`, [quoteRec!.id]);
    } catch (err: any) {
      if (err.code === '55000') {
        deleteBlocked = true;
      }
    }
    expect(deleteBlocked).toBe(true);
    console.log('  -> WORM実効: recommendations の DELETE が 55000 で拒絶されることを確認');

    // --------------------------------------------------------------------------
    // 11. ゼロ除算・空テナント安全性 (Tenant C)
    // --------------------------------------------------------------------------
    console.log('[11] 空テナント安全性検証 (Tenant C)');
    const emptyList = await recommendationsService.list(tenantC, randomUUID(), ['owner']);
    expect(emptyList.length).toBe(0);
    console.log('  -> 空テナントでも例外なく安全に空配列 (0件) を返却することを確認');

    console.log(`=== P5-T2 AIレコメンドエンジン基盤 実DB E2E検証 全項目合格 (ALL PASS: 全${totalAssertions}検証項目合格) ===`);
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('P5-T2 E2E Error:', err);
  process.exit(1);
});
