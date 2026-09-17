/**
 * verify-quotations-e2e.ts
 * =========================
 * Phase 4 Task 1 (P4-T1): 見積書機能 実DB包括E2E検証スクリプト
 *
 * 検証項目:
 * 1. テナント・ユーザー・顧客マスタ・税区分の初期化
 * 2. 見積作成 (draft) と明細金額・税額・合計金額の整合性
 * 3. テナント整合性トリガー (別テナント顧客の指定拒否, 別テナント明細の拒否)
 * 4. RLSによる完全テナント分離 (他テナントの見積・明細が不可視)
 * 5. 確定送付 (sent) 後のWORM不変性DBトリガー (親テーブル更新拒否, 明細変更拒否, 削除拒否: 55000)
 * 6. 見積改訂 (新バージョン発行, 旧レコード保持, superseded_by リンク, 二重改訂防止)
 * 7. 見積受注確定 (accepted) と受注転換 (既存invoices/invoice_lines連携)
 * 8. 受注転換の多重実行防止 (DB制約・トリガーによる2回目拒否)
 * 9. 見積書PDF生成 (pdf-lib, A4縦, %PDF- ヘッダー検証)
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { QuotationPdfService } from '../modules/quotations/quotation-pdf.service';
import { QuotationsService } from '../modules/quotations/quotations.service';

const rawDsn = process.argv[2] || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';

async function main() {
  console.log('=== P4-T1 見積書機能 実DB E2E検証開始 ===');
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
       ($1, $2, 'hash', 'User A'),
       ($3, $4, 'hash', 'User B')`,
      [userA, `ua_${Date.now()}@example.com`, userB, `ub_${Date.now()}@example.com`],
    );

    const roleRes = await client.query(
      `SELECT id, code FROM roles WHERE code = 'owner'`,
    );
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

    // テナントAの税区分
    const taxCatAId = uuidv4();
    await client.query(
      `INSERT INTO tax_categories (id, tenant_id, code, name, tax_type, tax_rate)
       VALUES ($1, $2, 'TAX10', '標準税率10%', 'taxable', 10.00)
       ON CONFLICT (tenant_id, code) DO NOTHING`,
      [taxCatAId, tenantA],
    );

    // 顧客マスタ (customers)
    const customerA1Id = uuidv4();
    const customerA2Id = uuidv4();
    const customerB1Id = uuidv4();

    await client.query(
      `INSERT INTO customers (id, tenant_id, code, name) VALUES
       ($1, $2, 'CUST-A1', '株式会社クライアントA1'),
       ($3, $4, 'CUST-A2', '株式会社クライアントA2'),
       ($5, $6, 'CUST-B1', '株式会社クライアントB1')`,
      [customerA1Id, tenantA, customerA2Id, tenantA, customerB1Id, tenantB],
    );

    assert(true, 'テナント・ユーザー・顧客マスタの初期化完了');

    // ------------------------------------------------------------------------
    // 2. 見積作成 & 明細金額計算検証 (draft)
    // ------------------------------------------------------------------------
    console.log('\n2. 見積作成 (draft) と明細計算検証...');

    const quoteInput = {
      customer_id: customerA1Id,
      title: 'Webシステム開発見積',
      issue_date: '2026-09-17',
      valid_until: '2026-10-31',
      notes: '納品後検収完了日の翌月末払い',
      lines: [
        {
          item_name: '基本設計・UI設計',
          description: '画面設計およびAPI仕様策定',
          quantity: 2,
          unit: '人月',
          unit_price: 500000,
          tax_rate: 0.1,
        },
        {
          item_name: 'フロントエンド実装',
          description: 'React/Viteコンポーネント開発',
          quantity: 1,
          unit: '式',
          unit_price: 300000,
          tax_rate: 0.1,
        },
      ],
    };

    const quote1 = await quotationsService.create(tenantA, userA, quoteInput);

    assert(quote1.status === 'draft', '初期ステータスが draft である');
    assert(quote1.version === 1, '初期バージョン番号が 1 である');
    assert(quote1.subtotal === 1300000, `小計が 1,300,000 円である (実測: ${quote1.subtotal})`);
    assert(quote1.tax_amount === 130000, `消費税額が 130,000 円である (実測: ${quote1.tax_amount})`);
    assert(quote1.total_amount === 1430000, `合計金額が 1,430,000 円である (実測: ${quote1.total_amount})`);
    assert(quote1.lines.length === 2, '明細行が2行正しく作成されている');
    assert(quote1.quote_no.startsWith('QT-2026-'), `見積番号形式が QT-2026-XXXX である (${quote1.quote_no})`);

    // 下書き状態での更新検証
    const updatedQuote1 = await quotationsService.update(tenantA, userA, quote1.id, {
      title: 'Webシステム開発見積 (改訂下書き)',
      lines: [
        {
          item_name: '基本設計・UI設計 (仕様確定)',
          quantity: 2,
          unit: '人月',
          unit_price: 600000,
          tax_rate: 0.1,
        },
      ],
    });
    assert(updatedQuote1.title === 'Webシステム開発見積 (改訂下書き)', '下書き状態での件名更新が成功した');
    assert(updatedQuote1.subtotal === 1200000, `更新後小計が 1,200,000 円である (実測: ${updatedQuote1.subtotal})`);
    assert(updatedQuote1.total_amount === 1320000, `更新後合計が 1,320,000 円である (実測: ${updatedQuote1.total_amount})`);

    // ------------------------------------------------------------------------
    // 3. テナント整合性トリガー検証 (MAJOR-02教訓)
    // ------------------------------------------------------------------------
    console.log('\n3. テナント整合性トリガー検証...');

    let crossTenantCustomerError = false;
    try {
      // テナントAの見積にテナントBの顧客customerB1Idを指定
      await quotationsService.create(tenantA, userA, {
        customer_id: customerB1Id,
        title: '不正テナント顧客指定見積',
        lines: [{ item_name: 'テスト', quantity: 1, unit: '式', unit_price: 1000, tax_rate: 0.1 }],
      });
    } catch (e: any) {
      crossTenantCustomerError = true;
    }
    assert(crossTenantCustomerError, '他テナントの顧客を指定した見積作成が拒否される');

    // DBトリガーレベルでの明細テナント不整合拒否
    let crossTenantLineError = false;
    try {
      await client.query(
        `INSERT INTO quotation_line_items (tenant_id, quotation_id, line_no, item_name, quantity, unit_price, amount)
         VALUES ($1, $2, 99, '不正明細', 1, 1000, 1000)`,
        [tenantB, quote1.id], // 親見積はtenantAだが、明細行にtenantBを指定
      );
    } catch (e: any) {
      crossTenantLineError = true;
    }
    assert(crossTenantLineError, '親見積とtenant_idが異なる明細行の挿入がDBトリガーで拒否される');

    // ------------------------------------------------------------------------
    // 4. RLS テナント完全分離検証
    // ------------------------------------------------------------------------
    console.log('\n4. RLS テナント完全分離検証...');

    // app_runtime ロールに切り替えてテナントBのコンテキストで検索
    await client.query(`SET ROLE app_runtime`);
    await client.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantB]);

    const { rows: visibleQuotesToB } = await client.query(`SELECT * FROM quotations WHERE id = $1`, [quote1.id]);
    assert(visibleQuotesToB.length === 0, 'RLS: テナントBからテナントAの見積書が一切不可視である (0件)');

    const { rows: visibleLinesToB } = await client.query(
      `SELECT * FROM quotation_line_items WHERE quotation_id = $1`,
      [quote1.id],
    );
    assert(visibleLinesToB.length === 0, 'RLS: テナントBからテナントAの見積明細行が一切不可視である (0件)');

    // postgres ロールに戻す
    await client.query(`RESET ROLE`);

    // ------------------------------------------------------------------------
    // 5. 確定送付 (sent) 後のWORM不変性DBトリガー検証 (計画書6.2節 原則1)
    // ------------------------------------------------------------------------
    console.log('\n5. 確定送付 (sent) 後のWORM不変性DBトリガー検証...');

    // 確定送付実行 (draft -> sent)
    const sentQuote = await quotationsService.send(tenantA, userA, quote1.id);
    assert(sentQuote.status === 'sent', '見積書が提示・確定送付済 (sent) に遷移した');

    // 5.1 sent後の重要列直接UPDATE拒否 (金額、顧客、件名、番号等)
    let updateQuoteError = false;
    try {
      await client.query(
        `UPDATE quotations SET subtotal = 9999999 WHERE id = $1`,
        [quote1.id],
      );
    } catch (e: any) {
      updateQuoteError = true;
      assert(e.code === '55000', `sent後の金額直接更新がDBトリガーでエラーコード55000送出 (実測: ${e.code})`);
    }
    assert(updateQuoteError, 'sent状態の見積ヘッダ直接UPDATEがDBトリガーでfail-closedに拒否された');

    // 5.2 sent後の明細行直接変更拒否
    let updateLineError = false;
    try {
      await client.query(
        `UPDATE quotation_line_items SET unit_price = 999999 WHERE quotation_id = $1`,
        [quote1.id],
      );
    } catch (e: any) {
      updateLineError = true;
      assert(e.code === '55000', `sent後の明細更新がDBトリガーでエラーコード55000送出 (実測: ${e.code})`);
    }
    assert(updateLineError, 'sent状態の見積明細行直接UPDATEがDBトリガーでfail-closedに拒否された');

    // 5.3 sent後の明細行新規追加拒否
    let insertLineError = false;
    try {
      await client.query(
        `INSERT INTO quotation_line_items (tenant_id, quotation_id, line_no, item_name, quantity, unit_price, amount)
         VALUES ($1, $2, 2, '追加明細', 1, 5000, 5000)`,
        [tenantA, quote1.id],
      );
    } catch (e: any) {
      insertLineError = true;
    }
    assert(insertLineError, 'sent状態の見積への明細行追加がDBトリガーでfail-closedに拒否された');

    // 5.4 sent後の物理削除拒否
    let deleteSentQuoteError = false;
    try {
      await client.query(`DELETE FROM quotations WHERE id = $1`, [quote1.id]);
    } catch (e: any) {
      deleteSentQuoteError = true;
      assert(e.code === '55000', `sent後の削除がDBトリガーでエラーコード55000送出 (実測: ${e.code})`);
    }
    assert(deleteSentQuoteError, 'sent状態の見積書の物理削除がDBトリガーでfail-closedに拒否された');

    // ------------------------------------------------------------------------
    // 6. 見積改訂 (新バージョン発行) フロー検証
    // ------------------------------------------------------------------------
    console.log('\n6. 見積改訂 (新バージョン発行) フロー検証...');

    const revisedQuote = await quotationsService.revise(tenantA, userA, quote1.id, {
      notes: 'クライアント要望による改訂版発行',
    });

    assert(revisedQuote.id !== quote1.id, '新改訂版は異なるIDで新規レコードとして発行された');
    assert(revisedQuote.quote_no === quote1.quote_no, `同一の見積番号が引き継がれている (${revisedQuote.quote_no})`);
    assert(revisedQuote.version === 2, `バージョン番号がインクリメントされた (v2)`);
    assert(revisedQuote.status === 'draft', '新改訂版は下書き (draft) 状態で起票された');
    assert(revisedQuote.lines.length === 1, '旧見積の明細が正しく新改訂版に引き継がれている');

    // 元の見積書(v1)の状態確認: 元レコードが保持され、superseded_by のみが更新されていること
    const originalQuoteAfterRevise = await quotationsService.findById(tenantA, userA, quote1.id);
    assert(originalQuoteAfterRevise.status === 'sent', '旧見積書(v1)はsent状態のまま保持されている');
    assert(originalQuoteAfterRevise.superseded_by === revisedQuote.id, '旧見積書(v1)のsuperseded_byに新版IDが設定された');
    assert(originalQuoteAfterRevise.total_amount === 1320000, '旧見積書(v1)の金額は一切書き換わっていない');

    // 既に superseded_by がセットされた見積からの二重改訂拒否
    let doubleReviseError = false;
    try {
      await quotationsService.revise(tenantA, userA, quote1.id, { notes: '二重改訂試行' });
    } catch (e: any) {
      doubleReviseError = true;
    }
    assert(doubleReviseError, '既に改訂済みの旧見積からの二重改訂が防止された');

    // ------------------------------------------------------------------------
    // 7. 受注確定 (accepted) と受注転換 (invoices連携) 検証
    // ------------------------------------------------------------------------
    console.log('\n7. 受注確定 (accepted) と受注転換 (invoices連携) 検証...');

    // 新版(v2)を確定送付 -> 受注確定
    await quotationsService.send(tenantA, userA, revisedQuote.id);
    const acceptedQuote = await quotationsService.accept(tenantA, userA, revisedQuote.id);
    assert(acceptedQuote.status === 'accepted', '新版見積書が受注確定 (accepted) 状態に遷移した');

    // 受注転換実行 (invoices / invoice_lines 起票)
    const convertResult = await quotationsService.convert(tenantA, userA, revisedQuote.id);
    assert(Boolean(convertResult.invoiceId), `売上請求書が正常に生成された (ID: ${convertResult.invoiceId})`);
    assert(convertResult.invoiceNo.startsWith('INV-2026-'), `請求書番号が採番された (${convertResult.invoiceNo})`);

    // 生成された請求書データの確認
    const { rows: generatedInvoiceRows } = await client.query(
      `SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2`,
      [convertResult.invoiceId, tenantA],
    );
    assert(generatedInvoiceRows.length === 1, 'invoicesテーブルに売上請求書レコードが存在する');
    assert(generatedInvoiceRows[0].status === 'draft', '生成された請求書はdraft状態である');
    assert(Number(generatedInvoiceRows[0].subtotal_amount) === revisedQuote.subtotal, '請求書の小計金額が見積と一致する');

    const { rows: generatedLineRows } = await client.query(
      `SELECT * FROM invoice_lines WHERE invoice_id = $1 AND tenant_id = $2`,
      [convertResult.invoiceId, tenantA],
    );
    assert(generatedLineRows.length === revisedQuote.lines.length, '請求書明細行の件数が見積明細と一致する');
    assert(Number(generatedLineRows[0].amount) === revisedQuote.lines[0].amount, '請求書明細の金額が見積明細と一致する');

    // 見積書側の状態確認
    const convertedQuotation = await quotationsService.findById(tenantA, userA, revisedQuote.id);
    assert(
      convertedQuotation.converted_invoice_id === convertResult.invoiceId,
      '見積書にconverted_invoice_idが正しく永続化された',
    );
    assert(Boolean(convertedQuotation.converted_at), '見積書にconverted_atタイムスタンプが記録された');

    // ------------------------------------------------------------------------
    // 8. 受注転換の多重実行防止検証 (計画書6.2節 原則2)
    // ------------------------------------------------------------------------
    console.log('\n8. 受注転換の多重実行防止検証...');

    let duplicateConvertError = false;
    try {
      // 同一見積から2回目の受注転換を実行
      await quotationsService.convert(tenantA, userA, revisedQuote.id);
    } catch (e: any) {
      duplicateConvertError = true;
    }
    assert(duplicateConvertError, '同一見積からの2回目の受注転換がアプリケーション層で拒否された');

    // DBトリガーレベルでの多重転換防止検証
    let triggerDuplicateConvertError = false;
    try {
      const dummyInvoiceId = uuidv4();
      await client.query(
        `INSERT INTO invoices (id, tenant_id, invoice_no, customer_id, issue_date, due_date, status, subtotal_amount, tax_amount, created_by)
         VALUES ($1, $2, 'INV-DUMMY-001', $3, CURRENT_DATE, CURRENT_DATE+30, 'draft', 100, 10, $4)`,
        [dummyInvoiceId, tenantA, customerA1Id, userA],
      );
      // 既に転換済みの見積書に対して直接別の converted_invoice_id を更新しようとする
      await client.query(
        `UPDATE quotations SET converted_invoice_id = $1 WHERE id = $2`,
        [dummyInvoiceId, revisedQuote.id],
      );
    } catch (e: any) {
      triggerDuplicateConvertError = true;
      assert(e.code === '55000', `多重転換更新がDBトリガーでエラーコード55000送出 (実測: ${e.code})`);
    }
    assert(triggerDuplicateConvertError, '同一見積へのconverted_invoice_id再設定がDBトリガーでfail-closedに拒否された');

    // ------------------------------------------------------------------------
    // 9. 見積書PDF生成検証
    // ------------------------------------------------------------------------
    console.log('\n9. 見積書PDF生成検証...');

    const { buffer, filename } = await quotationsService.getPdf(tenantA, userA, revisedQuote.id);
    assert(buffer.length > 500, `見積書PDFバイナリが生成された (サイズ: ${buffer.length} bytes)`);
    assert(buffer.toString('utf-8', 0, 5) === '%PDF-', '生成されたバッファが正規のPDFヘッダーを含む');
    assert(filename.includes(revisedQuote.quote_no), `ファイル名に見積番号が含まれる (${filename})`);
    assert(filename.includes('v2'), `ファイル名にバージョン番号が含まれる (${filename})`);

    // ------------------------------------------------------------------------
    // 完了サマリー
    // ------------------------------------------------------------------------
    console.log('\n==================================================');
    console.log(`検証結果サマリー: ${passed} 成功 / ${failed} 失敗`);
    console.log('==================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('予期しないエラー:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
