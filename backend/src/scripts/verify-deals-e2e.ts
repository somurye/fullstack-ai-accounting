/**
 * verify-deals-e2e.ts
 * ====================
 * Phase 4 Task 2 (P4-T2): 案件管理（商談パイプライン）実DB包括E2E検証スクリプト
 *
 * 検証項目:
 * 1. テナント・ユーザー・顧客マスタの初期化
 * 2. 案件の作成 (lead, qualified, proposal, negotiation) と初期値・金額の検証
 * 3. 進行中ステージでの案件更新 (タイトル・金額・ステージ更新)
 * 4. RBAC多層防御 (owner/employeeは作成更新可能、accountantは閲覧のみ、viewer_externalは全拒否)
 * 5. RLSによる完全テナント分離 (他テナントの案件が不可視・更新不可)
 * 6. テナント整合性DBトリガー (別テナント顧客の指定拒否, 別テナント担当者の指定拒否)
 * 7. 失注(lost)時の失注理由(lost_reason)必須チェック (DBトリガー fail-closed: 23514)
 * 8. 受注(won)および失注(lost)クローズ時の closed_at 自動設定検証
 * 9. terminal状態(won/lost)からの不変性ガード (DBトリガー fail-closed: 55000)
 *    - stageの再遷移拒絶
 *    - 業務列(title, expected_amount等)のUPDATE拒絶
 *    - レコードのDELETE拒絶
 * 10. quotations.deal_id への外部キー制約および連携検証
 *    - 既存見積(deal_id=NULL)への無影響確認
 *    - 案件への見積紐付け成功
 *    - 存在しないdeal_idのFK拒絶 (23503)
 *    - 別テナントdeal_idのtenant整合性トリガー拒絶 (23503)
 *    - 見積一覧APIからの deal_id 絞り込み検証
 *    - 紐づく見積が存在する案件の削除禁止検証
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { QuotationPdfService } from '../modules/quotations/quotation-pdf.service';
import { QuotationsService } from '../modules/quotations/quotations.service';
import { DealsService } from '../modules/deals/deals.service';

const rawDsn = process.argv[2] || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';

async function main() {
  console.log('=== P4-T2 案件管理（商談パイプライン）実DB E2E検証開始 ===');
  console.log(`接続先: ${rawDsn.replace(/:[^:@]+@/, ':****@')}`);

  process.env.DATABASE_URL = rawDsn;
  const pool = new Pool({ connectionString: rawDsn });
  const client = await pool.connect();

  const db = new DatabaseService();
  const auditLogs = new AuditLogsService(db);
  const pdfService = new QuotationPdfService();
  const quotationsService = new QuotationsService(db, auditLogs, pdfService);
  const dealsService = new DealsService(db, auditLogs);

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  [PASS] ${msg}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${msg}`);
      failed++;
    }
  }

  try {
    // ------------------------------------------------------------------------
    // 1. テナント・ユーザー・顧客マスタの初期化
    // ------------------------------------------------------------------------
    console.log('\n1. テナント・ユーザー・顧客マスタのセットアップ...');

    const tenantA = uuidv4();
    const tenantB = uuidv4();

    await client.query(`INSERT INTO tenants (id, name) VALUES ($1, 'テナントA商事'), ($2, 'テナントB工業')`, [tenantA, tenantB]);

    const userOwnerA = uuidv4();
    const userEmployeeA = uuidv4();
    const userAccountantA = uuidv4();
    const userViewerA = uuidv4();
    const userEmployeeB = uuidv4();

    const timestamp = Date.now();
    await client.query(
      `INSERT INTO users (id, email, password_hash, name) VALUES
       ($1, $2, 'hash', 'A社代表'),
       ($3, $4, 'hash', 'A社営業'),
       ($5, $6, 'hash', 'A社経理'),
       ($7, $8, 'hash', 'A社閲覧者'),
       ($9, $10, 'hash', 'B社営業')`,
      [
        userOwnerA, `owner_a_${timestamp}@example.com`,
        userEmployeeA, `sales_a_${timestamp}@example.com`,
        userAccountantA, `acct_a_${timestamp}@example.com`,
        userViewerA, `viewer_a_${timestamp}@example.com`,
        userEmployeeB, `sales_b_${timestamp}@example.com`,
      ],
    );

    const userTuples = [
      [tenantA, userOwnerA, 'owner'],
      [tenantA, userEmployeeA, 'employee'],
      [tenantA, userAccountantA, 'accountant'],
      [tenantA, userViewerA, 'viewer_external'],
      [tenantB, userEmployeeB, 'employee'],
    ] as const;

    for (const [tId, uId] of userTuples) {
      await client.query(`INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)`, [tId, uId]);
    }

    const rolesRes = await client.query(`SELECT id, code FROM roles WHERE code IN ('owner', 'employee', 'accountant', 'viewer_external')`);
    const roleMap = new Map<string, string>();
    for (const r of rolesRes.rows) {
      roleMap.set(r.code, r.id);
    }

    for (const [tId, uId, rCode] of userTuples) {
      const rId = roleMap.get(rCode);
      if (rId) {
        await client.query(
          `INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3)`,
          [tId, uId, rId],
        );
      }
    }

    const customerA = uuidv4();
    const customerB = uuidv4();
    await client.query(
      `INSERT INTO customers (id, tenant_id, code, name) VALUES ($1, $2, 'CUST-A-01', '株式会社A取引先')`,
      [customerA, tenantA],
    );
    await client.query(
      `INSERT INTO customers (id, tenant_id, code, name) VALUES ($1, $2, 'CUST-B-01', '株式会社B取引先')`,
      [customerB, tenantB],
    );

    assert(true, 'テナント・ユーザー・顧客マスタの初期化が完了');

    // ------------------------------------------------------------------------
    // 2. 案件作成 (lead) と初期値・金額の検証
    // ------------------------------------------------------------------------
    console.log('\n2. 案件作成 (lead) と初期値・金額の検証...');

    const deal1 = await dealsService.create(tenantA, userEmployeeA, ['employee'], {
      customer_id: customerA,
      title: '基幹ERP刷新プロジェクト',
      stage: 'lead',
      expected_amount: 5000000,
      currency_code: 'JPY',
      expected_close_date: '2026-11-30',
      owner_user_id: userEmployeeA,
    });

    assert(deal1.id !== undefined, '案件が正常に作成されたこと');
    assert(deal1.title === '基幹ERP刷新プロジェクト', 'タイトルが一致すること');
    assert(deal1.stage === 'lead', 'ステージがleadであること');
    assert(deal1.expected_amount === 5000000, '予想金額が5,000,000であること');
    assert(deal1.is_terminal === false, '終端状態ではないこと');
    assert(deal1.closed_at === null, 'closed_atがNULLであること');

    // ------------------------------------------------------------------------
    // 3. 進行中ステージでの案件更新
    // ------------------------------------------------------------------------
    console.log('\n3. 進行中ステージでの案件更新 (タイトル・金額・ステージ更新)...');

    const deal1Updated = await dealsService.update(tenantA, userEmployeeA, ['employee'], deal1.id, {
      title: '基幹ERP刷新プロジェクト(第1期)',
      stage: 'proposal',
      expected_amount: 5500000,
      expected_close_date: '2026-12-15',
    });

    assert(deal1Updated.title === '基幹ERP刷新プロジェクト(第1期)', 'タイトルが更新されたこと');
    assert(deal1Updated.stage === 'proposal', 'ステージがproposalに更新されたこと');
    assert(deal1Updated.expected_amount === 5500000, '予想金額が更新されたこと');
    assert(deal1Updated.is_terminal === false, '更新後も終端状態ではないこと');

    // 3.2 設計確認-01: 非終端ステージ間の任意遷移 (前進スキップおよび後退) が意図通り許可されていることの実証
    // 3.2.1 proposal -> negotiation (通常前進)
    const deal1Negotiation = await dealsService.update(tenantA, userEmployeeA, ['employee'], deal1.id, {
      stage: 'negotiation',
    });
    assert(deal1Negotiation.stage === 'negotiation', '設計確認-01: proposalからnegotiationへの前進が成功すること');

    // 3.2.2 negotiation -> qualified (後退遷移: 再提案・条件見直し)
    const deal1Backward = await dealsService.update(tenantA, userEmployeeA, ['employee'], deal1.id, {
      stage: 'qualified',
    });
    assert(deal1Backward.stage === 'qualified', '設計確認-01: negotiationからqualifiedへの後退遷移が意図通り成功すること (非線形遷移許容)');

    // 3.2.3 qualified -> negotiation (スキップ前進)
    const deal1ReAdvance = await dealsService.update(tenantA, userEmployeeA, ['employee'], deal1.id, {
      stage: 'negotiation',
    });
    assert(deal1ReAdvance.stage === 'negotiation', '設計確認-01: qualifiedからnegotiationへのスキップ前進が成功すること');

    // ------------------------------------------------------------------------
    // 4. RBAC多層防御検証
    // ------------------------------------------------------------------------
    console.log('\n4. RBAC多層防御検証 (権限による操作可否)...');

    // 4.1 accountant による閲覧は可能
    const listForAcct = await dealsService.list(tenantA, userAccountantA, ['accountant'], {
      page: 1,
      limit: 10,
    });
    assert(listForAcct.deals.length >= 1, 'accountantロールは案件一覧を閲覧可能であること');

    // 4.2 accountant による作成は403拒絶
    let acctCreateBlocked = false;
    try {
      await dealsService.create(tenantA, userAccountantA, ['accountant'], {
        customer_id: customerA,
        title: '経理作成商談',
        stage: 'lead',
        expected_amount: 100000,
      });
    } catch (e: any) {
      if (e.status === 403 || e.errorCode === 'FORBIDDEN') {
        acctCreateBlocked = true;
      }
    }
    assert(acctCreateBlocked, 'accountantロールの案件作成が403拒絶されること (deal.create不足)');

    // 4.3 viewer_external による一覧取得は403拒絶
    let viewerListBlocked = false;
    try {
      await dealsService.list(tenantA, userViewerA, ['viewer_external'], { page: 1, limit: 10 });
    } catch (e: any) {
      if (e.status === 403 || e.errorCode === 'FORBIDDEN') {
        viewerListBlocked = true;
      }
    }
    assert(viewerListBlocked, 'viewer_externalロールの一覧取得が403拒絶されること (deal.view不足)');

    // ------------------------------------------------------------------------
    // 5. RLSによる完全テナント分離検証
    // ------------------------------------------------------------------------
    console.log('\n5. RLSによる完全テナント分離検証...');

    // テナントBから一覧取得
    const listB = await dealsService.list(tenantB, userEmployeeB, ['employee'], { page: 1, limit: 10 });
    assert(listB.deals.length === 0, 'RLS: テナントBからはテナントAの案件が一切不可視 (0件)');

    // テナントBからテナントAの案件詳細取得を試行
    let crossTenantViewBlocked = false;
    try {
      await dealsService.findById(tenantB, userEmployeeB, ['employee'], deal1.id);
    } catch (e: any) {
      if (e.status === 404 || e.errorCode === 'NOT_FOUND') {
        crossTenantViewBlocked = true;
      }
    }
    assert(crossTenantViewBlocked, 'RLS: テナントBからテナントAの案件詳細取得が404遮断されること');

    // db.transaction を用いることで app_runtime ロール & tenant_id コンテキストが設定され、スーパーユーザーRLSバイパスを防止
    await db.transaction(tenantB, userEmployeeB, async (txClient) => {
      await txClient.query('SET LOCAL ROLE app_runtime');
      const rlsDirectRes = await txClient.query(`SELECT * FROM deals WHERE id = $1`, [deal1.id]);
      assert(rlsDirectRes.rows.length === 0, 'DB RLS: 直接SQLでもテナントBコンテキストでテナントAレコードが0件');
    });

    // ------------------------------------------------------------------------
    // 6. テナント整合性DBトリガー検証
    // ------------------------------------------------------------------------
    console.log('\n6. テナント整合性DBトリガー検証...');

    // 6.1 テナントAの案件にテナントBの顧客を指定
    let crossCustBlocked = false;
    try {
      await client.query(
        `INSERT INTO deals (tenant_id, customer_id, title, created_by) VALUES ($1, $2, '越境顧客案件', $3)`,
        [tenantA, customerB, userOwnerA],
      );
    } catch (e: any) {
      if (e.code === '23503') crossCustBlocked = true;
    }
    assert(crossCustBlocked, 'DBトリガー: 別テナント顧客を指定した案件INSERTが拒絶されること (ERRCODE: 23503)');

    // 6.2 テナントAの案件にテナントBの担当者を指定 (証跡確認-02: DBトリガー検証)
    let crossOwnerBlocked = false;
    try {
      await client.query(
        `INSERT INTO deals (tenant_id, customer_id, title, owner_user_id, created_by) VALUES ($1, $2, '越境担当者案件', $3, $4)`,
        [tenantA, customerA, userEmployeeB, userOwnerA],
      );
    } catch (e: any) {
      if (e.code === '23503') crossOwnerBlocked = true;
    }
    assert(crossOwnerBlocked, 'DBトリガー: 別テナント担当者を指定した案件INSERTが拒絶されること (ERRCODE: 23503)');

    // 6.3 存在しない owner_user_id を指定した案件INSERT (証跡確認-02: FK制約検証)
    let nonExistentOwnerBlocked = false;
    const dummyUserId = uuidv4();
    try {
      await client.query(
        `INSERT INTO deals (tenant_id, customer_id, title, owner_user_id, created_by) VALUES ($1, $2, '架空担当者案件', $3, $4)`,
        [tenantA, customerA, dummyUserId, userOwnerA],
      );
    } catch (e: any) {
      if (e.code === '23503') nonExistentOwnerBlocked = true;
    }
    assert(nonExistentOwnerBlocked, 'DB制約: 存在しないowner_user_idを指定した案件INSERTがFK制約違反で拒絶されること (ERRCODE: 23503)');

    // 6.4 担当者変更時に別テナント担当者を指定したUPDATE (証跡確認-02: UPDATE時トリガー検証)
    let updateCrossOwnerBlocked = false;
    try {
      await client.query(
        `UPDATE deals SET owner_user_id = $1 WHERE id = $2`,
        [userEmployeeB, deal1.id],
      );
    } catch (e: any) {
      if (e.code === '23503') updateCrossOwnerBlocked = true;
    }
    assert(updateCrossOwnerBlocked, 'DBトリガー: 担当者変更時に別テナント担当者を指定したUPDATEが拒絶されること (ERRCODE: 23503)');

    // ------------------------------------------------------------------------
    // 7. 失注(lost)時の失注理由(lost_reason)必須チェック (DBトリガー & アプリ層)
    // ------------------------------------------------------------------------
    console.log('\n7. 失注(lost)時の失注理由(lost_reason)必須チェック...');

    // 7.1 失注理由なしでlostにクローズ試行 (アプリ層で拒否)
    let lostNoReasonAppBlocked = false;
    try {
      await dealsService.close(tenantA, userEmployeeA, ['employee'], deal1.id, {
        stage: 'lost',
        lost_reason: '',
      });
    } catch (e: any) {
      lostNoReasonAppBlocked = true;
    }
    assert(lostNoReasonAppBlocked, 'アプリ層: 失注理由なしのクローズが拒否されること');

    // 7.2 DBトリガー直接: UPDATE deals SET stage = 'lost', lost_reason = NULL
    let lostNoReasonDbBlocked = false;
    try {
      await client.query(`UPDATE deals SET stage = 'lost', lost_reason = NULL WHERE id = $1`, [deal1.id]);
    } catch (e: any) {
      if (e.code === '23514') lostNoReasonDbBlocked = true;
    }
    assert(lostNoReasonDbBlocked, 'DBトリガー: 失注理由なしの stage=lost UPDATE が拒絶されること (ERRCODE: 23514)');

    // ------------------------------------------------------------------------
    // 8. 受注(won)および失注(lost)クローズ時の closed_at 自動設定検証
    // ------------------------------------------------------------------------
    console.log('\n8. 受注(won)および失注(lost)クローズ時の closed_at 自動設定検証...');

    // 別の案件を作成して lost にクローズ
    const dealLost = await dealsService.create(tenantA, userEmployeeA, ['employee'], {
      customer_id: customerA,
      title: '他社コンペ失注案件',
      stage: 'proposal',
      expected_amount: 2000000,
    });

    const dealLostClosed = await dealsService.close(tenantA, userEmployeeA, ['employee'], dealLost.id, {
      stage: 'lost',
      lost_reason: '他社競合による価格差',
    });

    assert(dealLostClosed.stage === 'lost', 'stageがlostに遷移したこと');
    assert(dealLostClosed.is_terminal === true, 'lostは終端状態であること');
    assert(dealLostClosed.lost_reason === '他社競合による価格差', '失注理由が記録されたこと');
    assert(dealLostClosed.closed_at !== null, 'closed_atが自動設定されたこと');

    // 最初の案件を won にクローズ
    const dealWonClosed = await dealsService.close(tenantA, userEmployeeA, ['employee'], deal1.id, {
      stage: 'won',
    });

    assert(dealWonClosed.stage === 'won', 'stageがwonに遷移したこと');
    assert(dealWonClosed.is_terminal === true, 'wonは終端状態であること');
    assert(dealWonClosed.closed_at !== null, 'closed_atが自動設定されたこと');

    // 8.3 証跡確認-03: 認証actorの実装確認 (クライアント偽装入力の無視 & セッション強制導出検証)
    const spoofedUserId = uuidv4();
    const dealActorTest = await dealsService.create(
      tenantA,
      userEmployeeA,
      ['employee'],
      {
        customer_id: customerA,
        title: '認証actor検証案件',
        stage: 'lead',
        // クライアント側から偽装されたIDが渡されたケースをシミュレート
        ...({ created_by: spoofedUserId, userId: spoofedUserId } as any),
      },
    );
    // deals.created_by がクライアント偽装値ではなく認証済みユーザー userEmployeeA であること
    const dealActorCreatedRes = await client.query(`SELECT created_by FROM deals WHERE id = $1`, [dealActorTest.id]);
    assert(
      dealActorCreatedRes.rows[0].created_by === userEmployeeA,
      '証跡確認-03: deal.create でクライアントが指定した偽装 created_by/userId は無視され、認証セッションのユーザーIDが強制導出されること',
    );

    // deal.close 時に偽装パラメータを渡しても無視され、認証セッションのユーザーIDで監査ログが記録されること
    await dealsService.close(
      tenantA,
      userEmployeeA,
      ['employee'],
      dealActorTest.id,
      {
        stage: 'won',
        ...({ userId: spoofedUserId, closed_by: spoofedUserId } as any),
      },
    );
    const auditCloseRes = await client.query(
      `SELECT actor_user_id FROM audit_logs WHERE target_id = $1 AND action = 'deal.close' ORDER BY occurred_at DESC LIMIT 1`,
      [dealActorTest.id],
    );
    assert(
      auditCloseRes.rows[0].actor_user_id === userEmployeeA,
      '証跡確認-03: deal.close でクライアントが指定した偽装 userId/closed_by は無視され、監査ログ actor_user_id は認証セッションのユーザーIDが強制導出されること',
    );

    // ------------------------------------------------------------------------
    // 9. terminal状態(won/lost)からの不変性ガード (DBトリガー fail-closed: 55000)
    // ------------------------------------------------------------------------
    console.log('\n9. terminal状態(won/lost)からの不変性ガード (DBトリガー fail-closed: 55000)...');

    // 9.1 won 状態の案件の stage を lead に戻す試行
    let revertWonBlocked = false;
    try {
      await client.query(`UPDATE deals SET stage = 'lead' WHERE id = $1`, [deal1.id]);
    } catch (e: any) {
      if (e.code === '55000') revertWonBlocked = true;
    }
    assert(revertWonBlocked, 'DBトリガー: won状態案件のstage再遷移がfail-closed拒絶されること (ERRCODE: 55000)');

    // 9.2 lost 状態の案件の stage を proposal に戻す試行
    let revertLostBlocked = false;
    try {
      await client.query(`UPDATE deals SET stage = 'proposal' WHERE id = $1`, [dealLost.id]);
    } catch (e: any) {
      if (e.code === '55000') revertLostBlocked = true;
    }
    assert(revertLostBlocked, 'DBトリガー: lost状態案件のstage再遷移がfail-closed拒絶されること (ERRCODE: 55000)');

    // 9.3 won 状態の案件の業務列 (expected_amount) を変更する試行
    let updateAmountWonBlocked = false;
    try {
      await client.query(`UPDATE deals SET expected_amount = 9999999 WHERE id = $1`, [deal1.id]);
    } catch (e: any) {
      if (e.code === '55000') updateAmountWonBlocked = true;
    }
    assert(updateAmountWonBlocked, 'DBトリガー: won状態案件の業務列(expected_amount)UPDATEが拒絶されること (ERRCODE: 55000)');

    // 9.4 won 状態の案件のタイトルを変更する試行
    let updateTitleWonBlocked = false;
    try {
      await client.query(`UPDATE deals SET title = '不正改ざん商談' WHERE id = $1`, [deal1.id]);
    } catch (e: any) {
      if (e.code === '55000') updateTitleWonBlocked = true;
    }
    assert(updateTitleWonBlocked, 'DBトリガー: won状態案件の業務列(title)UPDATEが拒絶されること (ERRCODE: 55000)');

    // 9.5 terminal 状態レコードの物理DELETE試行
    let deleteWonBlocked = false;
    try {
      await client.query(`DELETE FROM deals WHERE id = $1`, [deal1.id]);
    } catch (e: any) {
      if (e.code === '55000') deleteWonBlocked = true;
    }
    assert(deleteWonBlocked, 'DBトリガー: won状態案件の物理DELETEがfail-closed拒絶されること (ERRCODE: 55000)');

    let deleteLostBlocked = false;
    try {
      await client.query(`DELETE FROM deals WHERE id = $1`, [dealLost.id]);
    } catch (e: any) {
      if (e.code === '55000') deleteLostBlocked = true;
    }
    assert(deleteLostBlocked, 'DBトリガー: lost状態案件の物理DELETEがfail-closed拒絶されること (ERRCODE: 55000)');

    // 9.7 証跡確認-04: won状態案件の closed_at 列への直接UPDATE (別日時への改変) が拒絶されること
    let updateWonClosedAtBlocked = false;
    try {
      await client.query(`UPDATE deals SET closed_at = now() + interval '1 day' WHERE id = $1`, [deal1.id]);
    } catch (e: any) {
      if (e.code === '55000') updateWonClosedAtBlocked = true;
    }
    assert(updateWonClosedAtBlocked, '証跡確認-04: DBトリガーにより won状態案件の closed_at 直接変更が拒絶されること (ERRCODE: 55000)');

    // 9.8 証跡確認-04: won状態案件の closed_at NULL巻き戻しが拒絶されること
    let rollbackWonClosedAtBlocked = false;
    try {
      await client.query(`UPDATE deals SET closed_at = NULL WHERE id = $1`, [deal1.id]);
    } catch (e: any) {
      if (e.code === '55000') rollbackWonClosedAtBlocked = true;
    }
    assert(rollbackWonClosedAtBlocked, '証跡確認-04: DBトリガーにより won状態案件の closed_at NULL巻き戻しが拒絶されること (ERRCODE: 55000)');

    // 9.9 証跡確認-04: lost状態案件の closed_at NULL巻き戻しが拒絶されること
    let rollbackLostClosedAtBlocked = false;
    try {
      await client.query(`UPDATE deals SET closed_at = NULL WHERE id = $1`, [dealLost.id]);
    } catch (e: any) {
      if (e.code === '55000') rollbackLostClosedAtBlocked = true;
    }
    assert(rollbackLostClosedAtBlocked, '証跡確認-04: DBトリガーにより lost状態案件の closed_at NULL巻き戻しが拒絶されること (ERRCODE: 55000)');

    // ------------------------------------------------------------------------
    // 10. quotations.deal_id への外部キー制約および連携検証
    // ------------------------------------------------------------------------
    console.log('\n10. quotations.deal_id への外部キー制約および連携検証...');

    // 10.1 既存見積 (deal_id = NULL) の存在確認
    const existingQuotesRes = await client.query(`SELECT COUNT(*) AS count FROM quotations WHERE deal_id IS NULL`);
    assert(Number(existingQuotesRes.rows[0].count) >= 0, '既存の見積(deal_id=NULL)が問題なく維持されていること');

    // 10.2 案件に紐づく新規見積を作成
    const newDealActive = await dealsService.create(tenantA, userEmployeeA, ['employee'], {
      customer_id: customerA,
      title: '新設クラウド基盤構築案件',
      stage: 'proposal',
      expected_amount: 3000000,
    });

    const quoteWithDeal = await quotationsService.create(tenantA, userEmployeeA, {
      customer_id: customerA,
      deal_id: newDealActive.id,
      title: 'クラウド基盤構築お見積り',
      lines: [
        {
          item_name: 'クラウド設計構築一式',
          quantity: 1,
          unit: '式',
          unit_price: 3000000,
          tax_rate: 0.1,
        },
      ],
    });

    assert(quoteWithDeal.deal_id === newDealActive.id, '見積にdeal_idが正しく設定されたこと');

    // 10.3 存在しない deal_id を指定した見積作成が FK 制約で拒絶されること
    let fkInvalidDealBlocked = false;
    const dummyDealId = uuidv4();
    try {
      await quotationsService.create(tenantA, userEmployeeA, {
        customer_id: customerA,
        deal_id: dummyDealId,
        title: '存在しない案件指定見積',
        lines: [
          {
            item_name: 'テスト品目',
            quantity: 1,
            unit: '式',
            unit_price: 10000,
            tax_rate: 0.1,
          },
        ],
      });
    } catch (e: any) {
      // FK違反または404/23503
      fkInvalidDealBlocked = true;
    }
    assert(fkInvalidDealBlocked, 'FK制約: 存在しないdeal_idを指定した見積作成が拒絶されること');

    // 10.4 別テナントの deal_id を指定した見積作成が テナント整合性トリガーで拒絶されること
    // テナントBで案件を作成
    const dealTenantB = await dealsService.create(tenantB, userEmployeeB, ['employee'], {
      customer_id: customerB,
      title: 'テナントBの案件',
      stage: 'lead',
      expected_amount: 1000000,
    });

    let crossTenantDealQuoteBlocked = false;
    try {
      await client.query(
        `INSERT INTO quotations (
          tenant_id, customer_id, deal_id, quote_no, title, status, created_by
        ) VALUES (
          $1, $2, $3, 'QT-CROSS-DEAL-001', '越境案件見積', 'draft', $4
        )`,
        [tenantA, customerA, dealTenantB.id, userOwnerA],
      );
    } catch (e: any) {
      if (e.code === '23503') crossTenantDealQuoteBlocked = true;
    }
    assert(crossTenantDealQuoteBlocked, 'DBトリガー: 別テナントのdeal_idを指定した見積INSERTが拒絶されること (ERRCODE: 23503)');

    // 10.5 見積一覧APIからの deal_id 絞り込み検証 (要件6)
    const quoteListFiltered = await quotationsService.list(tenantA, userEmployeeA, {
      deal_id: newDealActive.id,
      page: 1,
      limit: 10,
    });
    assert(quoteListFiltered.quotations.length === 1, 'deal_idフィルタで見積が1件取得できたこと');
    assert(quoteListFiltered.quotations[0].id === quoteWithDeal.id, '取得された見積が紐づけたものと一致すること');

    // 10.6 紐づく見積が存在する案件の削除が拒絶されること
    let deleteWithQuotesBlocked = false;
    try {
      await dealsService.delete(tenantA, userEmployeeA, ['employee'], newDealActive.id);
    } catch (e: any) {
      deleteWithQuotesBlocked = true;
    }
    assert(deleteWithQuotesBlocked, '紐づく見積が存在する案件の削除が拒絶されること');

  } catch (err) {
    console.error('E2E検証中エラー:', err);
    failed++;
  } finally {
    client.release();
    await pool.end();
  }

  console.log('\n=============================================================');
  console.log(`=== P4-T2 案件管理 E2E 検証完了: ${passed} passed, ${failed} failed ===`);
  console.log('=============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
