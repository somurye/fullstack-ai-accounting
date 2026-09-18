/**
 * verify-contract-renewal-links-e2e.ts
 * =====================================
 * Phase 4 Task 3 (P4-T3): 契約更新連携 実DB包括E2E検証スクリプト
 *
 * 検証項目:
 * 1. テナント・ユーザー・顧客・契約マスタの初期化
 * 2. 明示的操作による更新提案案件（deals）の作成と contract_renewal_links 記録
 *    - lead ステージでの新規起票
 *    - 原契約情報の引き継ぎ（契約金額、期日等）
 *    - 相手先名からの一致顧客自動探索
 *    - 人間の明示操作なしの自動生成・自動確定ではないこと（非自動確定）の確認
 * 3. 案件詳細・契約からの相互引き戻し（findByDealId, findByContractId）
 * 4. 見積（quotations）との連携確認（deal_id 保持および原契約参照）
 * 5. テナント整合性DBトリガー (fn_validate_contract_renewal_link_tenant_consistency)
 *    - 別テナントの contract_id 指定拒否 (23503)
 *    - 別テナントの deal_id 指定拒否 (23503)
 *    - 別テナントの quotation_id 指定拒否 (23503)
 *    - 別テナントの created_by 指定拒否 (23503)
 * 6. RLSによる完全テナント分離 (ENABLE + FORCE)
 *    - 他テナントからのリンク・契約・商談の不可視性
 * 7. RBAC多層防御 (ROLE_PERMISSIONS とガードの検証)
 * 8. 既存機能（P1-T4 契約アラート, P4-T1 見積WORM, P4-T2 商談terminal）への非破壊確認
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { DealsService } from '../modules/deals/deals.service';
import { QuotationsService } from '../modules/quotations/quotations.service';
import { QuotationPdfService } from '../modules/quotations/quotation-pdf.service';
import { ContractRenewalLinksService } from '../modules/contract-renewal-links/contract-renewal-links.service';
import { ROLE_PERMISSIONS } from '../common/guards/permissions.guard';

const rawDsn = process.argv[2] || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';
const skipGuards = process.argv.includes('--skip-guards');

async function main() {
  console.log('=== P4-T3 契約更新連携 実DB E2E検証開始 ===');
  console.log(`接続先: ${rawDsn.replace(/:[^:@]+@/, ':****@')}`);

  process.env.DATABASE_URL = rawDsn;
  const pool = new Pool({ connectionString: rawDsn });
  const client = await pool.connect();

  const db = new DatabaseService();
  const auditLogs = new AuditLogsService(db);
  const dealsService = new DealsService(db, auditLogs);
  const pdfService = new QuotationPdfService();
  const quotationsService = new QuotationsService(db, auditLogs, pdfService);
  const renewalLinksService = new ContractRenewalLinksService(db, auditLogs, dealsService);

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
    // 1. テナント・ユーザー・顧客・契約マスタの初期化
    // ------------------------------------------------------------------------
    console.log('\n1. テナント・ユーザー・顧客・契約マスタのセットアップ...');

    const tenantA = uuidv4();
    const tenantB = uuidv4();

    await client.query(`INSERT INTO tenants (id, name) VALUES ($1, 'P4T3 テナントA'), ($2, 'P4T3 テナントB')`, [tenantA, tenantB]);

    const userOwnerA = uuidv4();
    const userEmployeeA = uuidv4();
    const userLegalAdminA = uuidv4();
    const userAccountantA = uuidv4();
    const userViewerA = uuidv4();
    const userEmployeeB = uuidv4();

    const timestamp = Date.now();
    await client.query(
      `INSERT INTO users (id, email, password_hash, name) VALUES
       ($1, $2, 'hash', 'A社代表'),
       ($3, $4, 'hash', 'A社営業担当'),
       ($5, $6, 'hash', 'A社法務管理'),
       ($7, $8, 'hash', 'A社経理'),
       ($9, $10, 'hash', 'A社外部閲覧'),
       ($11, $12, 'hash', 'B社営業担当')`,
      [
        userOwnerA, `owner_a_${timestamp}@example.com`,
        userEmployeeA, `sales_a_${timestamp}@example.com`,
        userLegalAdminA, `legal_a_${timestamp}@example.com`,
        userAccountantA, `acct_a_${timestamp}@example.com`,
        userViewerA, `viewer_a_${timestamp}@example.com`,
        userEmployeeB, `sales_b_${timestamp}@example.com`,
      ],
    );

    const userTuples = [
      [tenantA, userOwnerA, 'owner'],
      [tenantA, userEmployeeA, 'employee'],
      [tenantA, userLegalAdminA, 'legal_admin'],
      [tenantA, userAccountantA, 'accountant'],
      [tenantA, userViewerA, 'viewer_external'],
      [tenantB, userEmployeeB, 'employee'],
    ] as const;

    for (const [tId, uId] of userTuples) {
      await client.query(`INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)`, [tId, uId]);
    }

    const rolesRes = await client.query(`SELECT id, code FROM roles WHERE code IN ('owner', 'employee', 'legal_admin', 'accountant', 'viewer_external')`);
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

    // 顧客マスタ (Tenant A)
    const customerA1 = uuidv4();
    const customerA2 = uuidv4();
    await client.query(
      `INSERT INTO customers (id, tenant_id, code, name, is_active) VALUES
       ($1, $2, 'CUST-A1', 'サイバーセキュリティ株式会社', true),
       ($3, $2, 'CUST-A2', '株式会社エンタープライズ', true)`,
      [customerA1, tenantA, customerA2],
    );

    // 顧客マスタ (Tenant B)
    const customerB1 = uuidv4();
    await client.query(
      `INSERT INTO customers (id, tenant_id, code, name, is_active) VALUES
       ($1, $2, 'CUST-B1', 'テナントB専用顧客', true)`,
      [customerB1, tenantB],
    );

    // 契約マスタ (Tenant A - 既存契約)
    const contractA1 = uuidv4();
    const contractA2 = uuidv4();
    await client.query(
      `INSERT INTO contracts (
        id, tenant_id, contract_no, title, counterparty_name, contract_type,
        contract_amount, start_date, end_date, auto_renewal, renewal_notice_days, status, created_by
       ) VALUES
       ($1, $2, 'CNT-A1-001', '年間セキュリティ保守契約', 'サイバーセキュリティ株式会社', 'service', 1200000, '2025-11-01', '2026-10-31', true, 30, 'active', $3),
       ($4, $2, 'CNT-A2-002', '短期コンサルティング契約', '未登録パートナー', 'service', 500000, '2026-01-01', '2026-06-30', false, 0, 'active', $3)`,
      [contractA1, tenantA, userEmployeeA, contractA2],
    );

    // 契約マスタ (Tenant B)
    const contractB1 = uuidv4();
    await client.query(
      `INSERT INTO contracts (
        id, tenant_id, contract_no, title, counterparty_name, contract_type,
        contract_amount, start_date, end_date, auto_renewal, renewal_notice_days, status, created_by
       ) VALUES
       ($1, $2, 'CNT-B1-001', 'Tenant B 保守契約', 'Tenant B 相手先', 'service', 800000, '2026-01-01', '2026-12-31', true, 30, 'active', $3)`,
      [contractB1, tenantB, userEmployeeB],
    );

    assert(true, 'テナント・ユーザー・顧客・契約マスタの初期化完了');

    // ------------------------------------------------------------------------
    // 2. 明示的操作による更新提案案件の作成と contract_renewal_links 記録
    // ------------------------------------------------------------------------
    console.log('\n2. 明示的操作による更新商談案件の起票とリンク記録の検証...');

    // 相手先名（'サイバーセキュリティ株式会社'）から既存顧客 (customerA1) が自動マッチされるケース
    const result1 = await renewalLinksService.createRenewalDeal(
      tenantA,
      userEmployeeA,
      ['employee'],
      {
        contract_id: contractA1,
        // customer_id を省略 -> counterparty_name で自動マッチ
      },
    );

    assert(Boolean(result1.deal?.id), '商談レコードが生成されたこと');
    assert(result1.deal.stage === 'lead', '商談が初期ステージ "lead" で起票されたこと');
    assert(result1.deal.customer_id === customerA1, '契約の相手先名から顧客が自動マッチングされたこと');
    assert(result1.deal.expected_amount === 1200000, '原契約の契約金額が予想売上として初期設定されたこと');
    assert(
      result1.deal.expected_close_date === '2026-10-31' ||
      String(result1.deal.expected_close_date).includes('2026-10-31'),
      '原契約の満了日が受注予定日として初期設定されたこと',
    );
    assert(result1.deal.title.includes('年間セキュリティ保守契約'), '原契約タイトルが商談件名に反映されたこと');
    assert(result1.deal.is_terminal === false, '商談は未クローズ（非terminal）状態であること');

    assert(Boolean(result1.link?.id), 'contract_renewal_links レコードが生成されたこと');
    assert(result1.link.contract_id === contractA1, 'リンクの contract_id が原契約と一致すること');
    assert(result1.link.deal_id === result1.deal.id, 'リンクの deal_id が生成された商談と一致すること');
    assert(result1.link.tenant_id === tenantA, 'リンクの tenant_id が一致すること');
    assert(result1.link.created_by === userEmployeeA, 'リンクの created_by が操作者IDであること');

    // 人間の明示的操作なしに業務レコードが生成されない原則（AI提案→人間承認→確定の三段構成準拠）
    // DB上の商談状態が自動確定(won)されていないことを確認
    const { rows: dealCheck } = await client.query(`SELECT stage, closed_at FROM deals WHERE id = $1`, [result1.deal.id]);
    assert(dealCheck[0].stage === 'lead' && dealCheck[0].closed_at === null, '商談は自動確定(won)されず、人間の営業活動前提の lead ステージであること');

    // 相手先名が既存顧客に一致せず、customer_id も指定しない場合は fail-closed (400 Bad Request)
    let autoMatchFailed = false;
    try {
      await renewalLinksService.createRenewalDeal(
        tenantA,
        userEmployeeA,
        ['employee'],
        {
          contract_id: contractA2, // counterparty_name: '未登録パートナー'
        },
      );
    } catch (err: any) {
      autoMatchFailed = true;
      assert(err.message.includes('一致する顧客が見つかりません') || err.message.includes('顧客マスタが見つかりません'), '未一致時の fail-closed エラーメッセージ確認');
    }
    assert(autoMatchFailed, '顧客自動特定不可時に customer_id 未指定の起票が拒絶されること (fail-closed)');

    // 同名顧客が2件存在する場合の fail-closed 検証 (設計確定-04)
    const customerDup1 = uuidv4();
    const customerDup2 = uuidv4();
    await client.query(
      `INSERT INTO customers (id, tenant_id, code, name, is_active) VALUES
       ($1, $2, 'CUST-DUP1', '同名複数顧客株式会社', true),
       ($3, $2, 'CUST-DUP2', '同名複数顧客株式会社', true)`,
      [customerDup1, tenantA, customerDup2],
    );

    const contractDup = uuidv4();
    await client.query(
      `INSERT INTO contracts (
        id, tenant_id, contract_no, title, counterparty_name, contract_type,
        contract_amount, start_date, end_date, auto_renewal, renewal_notice_days, status, created_by
       ) VALUES
       ($1, $2, 'CNT-DUP-001', '同名顧客テスト契約', '同名複数顧客株式会社', 'service', 300000, '2026-01-01', '2026-12-31', false, 0, 'active', $3)`,
      [contractDup, tenantA, userEmployeeA],
    );

    let multiCandidateFailed = false;
    try {
      await renewalLinksService.createRenewalDeal(
        tenantA,
        userEmployeeA,
        ['employee'],
        {
          contract_id: contractDup,
        },
      );
    } catch (err: any) {
      multiCandidateFailed = true;
      assert(err.message.includes('一致する顧客が複数存在します'), '複数候補時の fail-closed エラーメッセージ確認');
    }
    assert(multiCandidateFailed, '設計確定-04: 同名顧客が複数存在する場合に自動選択せず拒絶されること (fail-closed)');

    // customer_id を明示指定した場合は起票成功
    const result2 = await renewalLinksService.createRenewalDeal(
      tenantA,
      userEmployeeA,
      ['employee'],
      {
        contract_id: contractA2,
        customer_id: customerA2,
        title: '特別更新提案',
        expected_amount: 600000,
      },
    );
    assert(result2.deal.customer_id === customerA2, '明示指定した顧客IDで商談が作成されたこと');
    assert(result2.deal.title === '特別更新提案', '明示指定した商談タイトルが反映されたこと');
    assert(result2.deal.expected_amount === 600000, '明示指定した金額が反映されたこと');

    // ------------------------------------------------------------------------
    // 3. 案件詳細・契約からの相互引き戻し
    // ------------------------------------------------------------------------
    console.log('\n3. 案件詳細・契約からの相互引き戻しAPIの検証...');

    const linkByDeal = await renewalLinksService.findByDealId(tenantA, userEmployeeA, ['employee'], result1.deal.id);
    assert(Boolean(linkByDeal), '商談IDから連携情報が取得できること');
    assert(linkByDeal?.contract?.contract_no === 'CNT-A1-001', '商談から紐づく原契約番号が正しく逆引きできること');
    assert(linkByDeal?.contract?.title === '年間セキュリティ保守契約', '商談から紐づく原契約タイトルが取得できること');

    const linksByContract = await renewalLinksService.findByContractId(tenantA, userEmployeeA, ['employee'], contractA1);
    assert(linksByContract.length === 1, '契約IDから紐づく更新連携リンク一覧が取得できること');
    assert(linksByContract[0].deal?.id === result1.deal.id, '契約から紐づく商談IDが一致すること');
    assert(linksByContract[0].deal?.stage === 'lead', '契約から紐づく商談ステージが取得できること');

    // ------------------------------------------------------------------------
    // 4. 見積（quotations）との連携確認（deal_id 保持および原契約参照）
    // ------------------------------------------------------------------------
    console.log('\n4. 見積書（quotations）との連携検証...');

    const quote = await quotationsService.create(
      tenantA,
      userEmployeeA,
      {
        customer_id: customerA1,
        deal_id: result1.deal.id,
        title: '年間セキュリティ保守 更新お見積り',
        lines: [
          {
            item_name: '年間セキュリティ保守基本パック',
            quantity: 1,
            unit: '式',
            unit_price: 1200000,
            tax_rate: 0.1,
          },
        ],
      },
    );

    assert(Boolean(quote?.id), '商談に紐づく見積書（下書き）が作成されたこと');
    assert(quote.deal_id === result1.deal.id, '作成された見積書に deal_id が記録されていること');

    // 見積一覧から deal_id での絞り込み
    const quotesForDeal = await quotationsService.list(tenantA, userEmployeeA, { page: 1, limit: 20, deal_id: result1.deal.id });
    assert(quotesForDeal.quotations.length === 1, '案件ID指定で見積一覧が正しく取得できること');
    assert(quotesForDeal.quotations[0].id === quote.id, '案件に紐づく見積IDが一致すること');

    // ------------------------------------------------------------------------
    // 5. テナント整合性DBトリガー (fn_validate_contract_renewal_link_tenant_consistency)
    // ------------------------------------------------------------------------
    console.log('\n5. テナント整合性DBトリガーの多角検証 (fail-closed: 23503)...');

    // 5-1. 別テナントの contract_id 指定拒絶
    let crossTenantContractDenied = false;
    try {
      await client.query(
        `INSERT INTO contract_renewal_links (id, tenant_id, contract_id, deal_id, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [uuidv4(), tenantA, contractB1, result1.deal.id, userEmployeeA],
      );
    } catch (err: any) {
      crossTenantContractDenied = err.code === '23503';
    }
    assert(crossTenantContractDenied, '別テナントの contract_id を指定したリンクINSERTがDBトリガーにより拒絶 (23503)');

    // 5-2. 別テナントの deal_id 指定拒絶
    // まず Tenant B に商談を作成
    const dealB1 = await dealsService.create(
      tenantB,
      userEmployeeB,
      ['employee'],
      {
        customer_id: customerB1,
        title: 'Tenant B 商談',
      },
    );

    let crossTenantDealDenied = false;
    try {
      await client.query(
        `INSERT INTO contract_renewal_links (id, tenant_id, contract_id, deal_id, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [uuidv4(), tenantA, contractA1, dealB1.id, userEmployeeA],
      );
    } catch (err: any) {
      crossTenantDealDenied = err.code === '23503';
    }
    assert(crossTenantDealDenied, '別テナントの deal_id を指定したリンクINSERTがDBトリガーにより拒絶 (23503)');

    // 5-3. 別テナントの quotation_id 指定拒絶
    const quoteB1 = await quotationsService.create(
      tenantB,
      userEmployeeB,
      {
        customer_id: customerB1,
        title: 'Tenant B 見積',
        lines: [{ item_name: 'Item B', quantity: 1, unit: '式', unit_price: 100000, tax_rate: 0.1 }],
      },
    );

    let crossTenantQuoteDenied = false;
    try {
      await client.query(
        `INSERT INTO contract_renewal_links (id, tenant_id, contract_id, deal_id, quotation_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [uuidv4(), tenantA, contractA1, result1.deal.id, quoteB1.id, userEmployeeA],
      );
    } catch (err: any) {
      crossTenantQuoteDenied = err.code === '23503';
    }
    assert(crossTenantQuoteDenied, '別テナントの quotation_id を指定したリンクINSERTがDBトリガーにより拒絶 (23503)');

    // 5-4. 別テナントの created_by 指定拒絶
    let crossTenantCreatedByDenied = false;
    try {
      await client.query(
        `INSERT INTO contract_renewal_links (id, tenant_id, contract_id, deal_id, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [uuidv4(), tenantA, contractA1, result1.deal.id, userEmployeeB],
      );
    } catch (err: any) {
      crossTenantCreatedByDenied = err.code === '23503';
    }
    assert(crossTenantCreatedByDenied, '別テナントの created_by を指定したリンクINSERTがDBトリガーにより拒絶 (23503)');

    // ------------------------------------------------------------------------
    // 6. RLSによる完全テナント分離 (ENABLE + FORCE)
    // ------------------------------------------------------------------------
    console.log('\n6. RLSによる完全テナント分離の検証 (ENABLE + FORCE)...');

    // db.transaction を用いることで app_runtime ロール & tenant_id コンテキストが設定され、スーパーユーザーRLSバイパスを防止
    await db.transaction(tenantB, userEmployeeB, async (txClient) => {
      await txClient.query('SET LOCAL ROLE app_runtime');

      // Tenant A の契約更新リンクが Tenant B から見えないこと
      const { rows: rlsCheckLinks } = await txClient.query(
        `SELECT * FROM contract_renewal_links WHERE id = $1`,
        [result1.link.id],
      );
      assert(rlsCheckLinks.length === 0, 'RLS: Tenant B のセッションから Tenant A の更新リンクは不可視 (0件)');

      // Tenant A の契約が Tenant B から見えないこと
      const { rows: rlsCheckContracts } = await txClient.query(
        `SELECT * FROM contracts WHERE id = $1`,
        [contractA1],
      );
      assert(rlsCheckContracts.length === 0, 'RLS: Tenant B のセッションから Tenant A の契約は不可視 (0件)');

      // Tenant A の商談が Tenant B から見えないこと
      const { rows: rlsCheckDeals } = await txClient.query(
        `SELECT * FROM deals WHERE id = $1`,
        [result1.deal.id],
      );
      assert(rlsCheckDeals.length === 0, 'RLS: Tenant B のセッションから Tenant A の商談は不可視 (0件)');

      // Tenant B から Tenant A のリンクを UPDATE できないこと
      const updateResult = await txClient.query(
        `UPDATE contract_renewal_links SET updated_at = NOW() WHERE id = $1`,
        [result1.link.id],
      );
      assert(updateResult.rowCount === 0, 'RLS: Tenant B から Tenant A のリンク更新は 0件更新で遮断');

      // Tenant B から Tenant A のリンクを DELETE できないこと
      const deleteResult = await txClient.query(
        `DELETE FROM contract_renewal_links WHERE id = $1`,
        [result1.link.id],
      );
      assert(deleteResult.rowCount === 0, 'RLS: Tenant B から Tenant A のリンク削除は 0件削除で遮断');
    });

    // ------------------------------------------------------------------------
    // 7. RBAC多層防御 (ROLE_PERMISSIONS とガードの検証)
    // ------------------------------------------------------------------------
    console.log('\n7. RBAC多層防御の検証...');

    const ownerPerms = ROLE_PERMISSIONS['owner'] || [];
    const employeePerms = ROLE_PERMISSIONS['employee'] || [];
    const accountantPerms = ROLE_PERMISSIONS['accountant'] || [];
    const viewerPerms = ROLE_PERMISSIONS['viewer_external'] || [];

    assert(ownerPerms.includes('contract_renewal_link.create'), 'RBAC: owner ロールは contract_renewal_link.create 権限を持つ');
    assert(ownerPerms.includes('contract_renewal_link.view'), 'RBAC: owner ロールは contract_renewal_link.view 権限を持つ');

    assert(employeePerms.includes('contract_renewal_link.create'), 'RBAC: employee ロールは contract_renewal_link.create 権限を持つ');
    assert(employeePerms.includes('contract_renewal_link.view'), 'RBAC: employee ロールは contract_renewal_link.view 権限を持つ');

    assert(!accountantPerms.includes('contract_renewal_link.create'), 'RBAC: accountant ロールは contract_renewal_link.create 権限を持たない (作成不可)');
    assert(accountantPerms.includes('contract_renewal_link.view'), 'RBAC: accountant ロールは contract_renewal_link.view 権限を持つ (閲覧可能)');

    assert(!viewerPerms.includes('contract_renewal_link.create'), 'RBAC: viewer_external ロールは contract_renewal_link.create 権限を持たない');
    assert(!viewerPerms.includes('contract_renewal_link.view'), 'RBAC: viewer_external ロールは contract_renewal_link.view 権限を持たない');

    // 権限不足ロールでの Service 層ガード検証 (viewer_external による createRenewalDeal 呼び出し拒絶)
    let viewerForbidden = false;
    try {
      await renewalLinksService.createRenewalDeal(
        tenantA,
        userViewerA,
        ['viewer_external'],
        { contract_id: contractA1 },
      );
    } catch (err: any) {
      viewerForbidden = err.message.includes('権限がありません') || err.status === 403;
    }
    assert(viewerForbidden, 'RBAC多層防御: viewer_external による更新商談起票は403拒否される');

    // ------------------------------------------------------------------------
    // 8. 既存機能（P1-T4 契約アラート, P4-T1 見積WORM, P4-T2 商談terminal）の非破壊確認
    // ------------------------------------------------------------------------
    console.log('\n8. 既存機能（P1-T4 契約アラート, P4-T1 見積WORM, P4-T2 商談terminal）への非破壊確認...');

    // P1-T4: 既存契約の更新期限判定クエリが正常動作すること
    const { rows: expiringRows } = await client.query(
      `SELECT id, contract_no, title, end_date
       FROM contracts
       WHERE tenant_id = $1 AND status = 'active' AND auto_renewal = true
         AND end_date <= CURRENT_DATE + (renewal_notice_days || ' days')::INTERVAL`,
      [tenantA],
    );
    assert(Array.isArray(expiringRows), 'P1-T4: 契約更新期限アラート用クエリがエラーなく実行できること');

    // P4-T1: 見積のWORM不変性（sent状態の見積書はUPDATE不可）が維持されていること
    await quotationsService.send(tenantA, userEmployeeA, quote.id);
    let wormDenied = false;
    try {
      await client.query(`UPDATE quotations SET title = '不正改ざん' WHERE id = $1`, [quote.id]);
    } catch (err: any) {
      wormDenied = err.code === '55000' || err.message.includes('WORM');
    }
    assert(wormDenied, 'P4-T1: 見積のWORM不変性（sent後のUPDATE拒絶 55000）が維持されていること');

    // P4-T2: 商談のterminal状態不変性（wonクローズ後の変更不可）が維持されていること
    await dealsService.close(tenantA, userEmployeeA, ['employee'], result1.deal.id, { stage: 'won' });
    let terminalDenied = false;
    try {
      await client.query(`UPDATE deals SET expected_amount = 9999999 WHERE id = $1`, [result1.deal.id]);
    } catch (err: any) {
      terminalDenied = err.code === '55000' || err.message.includes('terminal');
    }
    assert(terminalDenied, 'P4-T2: 商談のterminal状態不変性（won後のUPDATE拒絶 55000）が維持されていること');

    // ------------------------------------------------------------------------
    // 9. P4-T3-VERIFY 追加検証: リンクの一意性・不変性(WORM)・quotation正当性・作成主体導出・独立RBAC
    // ------------------------------------------------------------------------
    console.log('\n9. P4-T3-VERIFY 追加検証 (設計確定-01〜04)...');

    if (!skipGuards) {
      // 9-1. 同一 deal_id を別の contract_renewal_link 行に設定しようとして UNIQUE制約で拒絶されること (23505)
      let duplicateDealDenied = false;
      const dupLinkId = uuidv4();
      try {
        await client.query(
          `INSERT INTO contract_renewal_links (id, tenant_id, contract_id, deal_id, created_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [dupLinkId, tenantA, contractA2, result1.deal.id, userEmployeeA],
        );
      } catch (err: any) {
        duplicateDealDenied = err.code === '23505';
      } finally {
        if (!duplicateDealDenied) {
          await client.query(`DELETE FROM contract_renewal_links WHERE id = $1`, [dupLinkId]);
        }
      }
      assert(duplicateDealDenied, '設計確定-01: 同一deal_idを別リンク行に設定しようとしてUNIQUE制約で拒絶 (23505)');

      // 9-2. リンク作成後、contract_id・deal_id・tenant_id・created_by への直接 SQL UPDATE が拒絶されること (55000)
      let updateContractIdDenied = false;
      try {
        await client.query(
          `UPDATE contract_renewal_links SET contract_id = $1 WHERE id = $2`,
          [contractA2, result1.link.id],
        );
      } catch (err: any) {
        updateContractIdDenied = err.code === '55000' || err.message.includes('immutable WORM');
      }
      assert(updateContractIdDenied, '設計確定-01: contract_id への直接UPDATEがWORMトリガーにより拒絶 (55000)');

      let updateDealIdDenied = false;
      try {
        await client.query(
          `UPDATE contract_renewal_links SET deal_id = $1 WHERE id = $2`,
          [result2.deal.id, result1.link.id],
        );
      } catch (err: any) {
        updateDealIdDenied = err.code === '55000' || err.message.includes('immutable WORM');
      }
      assert(updateDealIdDenied, '設計確定-01: deal_id への直接UPDATEがWORMトリガーにより拒絶 (55000)');

      let updateCreatedByDenied = false;
      try {
        await client.query(
          `UPDATE contract_renewal_links SET created_by = $1 WHERE id = $2`,
          [userOwnerA, result1.link.id],
        );
      } catch (err: any) {
        updateCreatedByDenied = err.code === '55000' || err.message.includes('immutable WORM');
      }
      assert(updateCreatedByDenied, '設計確定-01: created_by への直接UPDATEがWORMトリガーにより拒絶 (55000)');

      // 9-3. リンクの quotation_id に、当該 deal 由来ではない（別 deal の）quotation を設定しようとして拒絶されること (23503)
      const quoteForDeal2 = await quotationsService.create(
        tenantA,
        userEmployeeA,
        {
          customer_id: customerA2,
          deal_id: result2.deal.id,
          title: 'Deal2用見積',
          lines: [{ item_name: 'Deal2 Item', quantity: 1, unit: '式', unit_price: 600000, tax_rate: 0.1 }],
        },
      );

      let foreignDealQuoteDenied = false;
      try {
        await client.query(
          `UPDATE contract_renewal_links SET quotation_id = $1 WHERE id = $2`,
          [quoteForDeal2.id, result1.link.id],
        );
      } catch (err: any) {
        foreignDealQuoteDenied = err.code === '23503' || err.message.includes('does not belong to deal');
      }
      assert(foreignDealQuoteDenied, '設計確定-02: 当該deal由来ではない別dealのquotation設定がDBトリガーで拒絶 (23503)');

      // 9-4. 正常な quotation_id の紐付け (NULL -> 非NULLの1回限りの設定)
      const attachedLink = await renewalLinksService.attachQuotation(
        tenantA,
        userEmployeeA,
        ['employee'],
        result1.deal.id,
        quote.id,
      );
      assert(attachedLink.quotation_id === quote.id, '設計確定-01, 02: 当該deal由来のquotationが正常に紐付けられたこと');

      // 9-5-1. 通常更新時: deal_id 不一致チェックトリガーにより拒絶 (23503)
      let duplicateQuoteTriggerDenied = false;
      try {
        await client.query(
          `UPDATE contract_renewal_links SET quotation_id = $1 WHERE id = $2`,
          [quote.id, result2.link.id],
        );
      } catch (err: any) {
        duplicateQuoteTriggerDenied = err.code === '23503' || err.message.includes('does not belong to deal');
      }
      assert(duplicateQuoteTriggerDenied, '設計確定-02: 同一quotation_idを別リンク行に設定しようとしてdeal_id不一致トリガーで拒絶 (23503)');

      // 9-5-2. UNIQUEインデックス検証: 部分UNIQUEインデックスによる重複拒絶 (23505) の直接実証
      let duplicateQuoteIndexDenied = false;
      const dupQuoteLinkId = uuidv4();
      try {
        await client.query('ALTER TABLE contract_renewal_links DISABLE TRIGGER trg_validate_contract_renewal_link_quotation_deal');
        await client.query(
          `INSERT INTO contract_renewal_links (id, tenant_id, contract_id, quotation_id, created_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [dupQuoteLinkId, tenantA, contractA2, quote.id, userEmployeeA],
        );
      } catch (err: any) {
        duplicateQuoteIndexDenied = err.code === '23505';
      } finally {
        await client.query('ALTER TABLE contract_renewal_links ENABLE TRIGGER trg_validate_contract_renewal_link_quotation_deal');
        if (!duplicateQuoteIndexDenied) {
          await client.query(`DELETE FROM contract_renewal_links WHERE id = $1`, [dupQuoteLinkId]);
        }
      }
      assert(duplicateQuoteIndexDenied, '設計確定-01: 同一quotationを複数のリンク行から参照しようとしてUNIQUE制約で拒絶 (23505)');

      // 9-6. quotation_id 設定済みリンクへの再設定・NULL 巻き戻しが拒絶されること (55000)
      let resetQuoteDenied = false;
      try {
        await client.query(
          `UPDATE contract_renewal_links SET quotation_id = $1 WHERE id = $2`,
          [quoteForDeal2.id, result1.link.id],
        );
      } catch (err: any) {
        resetQuoteDenied = err.code === '55000' || err.message.includes('immutable WORM');
      }
      assert(resetQuoteDenied, '設計確定-01: quotation_id 設定後の再設定がWORMトリガーにより拒絶 (55000)');

      let clearQuoteDenied = false;
      try {
        await client.query(
          `UPDATE contract_renewal_links SET quotation_id = NULL WHERE id = $1`,
          [result1.link.id],
        );
      } catch (err: any) {
        clearQuoteDenied = err.code === '55000' || err.message.includes('immutable WORM');
      }
      assert(clearQuoteDenied, '設計確定-01: quotation_id のNULL巻き戻しがWORMトリガーにより拒絶 (55000)');

      // Service 層の attachQuotation 二重呼び出しも拒絶されること
      let serviceAttachDenied = false;
      try {
        await renewalLinksService.attachQuotation(
          tenantA,
          userEmployeeA,
          ['employee'],
          result1.deal.id,
          quote.id,
        );
      } catch (err: any) {
        serviceAttachDenied = true;
        assert(err.message.includes('既に見積書が紐付けられています'), 'Service層二重紐付け拒絶メッセージ確認');
      }
      assert(serviceAttachDenied, 'Service層での quotation 二重紐付けが 400 Bad Request で拒絶されること');
    } else {
      console.log('  [INFO] 031 DBガード検証 (9-1〜9-6) は --skip-guards のためスキップします');
    }

    // 9-7. 作成主体（created_by, actor_user_id）の認証セッション導出とクライアント改ざん無視の実証
    const forgedInput = {
      contract_id: contractA2,
      customer_id: customerA2,
      created_by: '00000000-0000-0000-0000-000000000000',
      actor_user_id: '00000000-0000-0000-0000-000000000000',
    } as any;

    const resultForged = await renewalLinksService.createRenewalDeal(
      tenantA,
      userEmployeeA,
      ['employee'],
      forgedInput,
    );
    assert(resultForged.link.created_by === userEmployeeA, 'contract_renewal_links.created_by はセッションuserIdから導出され偽装されないこと');
    assert(resultForged.deal.created_by === userEmployeeA, 'deals.created_by はセッションuserIdから導出され偽装されないこと');

    const { rows: auditRows } = await client.query(
      `SELECT actor_user_id FROM audit_logs WHERE target_id = $1 AND action = 'contract_renewal_link.create'`,
      [resultForged.link.id],
    );
    assert(auditRows[0]?.actor_user_id === userEmployeeA, 'audit_logs.actor_user_id はセッションuserIdから導出され偽装されないこと');

    // 9-8. 設計確定-03: legal_admin（contract_renewal_link.create のみ保持）での更新商談起票
    const resultLegalAdmin = await renewalLinksService.createRenewalDeal(
      tenantA,
      userLegalAdminA,
      ['legal_admin'],
      {
        contract_id: contractA1,
        title: '法務管理者による更新提案',
        expected_amount: 1500000,
      },
    );
    assert(Boolean(resultLegalAdmin.deal?.id), '設計確定-03: legal_admin は deal.create を持たなくても更新商談を起票できること');
    assert(resultLegalAdmin.deal.title === '法務管理者による更新提案', 'legal_admin 起票の商談件名確認');
    assert(resultLegalAdmin.link.created_by === userLegalAdminA, 'legal_admin が作成者として記録されていること');

    // 権限を持たない accountant ロールでの起票拒絶確認
    let accountantCreateDenied = false;
    try {
      await renewalLinksService.createRenewalDeal(
        tenantA,
        userAccountantA,
        ['accountant'],
        {
          contract_id: contractA1,
        },
      );
    } catch (err: any) {
      accountantCreateDenied = err.status === 403 || err.message.includes('権限がありません');
    }
    assert(accountantCreateDenied, '設計確定-03: contract_renewal_link.create を持たない accountant による起票は403拒否されること');

    // ------------------------------------------------------------------------
    // 終了集計
    // ------------------------------------------------------------------------
    console.log('\n========================================');
    console.log(`検証結果: 全 ${passed + failed} 項目中、PASS: ${passed}, FAIL: ${failed}`);
    console.log('========================================');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('E2E検証中に予期せぬエラーが発生しました:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
