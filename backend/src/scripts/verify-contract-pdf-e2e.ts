import { PDFDocument, StandardFonts } from 'pdf-lib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { Pool } from 'pg';
import { DatabaseService } from '../database/database.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { AiSuggestionsService } from '../modules/ai-suggestions/ai-suggestions.service';
import { ContractsService } from '../modules/contracts/contracts.service';
import { AppException } from '../common/exceptions/app.exception';

async function createTestPdf(lines: string[]): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 400]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let y = 350;
  for (const line of lines) {
    page.drawText(line, { x: 50, y, size: 12, font });
    y -= 25;
  }
  const pdfBytes = await doc.save();
  const filePath = join(tmpdir(), `e2e_contract_${randomUUID()}.pdf`);
  await writeFile(filePath, Buffer.from(pdfBytes));
  return filePath;
}

async function createBlankPdf(): Promise<string> {
  const doc = await PDFDocument.create();
  doc.addPage([600, 400]); // 文字列描画なしの白紙PDF
  const pdfBytes = await doc.save();
  const filePath = join(tmpdir(), `e2e_blank_${randomUUID()}.pdf`);
  await writeFile(filePath, Buffer.from(pdfBytes));
  return filePath;
}

async function run() {
  const dsn = process.argv[2] || process.env.DATABASE_URL;
  if (!dsn) {
    console.error('Usage: ts-node verify-contract-pdf-e2e.ts <dsn>');
    process.exit(1);
  }

  // 1. DBとサービス初期化
  const pool = new Pool({ connectionString: dsn });
  const db = new DatabaseService();
  (db as any).pool = pool;
  const auditLogs = new AuditLogsService(db);
  const aiSuggestions = new AiSuggestionsService(db);
  const contractsService = new ContractsService(db, auditLogs, aiSuggestions);

  const client = await pool.connect();
  const tempFiles: string[] = [];

  try {
    // テナントとユーザーを取得 (初期シードデータから)
    const tenantRes = await client.query('SELECT id FROM tenants LIMIT 1');
    if (tenantRes.rowCount === 0) {
      throw new Error('テナントが見つかりません。シードデータを先に投入してください。');
    }
    const tenantId = tenantRes.rows[0].id;

    const userRes = await client.query('SELECT user_id AS id FROM tenant_users WHERE tenant_id = $1 LIMIT 1', [tenantId]);
    if (userRes.rowCount === 0) {
      throw new Error('ユーザーが見つかりません。');
    }
    const userId = userRes.rows[0].id;

    console.log(`[E2E] テスト実行開始: tenantId=${tenantId}, userId=${userId}`);

    // =========================================================================
    // テスト1: 既知のテキストを持つ実PDF 1 (金額 1,200,000円)
    // =========================================================================
    const pdf1Path = await createTestPdf([
      'Contract Agreement',
      'Title: Service Agreement A',
      'Party A: Alpha Tech Corp',
      'Party B: Beta Solutions Inc',
      'Period: 2026-04-01 to 2027-03-31',
      'Amount: JPY 1200000',
      'Renewal: Auto-renewal unless 30 days prior notice',
    ]);
    tempFiles.push(pdf1Path);

    const att1Id = randomUUID();
    await client.query(
      `INSERT INTO attachments (
         id, tenant_id, file_name, mime_type, file_hash, storage_path,
         document_category, uploaded_by
       ) VALUES ($1, $2, 'service_a.pdf', 'application/pdf', $3, $4, 'contract', $5)`,
      [att1Id, tenantId, createHash('sha256').update(pdf1Path).digest('hex'), pdf1Path, userId],
    );

    console.log('[E2E] 実PDF 1 (金額 1,200,000円) アップロード完了。条項抽出実行...');
    const result1 = await contractsService.extractTerms(tenantId, userId, {
      attachment_id: att1Id, // raw_textは一切指定せず、実PDFから読ませる！
    });

    console.log('[E2E] 実PDF 1 抽出結果:', JSON.stringify(result1.payload));
    if (result1.model_name !== 'contract-extractor-v1') {
      throw new Error(`PDF 1 model_nameが不正です: ${result1.model_name}`);
    }
    if (result1.provider !== 'rule_engine') {
      throw new Error(`PDF 1 providerが不正です: ${result1.provider}`);
    }
    const fields1 = (result1.payload?.suggested_fields ?? {}) as Record<string, any>;
    if (!fields1.contract_amount || fields1.contract_amount.value !== 1200000) {
      throw new Error(`PDF 1 の契約金額が 1,200,000 として抽出されていません: ${JSON.stringify(fields1.contract_amount)}`);
    }

    // =========================================================================
    // テスト2: 異なるテキストを持つ実PDF 2 (金額 3,500,000円)
    // 内容によって抽出結果が動的に変化することの完全証明
    // =========================================================================
    const pdf2Path = await createTestPdf([
      'Software License Contract',
      'Title: Enterprise License Agreement B',
      'Party A: Gamma Global LLC',
      'Party B: Delta Systems Ltd',
      'Period: 2026-10-01 to 2027-09-30',
      'Amount: JPY 3500000',
    ]);
    tempFiles.push(pdf2Path);

    const att2Id = randomUUID();
    await client.query(
      `INSERT INTO attachments (
         id, tenant_id, file_name, mime_type, file_hash, storage_path,
         document_category, uploaded_by
       ) VALUES ($1, $2, 'license_b.pdf', 'application/pdf', $3, $4, 'contract', $5)`,
      [att2Id, tenantId, createHash('sha256').update(pdf2Path).digest('hex'), pdf2Path, userId],
    );

    console.log('[E2E] 実PDF 2 (金額 3,500,000円) アップロード完了。条項抽出実行...');
    const result2 = await contractsService.extractTerms(tenantId, userId, {
      attachment_id: att2Id, // raw_textは一切指定しない
    });

    console.log('[E2E] 実PDF 2 抽出結果:', JSON.stringify(result2.payload));
    const fields2 = (result2.payload?.suggested_fields ?? {}) as Record<string, any>;
    if (!fields2.contract_amount || fields2.contract_amount.value !== 3500000) {
      throw new Error(`PDF 2 の契約金額が 3,500,000 として抽出されていません: ${JSON.stringify(fields2.contract_amount)}`);
    }

    // PDF 1 と PDF 2 で結果が明確に異なることの検証
    if (fields1.contract_amount.value === fields2.contract_amount.value) {
      throw new Error('PDF 1 と PDF 2 の抽出結果が同一です。PDF内容依存性が満たされていません。');
    }
    console.log('[E2E] PDF内容依存性の証明成功: PDF 1 金額=1,200,000, PDF 2 金額=3,500,000');

    // =========================================================================
    // テスト3: 白紙PDF (テキスト0文字) のエラーハンドリング
    // 無言のダミーフォールバックを行わず、明確に例外が送出されることの証明
    // =========================================================================
    const blankPdfPath = await createBlankPdf();
    tempFiles.push(blankPdfPath);

    const attBlankId = randomUUID();
    await client.query(
      `INSERT INTO attachments (
         id, tenant_id, file_name, mime_type, file_hash, storage_path,
         document_category, uploaded_by
       ) VALUES ($1, $2, 'blank.pdf', 'application/pdf', $3, $4, 'contract', $5)`,
      [attBlankId, tenantId, createHash('sha256').update(blankPdfPath).digest('hex'), blankPdfPath, userId],
    );

    console.log('[E2E] 白紙PDF アップロード完了。条項抽出実行(エラー発生期待)...');
    let threwError = false;
    try {
      await contractsService.extractTerms(tenantId, userId, {
        attachment_id: attBlankId,
      });
    } catch (err: unknown) {
      if (err instanceof AppException && err.getStatus() === 400) {
        threwError = true;
        console.log(`[E2E] 期待通りの400エラー送出を確認: ${err.message}`);
      } else {
        throw err;
      }
    }
    if (!threwError) {
      throw new Error('白紙PDFに対して例外が投げられず、ダミー文章等のフォールバックが発生しています！');
    }

    // =========================================================================
    // テスト4: ai_suggestionsテーブルのDB制約・列検証 (実DB保存値)
    // =========================================================================
    const sugRowRes = await client.query(
      'SELECT id, model_name, provider, confidence_score, payload FROM ai_suggestions WHERE id = $1',
      [result1.id],
    );
    if (sugRowRes.rowCount === 0) {
      throw new Error('ai_suggestions レコードがDBに存在しません');
    }
    const sugRow = sugRowRes.rows[0];
    if (sugRow.provider !== 'rule_engine') {
      throw new Error(`ai_suggestions.provider 列の値が 'rule_engine' ではありません: ${sugRow.provider}`);
    }
    if (sugRow.model_name !== 'contract-extractor-v1') {
      throw new Error(`ai_suggestions.model_name 列の値が 'contract-extractor-v1' ではありません: ${sugRow.model_name}`);
    }
    console.log('[E2E] ai_suggestions DB実保存値検証成功: provider=rule_engine, model_name=contract-extractor-v1');

    console.log('[E2E] 全ての実PDF E2Eテストに完全合格しました！');
  } finally {
    client.release();
    await pool.end();
    for (const f of tempFiles) {
      await unlink(f).catch(() => {});
    }
  }
}

run().catch((err) => {
  console.error('[E2E FATAL ERROR]:', err);
  process.exit(1);
});
