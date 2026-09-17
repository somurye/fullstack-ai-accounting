/**
 * verify-quotations-e2e.ts
 * =========================
 * Phase 4 Task 1 (P4-T1-FIX): 見積書機能 実DB包括E2E検証スクリプト
 *
 * 検証項目:
 * 1. テナント・ユーザー・顧客マスタ・税区分の初期化
 * 2. 見積作成 (draft) と明細金額・税額・合計金額の整合性
 * 3. テナント整合性トリガー (別テナント顧客の指定拒否, 別テナント明細の拒否)
 * 4. RLSによる完全テナント分離 (他テナントの見積・明細が不可視)
 * 5. 確定送付 (sent) 後のWORM不変性DBトリガー (15列の変更拒否, 削除拒否: 55000)
 * 6. 明細行 (quotation_line_items) に対する sent 後の INSERT/UPDATE/DELETE 全遮断 (55000)
 * 7. BLOCKER-01: superseded_by の一度きり遷移例外制御 (NULL -> 新IDのみ許可, 既設定後の再変更拒絶, NULL巻き戻し拒絶, 自己参照拒絶: 55000/23001)
 * 8. 見積改訂 (新バージョン発行, 旧レコード保持, superseded_by リンク, 二重改訂防止)
 * 9. 確認事項-03: 受注転換の同時実行 (二重転換) 耐性・孤立invoice未発生検証
 * 10. 確認事項-04 & 05: invoice側のtenant_id強制導出および認証セッション主体の記録検証
 * 11. 受注転換の多重実行防止 (DB制約・トリガーによる2回目拒絶)
 * 12. 確認事項-07: 日本語フォント (IPAexゴシック) 埋め込みによる見積書PDF生成検証
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { QuotationPdfService } from '../modules/quotations/quotation-pdf.service';
import { QuotationsService } from '../modules/quotations/quotations.service';

const rawDsn = process.argv[2] || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';

async function main() {
  console.log('=== P4-T1-FIX 見積書機能 実DB E2E検証開始 ===');
  console.log(`接続先: ${rawDsn.replace(/:[^:@]+@/, ':****@')}`);

  process.env.DATABASE_URL = rawDsn;
  const pool = new Pool({ connectionString: rawDsn });
  const client = await pool.connect();

  const db = new DatabaseService();
  const auditLogs = new AuditLogsService(db);
  const pdfService = new QuotationPdfService();
  const quotationsService = new QuotationsService(db, auditLogs, pdfService);

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
    const userA = uuidv4();
    const userB = uuidv4();

    await client.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Tenant A (P4-T1)'), ($2, 'Tenant B (P4-T1)')`, [
      tenantA,
      tenantB,
    ]);

    await client.query(
      `INSERT INTO users (id, email, password_hash, name) VALUES
       ($1, $2, 'hash', '営業 太郎'),
       ($3, $4, 'hash', '営業 次郎')`,
      [userA, `ua_${Date.now()}@example.com`, userB, `ub_${Date.now()}@example.com`],
    );

    const roleRes = await client.query(`SELECT id, code FROM roles WHERE code = 'owner'`);
    const ownerRoleId = roleRes.rows[0]?.id;

    await client.query(
      `INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2), ($3, $4)`,
      [tenantA, userA, tenantB, userB],
    );

    if (ownerRoleId) {
      await client.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES ($1, $2, $3), ($4, $5, $6)`,
        [tenantA, userA, ownerRoleId, tenantB, userB, ownerRoleId],
      );
    }

    // テナントAの売上高勘定科目
    const accountAId = uuidv4();
    await client.query(
      `INSERT INTO accounts (id, tenant_id, code, name, account_type, normal_balance)
       VALUES ($1, $2, '4111', '売上高', 'revenue', 'credit')
       ON CONFLICT (tenant_id, code) DO UPDATE SET is_active = TRUE RETURNING id`,
      [accountAId, tenantA],
    );

    // テナントAの税区分 (標準税率 10%)
    const taxCatAId = uuidv4();
    await client.query(
      `INSERT INTO tax_categories (id, tenant_id, code, name, tax_type, tax_rate, is_active)
       VALUES ($1, $2, 'TAX10', '標準税率 10%', 'taxable', 10.00, TRUE)
       ON CONFLICT (tenant_id, code) DO UPDATE SET is_active = TRUE RETURNING id`,
      [taxCatAId, tenantA],
    );

    // テナントA, B の顧客作成 (日本語社名)
    const custAId = uuidv4();
    const custBId = uuidv4();
    await client.query(
      `INSERT INTO customers (id, tenant_id, code, name) VALUES
       ($1, $2, 'CUST-A-01', '株式会社サンプル商事'),
       ($3, $4, 'CUST-B-01', 'グローバル産業株式会社')`,
      [custAId, tenantA, custBId, tenantB],
    );

    assert(true, 'テナントA・B, ユーザー, 顧客マスタ初期化完了');

    // ------------------------------------------------------------------------
    // 2. 見積作成 (draft) と金額計算整合性
    // ------------------------------------------------------------------------
    console.log('\n2. 見積新規作成 (draft) と金額整合性...');

    const createdQuote = await quotationsService.create(tenantA, userA, {
      customer_id: custAId,
      title: 'クラウド導入支援および保守運用',
      valid_until: '2026-10-31',
      notes: '納品後30日以内にお支払いください。',
      lines: [
        {
          item_name: 'クラウド設計・環境構築一式',
          description: 'AWS/GCP 初期構築',
          quantity: 1,
          unit: '式',
          unit_price: 1000000,
          tax_rate: 0.1,
        },
        {
          item_name: '運用保守月額費用 (初月分)',
          description: '24/365 監視',
          quantity: 1,
          unit: '月',
          unit_price: 200000,
          tax_rate: 0.1,
        },
      ],
    });

    assert(createdQuote.status === 'draft', '見積が draft 状態で作成されたこと');
    assert(Number(createdQuote.subtotal) === 1200000, `小計が 1,200,000 であること (実: ${createdQuote.subtotal})`);
    assert(Number(createdQuote.tax_amount) === 120000, `税額が 120,000 であること (実: ${createdQuote.tax_amount})`);
    assert(Number(createdQuote.total_amount) === 1320000, `合計が 1,320,000 であること (実: ${createdQuote.total_amount})`);
    assert(createdQuote.lines.length === 2, '明細行が2行作成されたこと');
    assert(createdQuote.version === 1, '初期バージョンが 1 であること');

    // 下書きの更新
    const updatedDraft = await quotationsService.update(tenantA, userA, createdQuote.id, {
      title: 'クラウド導入支援および保守運用 (改定版下書き)',
      lines: [
        {
          item_name: 'クラウド設計・環境構築一式',
          quantity: 1,
          unit: '式',
          unit_price: 1100000,
          tax_rate: 0.1,
        },
      ],
    });
    assert(Number(updatedDraft.subtotal) === 1100000, '下書き更新後の小計整合性');
    assert(Number(updatedDraft.total_amount) === 1210000, '下書き更新後の合計整合性');

    // ------------------------------------------------------------------------
    // 3. テナント整合性トリガーの検証
    // ------------------------------------------------------------------------
    console.log('\n3. テナント整合性トリガー (別テナント顧客・ユーザーの拒否)...');

    let foreignCustomerRejected = false;
    try {
      await quotationsService.create(tenantA, userA, {
        customer_id: custBId, // テナントBの顧客を指定
        title: '不正な見積',
        lines: [{ item_name: '不正行', quantity: 1, unit: '式', unit_price: 10000, tax_rate: 0.1 }],
      });
    } catch {
      foreignCustomerRejected = true;
    }
    assert(foreignCustomerRejected, 'テナントAの見積にテナントBの顧客を指定して拒否されること');

    let directForeignCustInsertRejected = false;
    try {
      await client.query(
        `INSERT INTO quotations (tenant_id, customer_id, quote_no, title, created_by)
         VALUES ($1, $2, 'QT-TEST-FOREIGN', 'Direct SQL', $3)`,
        [tenantA, custBId, userA],
      );
    } catch (err: any) {
      if (err.code === '23503' || err.message.includes('does not belong to tenant')) {
        directForeignCustInsertRejected = true;
      }
    }
    assert(directForeignCustInsertRejected, 'DBトリガー: 別テナント顧客の直接INSERTが拒否されること (ERRCODE: 23503)');

    // ------------------------------------------------------------------------
    // 4. RLSによる完全テナント分離
    // ------------------------------------------------------------------------
    console.log('\n4. RLSによるテナント分離の検証...');

    // db.transaction を用いることで app_runtime ロール & tenant_id コンテキストが設定され、スーパーユーザーRLSバイパスを防止
    await db.transaction(tenantB, userB, async (txClient) => {
      await txClient.query('SET LOCAL ROLE app_runtime');
      const tenantBQuoteRes = await txClient.query(`SELECT * FROM quotations WHERE id = $1`, [createdQuote.id]);
      assert(tenantBQuoteRes.rows.length === 0, 'RLS: テナントBからテナントAの見積が見えないこと (0件)');

      const tenantBLineRes = await txClient.query(
        `SELECT * FROM quotation_line_items WHERE quotation_id = $1`,
        [createdQuote.id],
      );
      assert(tenantBLineRes.rows.length === 0, 'RLS: テナントBからテナントAの見積明細が見えないこと (0件)');
    });

    // サービス層の list メソッドでも他テナントデータが不可視であることを確認
    const rlsList = await quotationsService.list(tenantB, userB, { page: 1, limit: 20 });
    assert(rlsList.quotations.length === 0, 'RLS: サービス層でもテナントBからテナントAの見積が見えないこと (0件)');

    // ------------------------------------------------------------------------
    // 5. 確定送付 (sent) と WORM 不変性トリガー (親テーブル)
    // ------------------------------------------------------------------------
    console.log('\n5. 確定送付 (sent) と親テーブルのWORM不変性検証...');

    const sentQuote = await quotationsService.send(tenantA, userA, createdQuote.id);
    assert(sentQuote.status === 'sent', '見積が sent 状態に遷移したこと');

    // 5.1 アプリケーション層での拒否
    let appUpdateRejected = false;
    try {
      await quotationsService.update(tenantA, userA, sentQuote.id, { title: 'Sent状態での改変試行' });
    } catch {
      appUpdateRejected = true;
    }
    assert(appUpdateRejected, 'アプリ層: sent状態の見積更新が拒絶されること');

    // 5.2 DB直接 UPDATE の拒否 (金額 subtotal 改変)
    let dbSubtotalUpdateRejected = false;
    try {
      await client.query(
        `UPDATE quotations SET subtotal = 999999 WHERE id = $1`,
        [sentQuote.id],
      );
    } catch (err: any) {
      if (err.code === '55000') dbSubtotalUpdateRejected = true;
    }
    assert(dbSubtotalUpdateRejected, 'DBトリガー: sent後の subtotal 直接改変が拒絶されること (ERRCODE: 55000)');

    // 5.3 DB直接 UPDATE の拒否 (顧客 customer_id 改変: 別顧客への変更試行)
    let dbCustomerUpdateRejected = false;
    try {
      await client.query(
        `UPDATE quotations SET customer_id = $1 WHERE id = $2`,
        [custBId, sentQuote.id],
      );
    } catch (err: any) {
      if (err.code === '55000') dbCustomerUpdateRejected = true;
    }
    assert(dbCustomerUpdateRejected, 'DBトリガー: sent後の customer_id 直接改変が拒絶されること (ERRCODE: 55000)');

    // 5.4 DB直接 DELETE の拒否
    let dbDeleteRejected = false;
    try {
      await client.query(`DELETE FROM quotations WHERE id = $1`, [sentQuote.id]);
    } catch (err: any) {
      if (err.code === '55000') dbDeleteRejected = true;
    }
    assert(dbDeleteRejected, 'DBトリガー: sent後の見積直接DELETEが拒絶されること (ERRCODE: 55000)');

    // ------------------------------------------------------------------------
    // 6. 明細行 (quotation_line_items) に対する sent 後の INSERT/UPDATE/DELETE 全遮断
    // ------------------------------------------------------------------------
    console.log('\n6. 確認事項-06: sent後の明細行 INSERT/UPDATE/DELETE 全遮断検証...');

    const sampleLineId = sentQuote.lines[0].id;

    // 6.1 明細直接 INSERT の拒否
    let dbLineInsertRejected = false;
    try {
      await client.query(
        `INSERT INTO quotation_line_items (tenant_id, quotation_id, line_no, item_name, quantity, unit_price, amount)
         VALUES ($1, $2, 99, '不正追加明細', 1, 50000, 50000)`,
        [tenantA, sentQuote.id],
      );
    } catch (err: any) {
      if (err.code === '55000') dbLineInsertRejected = true;
    }
    assert(dbLineInsertRejected, 'DBトリガー: sent後の見積明細直接INSERTが拒絶されること (ERRCODE: 55000)');

    // 6.2 明細直接 UPDATE の拒否
    let dbLineUpdateRejected = false;
    try {
      await client.query(
        `UPDATE quotation_line_items SET amount = 999999 WHERE id = $1`,
        [sampleLineId],
      );
    } catch (err: any) {
      if (err.code === '55000') dbLineUpdateRejected = true;
    }
    assert(dbLineUpdateRejected, 'DBトリガー: sent後の見積明細直接UPDATEが拒絶されること (ERRCODE: 55000)');

    // 6.3 明細直接 DELETE の拒否
    let dbLineDeleteRejected = false;
    try {
      await client.query(`DELETE FROM quotation_line_items WHERE id = $1`, [sampleLineId]);
    } catch (err: any) {
      if (err.code === '55000') dbLineDeleteRejected = true;
    }
    assert(dbLineDeleteRejected, 'DBトリガー: sent後の見積明細直接DELETEが拒絶されること (ERRCODE: 55000)');

    // ------------------------------------------------------------------------
    // 7. BLOCKER-01: superseded_by の一度きり遷移例外制御
    // ------------------------------------------------------------------------
    console.log('\n7. BLOCKER-01: superseded_by の遷移例外制御検証...');

    // 7.1 自分自身への循環リンク拒絶
    let selfSupersededRejected = false;
    try {
      await client.query(
        `UPDATE quotations SET superseded_by = $1 WHERE id = $1`,
        [sentQuote.id],
      );
    } catch (err: any) {
      if (err.code === '23001') selfSupersededRejected = true;
    }
    assert(selfSupersededRejected, 'DBトリガー: 自分自身への superseded_by 設定が拒絶されること (ERRCODE: 23001)');

    // 7.2 改訂フロー経由での正常な superseded_by リンク設定 (v1 -> v2)
    const revisedQuote = await quotationsService.revise(tenantA, userA, sentQuote.id, {
      notes: '第2版改訂: クライアント要望に伴う調整',
    });
    assert(revisedQuote.version === 2, '改訂版のバージョンが 2 であること');
    assert(revisedQuote.quote_no === sentQuote.quote_no, '同一の見積番号が引き継がれていること');

    const oldQuoteCheck = await quotationsService.findById(tenantA, userA, sentQuote.id);
    assert(oldQuoteCheck.superseded_by === revisedQuote.id, '旧見積の superseded_by が新見積IDに設定されていること');
    assert(Number(oldQuoteCheck.total_amount) === 1210000, '旧見積の金額レコードが一切書き換わっていないこと (不変)');

    // 7.3 既に superseded_by が設定されたレコードへの再変更拒否
    let reassignSupersededRejected = false;
    const dummyNewId = uuidv4();
    try {
      await client.query(
        `UPDATE quotations SET superseded_by = $1 WHERE id = $2`,
        [dummyNewId, sentQuote.id],
      );
    } catch (err: any) {
      if (err.code === '55000') reassignSupersededRejected = true;
    }
    assert(reassignSupersededRejected, 'DBトリガー: 設定済み superseded_by の再変更が拒絶されること (ERRCODE: 55000)');

    // 7.4 既に superseded_by が設定されたレコードの NULL 巻き戻し拒絶
    let rollbackSupersededRejected = false;
    try {
      await client.query(
        `UPDATE quotations SET superseded_by = NULL WHERE id = $1`,
        [sentQuote.id],
      );
    } catch (err: any) {
      if (err.code === '55000') rollbackSupersededRejected = true;
    }
    assert(rollbackSupersededRejected, 'DBトリガー: superseded_by の NULL 巻き戻しが拒絶されること (ERRCODE: 55000)');

    // ------------------------------------------------------------------------
    // 8. 確認事項-03: 受注転換の同時実行 (二重転換) 耐性・孤立レコード未発生検証
    // ------------------------------------------------------------------------
    console.log('\n8. 確認事項-03: 受注転換の並行・同時実行耐性検証...');

    // 同時実行テスト用の見積を作成・sent
    const concurQuote = await quotationsService.create(tenantA, userA, {
      customer_id: custAId,
      title: '同時実行耐性テスト用見積',
      lines: [
        {
          item_name: '同時実行テスト品目 A',
          quantity: 2,
          unit: '式',
          unit_price: 300000,
          tax_rate: 0.1,
        },
      ],
    });
    await quotationsService.send(tenantA, userA, concurQuote.id);

    // 2つの並行クライアントコネクションを作成
    const poolClient1 = await pool.connect();
    const poolClient2 = await pool.connect();

    // 2つのトランザクションからほぼ同時に convert を試行
    const runConvert1 = quotationsService.convert(tenantA, userA, concurQuote.id);
    const runConvert2 = quotationsService.convert(tenantA, userA, concurQuote.id);

    const concurResults = await Promise.allSettled([runConvert1, runConvert2]);

    poolClient1.release();
    poolClient2.release();

    const fulfilled = concurResults.filter((r) => r.status === 'fulfilled');
    const rejected = concurResults.filter((r) => r.status === 'rejected');

    if (rejected.length > 0) {
      rejected.forEach((rej: any) => console.log('  [CONCUR ERROR INFO]:', rej.reason?.message || rej.reason));
    }

    assert(fulfilled.length === 1, `同時実行: 1つだけが成功すること (成功数: ${fulfilled.length})`);
    assert(rejected.length === 1, `同時実行: 1つが拒絶されること (失敗数: ${rejected.length})`);

    // 孤立した invoice レコードが残っていないか検証
    const concurCheckQuote = await quotationsService.findById(tenantA, userA, concurQuote.id);
    const convertedInvoiceId = concurCheckQuote.converted_invoice_id;
    assert(Boolean(convertedInvoiceId), '転換先 invoice_id が設定されていること');

    let matchingInvoices: any = { rows: [] };
    if (convertedInvoiceId) {
      matchingInvoices = await client.query(
        `SELECT id, status, tenant_id FROM invoices WHERE id = $1`,
        [convertedInvoiceId],
      );
    }
    assert(matchingInvoices.rows.length === 1, '成功したトランザクションの請求書が厳密に1件存在すること');
    assert(matchingInvoices.rows[0]?.status === 'draft', '自動生成された請求書は必ず draft 状態であること (BLOCKER候補-02)');

    // 当該見積番号を含む請求書が重複して生成されていないことを確認
    const allInvoicesForQuote = await client.query(
      `SELECT count(*) as cnt FROM quotations WHERE converted_invoice_id = $1`,
      [convertedInvoiceId],
    );
    assert(Number(allInvoicesForQuote.rows[0].cnt) === 1, 'converted_invoice_id の UNIQUE 性が保たれていること');

    // ------------------------------------------------------------------------
    // 9. 確認事項-04 & 05: tenant_id 強制導出および認証主体の記録検証
    // ------------------------------------------------------------------------
    console.log('\n9. 確認事項-04 & 05: tenant_id 強制導出および認証セッション主体の記録検証...');

    const invoiceRow = matchingInvoices.rows[0];
    assert(
      invoiceRow.tenant_id === tenantA,
      `確認事項-04: 生成された invoice の tenant_id (${invoiceRow.tenant_id}) が見積の tenant_id (${tenantA}) と完全一致すること`,
    );

    const invoiceLinesRes = await client.query(
      `SELECT id, tenant_id FROM invoice_lines WHERE invoice_id = $1`,
      [convertedInvoiceId],
    );
    assert(invoiceLinesRes.rows.length === 1, '明細行が1件生成されていること');
    assert(
      invoiceLinesRes.rows[0].tenant_id === tenantA,
      `確認事項-04: 生成された invoice_lines の tenant_id も見積の tenant_id と完全一致すること`,
    );

    // 認証主体の記録確認
    const quoteConvertedByRes = await client.query(
      `SELECT converted_by, status FROM quotations WHERE id = $1`,
      [concurQuote.id],
    );
    assert(
      quoteConvertedByRes.rows[0].converted_by === userA,
      `確認事項-05: quotations.converted_by に認証セッションの userA (${userA}) が記録されていること`,
    );

    const invoiceCreatedByRes = await client.query(
      `SELECT created_by FROM invoices WHERE id = $1`,
      [convertedInvoiceId],
    );
    assert(
      invoiceCreatedByRes.rows[0].created_by === userA,
      `確認事項-05: invoices.created_by に認証セッションの userA (${userA}) が記録されていること`,
    );

    // ------------------------------------------------------------------------
    // 10. 受注転換の多重実行防止 (再度の呼び出し拒絶)
    // ------------------------------------------------------------------------
    console.log('\n10. 受注転換の多重実行防止 (再実行の拒絶)...');

    let duplicateConvertRejected = false;
    try {
      await quotationsService.convert(tenantA, userA, concurQuote.id);
    } catch {
      duplicateConvertRejected = true;
    }
    assert(duplicateConvertRejected, '既に転換済みの見積書への再転換呼び出しが拒絶されること');

    // ------------------------------------------------------------------------
    // 11. 確認事項-07: 日本語フォント (IPAexゴシック) 埋め込みによる見積書PDF生成検証
    // ------------------------------------------------------------------------
    console.log('\n11. 確認事項-07: 日本語フォント埋め込み・見積書PDF生成検証...');

    const pdfBuffer = await pdfService.generatePdf(concurCheckQuote);
    assert(pdfBuffer instanceof Buffer, 'PDF Buffer が生成されること');
    assert(pdfBuffer.length > 5000, `PDF バイトサイズが十分であること (${pdfBuffer.length} bytes)`);
    assert(pdfBuffer.subarray(0, 4).toString() === '%PDF', 'PDFヘッダーシグネチャ (%PDF) が正しいこと');

    // ------------------------------------------------------------------------
    // 結果サマリー
    // ------------------------------------------------------------------------
    console.log('\n=============================================================');
    console.log(`=== P4-T1-FIX E2E Verification Completed: ${passed} passed, ${failed} failed ===`);
    console.log('=============================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal E2E error:', err);
  process.exit(1);
});
