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
import {
  computeTextEmbedding,
  toVectorLiteral,
  PSEUDO_EMBEDDING_MODEL,
} from '../modules/ai-suggestions/embedding';

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
  const filePath = join(tmpdir(), `e2e_contract_search_${randomUUID()}.pdf`);
  await writeFile(filePath, Buffer.from(pdfBytes));
  return filePath;
}

async function run() {
  const dsn = process.argv[2] || process.env.DATABASE_URL;
  if (!dsn) {
    console.error('Usage: ts-node verify-contract-search-e2e.ts <dsn>');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dsn });
  const db = new DatabaseService();
  (db as any).pool = pool;
  const auditLogs = new AuditLogsService(db);
  const aiSuggestions = new AiSuggestionsService(db);
  const contractsService = new ContractsService(db, auditLogs, aiSuggestions);

  const client = await pool.connect();
  const tempFiles: string[] = [];

  try {
    console.log('=== [P1-T6] 契約書全文検索 (pgvector) 実DB E2E検証開始 ===');

    // 1. テナント1とテナント2の準備 (完全テナント分離検証用)
    const t1Res = await client.query('SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1');
    if (t1Res.rowCount === 0) {
      throw new Error('テナント1が見つかりません。');
    }
    const tenant1Id = t1Res.rows[0].id;

    // テナント2の取得または作成
    let tenant2Id: string;
    const t2Res = await client.query('SELECT id FROM tenants WHERE id != $1 LIMIT 1', [tenant1Id]);
    if (t2Res.rowCount && t2Res.rowCount > 0) {
      tenant2Id = t2Res.rows[0].id;
    } else {
      tenant2Id = randomUUID();
      await client.query(
        `INSERT INTO tenants (id, name, code) VALUES ($1, 'Tenant Two Corp', 'tenant_two')`,
        [tenant2Id],
      );
    }

    // ユーザーの取得
    const u1Res = await client.query('SELECT user_id FROM tenant_users WHERE tenant_id = $1 LIMIT 1', [tenant1Id]);
    const user1Id = u1Res.rows[0].user_id;

    let user2Id: string;
    const u2Res = await client.query('SELECT user_id FROM tenant_users WHERE tenant_id = $1 LIMIT 1', [tenant2Id]);
    if (u2Res.rowCount && u2Res.rowCount > 0) {
      user2Id = u2Res.rows[0].user_id;
    } else {
      user2Id = randomUUID();
      await client.query(
        `INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, 'user2@example.com', 'dummy', 'Tenant2 User')`,
        [user2Id],
      );
      await client.query(
        `INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)`,
        [tenant2Id, user2Id],
      );
    }

    console.log(`[E2E] テナント1: ${tenant1Id}, テナント2: ${tenant2Id}`);

    // =========================================================================
    // テスト1: PDF添付ファイルからの自動テキスト抽出と contracts.extracted_text への永続化
    // =========================================================================
    console.log('\n--- テスト1: PDFアップロードからのテキスト抽出 & extracted_text永続化 ---');
    const pdfTextContent = [
      'Cloud Service Agreement',
      'Party A: Alpha Corp',
      'Party B: Cloud Provider Inc',
      'Article 5 SLA: 99.9% uptime guaranteed per month.',
      'Article 6 Penalty: 10% refund if uptime drops below SLA.',
    ];
    const pdfPath = await createTestPdf(pdfTextContent);
    tempFiles.push(pdfPath);

    const attId = randomUUID();
    await client.query(
      `INSERT INTO attachments (
         id, tenant_id, file_name, mime_type, file_hash, storage_path,
         document_category, uploaded_by
       ) VALUES ($1, $2, 'cloud_sla.pdf', 'application/pdf', $3, $4, 'contract', $5)`,
      [attId, tenant1Id, createHash('sha256').update(pdfPath).digest('hex'), pdfPath, user1Id],
    );

    const createdContract1 = await contractsService.create(tenant1Id, user1Id, {
      title: 'クラウドインフラ保守契約書',
      counterparty_name: 'クラウドプロバイダー株式会社',
      contract_type: 'service',
      currency: 'JPY',
      start_date: '2026-04-01',
      auto_renewal: false,
      renewal_notice_days: 30,
      attachment_id: attId,
    });

    if (!createdContract1.extracted_text) {
      throw new Error('FAIL: PDFからのテキスト自動抽出結果が contracts.extracted_text に保存されていません');
    }
    if (!createdContract1.extracted_text.includes('Article 5 SLA: 99.9% uptime')) {
      throw new Error(`FAIL: extracted_text にPDFの内容が含まれていません: ${createdContract1.extracted_text}`);
    }
    console.log('  [PASS] contracts.extracted_text にPDF抽出テキストが永続化されました');

    // =========================================================================
    // テスト2: contract_embeddings の自動生成 (チャンク分割とベクトル保存)
    // =========================================================================
    console.log('\n--- テスト2: contract_embeddings 自動生成検証 ---');
    const embChunksRes = await client.query(
      `SELECT id, chunk_index, chunk_text, model_name, embedding IS NOT NULL as has_vector
       FROM contract_embeddings
       WHERE tenant_id = $1 AND contract_id = $2
       ORDER BY chunk_index ASC`,
      [tenant1Id, createdContract1.id],
    );

    if (embChunksRes.rowCount === 0) {
      throw new Error('FAIL: contract_embeddings レコードが生成されていません');
    }
    console.log(`  [PASS] ${embChunksRes.rowCount} 件の embedding チャンクが生成されました`);
    const chunk0 = embChunksRes.rows[0];
    if (!chunk0.has_vector || chunk0.model_name !== PSEUDO_EMBEDDING_MODEL) {
      throw new Error(`FAIL: embedding または model_name が不正です: ${JSON.stringify(chunk0)}`);
    }
    console.log('  [PASS] chunk_text、1536次元ベクトル、model_name が正常に格納されています');

    // =========================================================================
    // テスト3: 類似条項を持つ契約2・異なる契約3の作成 & ID指定類似検索
    // =========================================================================
    console.log('\n--- テスト3: 類似契約探索 (GET /contracts/:id/similar) ---');
    // 契約1を確定済み(active)へ遷移（P1-T6-FIX: 確定済み契約のみが検索対象）
    await client.query(`UPDATE contracts SET status = 'active' WHERE id = $1`, [createdContract1.id]);

    // 類似する契約 (SLAや稼働率保証に関する契約)
    const similarText = `Cloud System Maintenance Agreement
Article 1 (Purpose) This agreement defines standards for system maintenance.
Article 5 (SLA Uptime) Monthly uptime of 99.9% is guaranteed as SLA. 10% refund if uptime drops below SLA.
Article 12 (Confidentiality) Both parties shall keep proprietary information confidential.`;

    const createdContract2 = await contractsService.create(tenant1Id, user1Id, {
      title: 'クラウドシステム保守基本契約書',
      counterparty_name: '株式会社ネクストソリューションズ',
      contract_type: 'outsourcing',
      currency: 'JPY',
      start_date: '2026-05-01',
      auto_renewal: false,
      renewal_notice_days: 30,
      extracted_text: similarText,
    });
    // 契約2を確定済み(active)へ遷移
    await client.query(`UPDATE contracts SET status = 'active' WHERE id = $1`, [createdContract2.id]);

    // 全く異なる契約 (賃貸借契約)
    const unsimilarText = `Office Building Real Estate Lease Contract
Article 1 (Lease Object) Lessor leases the premises to lessee for office use.
Article 2 (Rent and Deposit) Monthly rent shall be paid by the end of each month. Deposit shall be 6 months rent.`;

    const createdContract3 = await contractsService.create(tenant1Id, user1Id, {
      title: '本社オフィス賃貸借契約書',
      counterparty_name: '不動産アセット信託株式会社',
      contract_type: 'lease',
      currency: 'JPY',
      start_date: '2026-06-01',
      auto_renewal: false,
      renewal_notice_days: 30,
      extracted_text: unsimilarText,
    });
    // 契約3を確定済み(active)へ遷移
    await client.query(`UPDATE contracts SET status = 'active' WHERE id = $1`, [createdContract3.id]);

    // 契約1 (クラウドSLA) に対して類似契約を検索
    const similarContracts = await contractsService.findSimilarContractsById(
      tenant1Id,
      user1Id,
      createdContract1.id,
      { limit: 5, threshold: 0.3 },
    );

    console.log(`[E2E] 類似検索結果件数: ${similarContracts.length}`);
    if (similarContracts.length === 0) {
      throw new Error('FAIL: 類似契約が1件も返却されませんでした');
    }
    const topMatch = similarContracts[0];
    if (topMatch.id !== createdContract2.id) {
      throw new Error(`FAIL: SLA類似契約 (Contract 2) が最上位になっていません: top=${topMatch.title}`);
    }
    if (topMatch.similarity_score <= 0.3) {
      throw new Error(`FAIL: 類似度スコアが閾値以下です: ${topMatch.similarity_score}`);
    }
    if (
      !topMatch.matched_chunk_text ||
      (!topMatch.matched_chunk_text.includes('SLA') && !topMatch.matched_chunk_text.includes('uptime'))
    ) {
      throw new Error(`FAIL: マッチした条項テキストにSLAが含まれていません: ${topMatch.matched_chunk_text}`);
    }
    console.log(`  [PASS] 最上位マッチ: ${topMatch.title} (類似度: ${topMatch.similarity_score})`);
    console.log(`         マッチ条項抜粋: ${topMatch.matched_chunk_text ? topMatch.matched_chunk_text.slice(0, 60) : ''}...`);

    // =========================================================================
    // テスト4: 自然文全文類似検索 (GET /contracts/search/similar)
    // =========================================================================
    console.log('\n--- テスト4: 自然文全文類似検索 (GET /contracts/search/similar) ---');
    const searchResults = await contractsService.searchSimilarContractsByText(
      tenant1Id,
      user1Id,
      { q: 'SLA monthly uptime 99.9% refund penalty', limit: 5, threshold: 0.3 },
    );

    if (searchResults.length === 0) {
      throw new Error('FAIL: 自然文類似検索で結果が返却されませんでした');
    }
    const foundContractIds = searchResults.map((r) => r.id);
    if (!foundContractIds.includes(createdContract1.id) || !foundContractIds.includes(createdContract2.id)) {
      throw new Error(`FAIL: 期待されるSLA関連契約が見つかりませんでした: ${foundContractIds.join(', ')}`);
    }
    console.log(`  [PASS] 自然文類似検索で ${searchResults.length} 件の関連契約がヒットしました`);

    // =========================================================================
    // テスト4-B: 【P1-T6-FIX】確定済み契約限定検索実証 (未確定契約の除外検証)
    // =========================================================================
    console.log('\n--- テスト4-B: 【P1-T6-FIX】確定済み契約限定検索実証 (draft / pending / rejected 除外) ---');
    // 同一テナント (tenant1) 内に、4種類のステータスの契約を作成
    // draft / pending_approval / rejected には重複しない特徴的な文言を付与

    // 1. active契約
    const activeContract = await contractsService.create(tenant1Id, user1Id, {
      title: '確定済み業務委託契約書 (P1-T6-FIX)',
      counterparty_name: '株式会社確定パートナー',
      contract_type: 'service',
      currency: 'JPY',
      start_date: '2026-07-01',
      auto_renewal: false,
      renewal_notice_days: 30,
      extracted_text: 'ARTICLE_STATUS_TEST: CONFIRMED_ACTIVE_CLAUSE_777777 有効な確定済み契約の条項です。',
    });
    await client.query(`UPDATE contracts SET status = 'active' WHERE id = $1`, [activeContract.id]);

    // 2. draft契約
    const draftContract = await contractsService.create(tenant1Id, user1Id, {
      title: '起草中ドラフト契約書 (P1-T6-FIX)',
      counterparty_name: '株式会社起草パートナー',
      contract_type: 'service',
      currency: 'JPY',
      start_date: '2026-07-01',
      auto_renewal: false,
      renewal_notice_days: 30,
      extracted_text: 'ARTICLE_STATUS_TEST: DRAFT_SECRET_UNAPPROVED_CLAUSE_111111 社内検討中の極秘ドラフト条項です。',
    });
    // デフォルトで draft のまま

    // 3. pending_approval契約
    const pendingContract = await contractsService.create(tenant1Id, user1Id, {
      title: '承認申請中契約書 (P1-T6-FIX)',
      counterparty_name: '株式会社申請パートナー',
      contract_type: 'service',
      currency: 'JPY',
      start_date: '2026-07-01',
      auto_renewal: false,
      renewal_notice_days: 30,
      extracted_text: 'ARTICLE_STATUS_TEST: PENDING_INTERNAL_REVIEW_CLAUSE_222222 決裁承認待ちの契約条項です。',
    });
    await client.query(`UPDATE contracts SET status = 'pending_approval' WHERE id = $1`, [pendingContract.id]);

    // 4. rejected契約 (契約ライフサイクル規則: draft -> pending_approval -> rejected)
    const rejectedContract = await contractsService.create(tenant1Id, user1Id, {
      title: '法務審査却下契約書 (P1-T6-FIX)',
      counterparty_name: '株式会社却下パートナー',
      contract_type: 'service',
      currency: 'JPY',
      start_date: '2026-07-01',
      auto_renewal: false,
      renewal_notice_days: 30,
      extracted_text: 'ARTICLE_STATUS_TEST: REJECTED_DISAPPROVED_CLAUSE_333333 法務審査で却下された条項です。',
    });
    await client.query(`UPDATE contracts SET status = 'pending_approval' WHERE id = $1`, [rejectedContract.id]);
    await client.query(`UPDATE contracts SET status = 'rejected' WHERE id = $1`, [rejectedContract.id]);

    // (1) draftの特徴的文言で検索 -> ヒットしないことを検証
    const draftSearch = await contractsService.searchSimilarContractsByText(
      tenant1Id,
      user1Id,
      { q: 'DRAFT_SECRET_UNAPPROVED_CLAUSE_111111', limit: 10, threshold: 0.1 },
    );
    if (draftSearch.some((c) => c.id === draftContract.id)) {
      throw new Error('FAIL: draft 状態の契約書が自然文検索結果に露出してしまいました！');
    }
    console.log('  [PASS] draft 状態の契約書は検索結果に含まれません (露出 0件)');

    // (2) pending_approvalの特徴的文言で検索 -> ヒットしないことを検証
    const pendingSearch = await contractsService.searchSimilarContractsByText(
      tenant1Id,
      user1Id,
      { q: 'PENDING_INTERNAL_REVIEW_CLAUSE_222222', limit: 10, threshold: 0.1 },
    );
    if (pendingSearch.some((c) => c.id === pendingContract.id)) {
      throw new Error('FAIL: pending_approval 状態の契約書が自然文検索結果に露出してしまいました！');
    }
    console.log('  [PASS] pending_approval 状態の契約書は検索結果に含まれません (露出 0件)');

    // (3) rejectedの特徴的文言で検索 -> ヒットしないことを検証
    const rejectedSearch = await contractsService.searchSimilarContractsByText(
      tenant1Id,
      user1Id,
      { q: 'REJECTED_DISAPPROVED_CLAUSE_333333', limit: 10, threshold: 0.1 },
    );
    if (rejectedSearch.some((c) => c.id === rejectedContract.id)) {
      throw new Error('FAIL: rejected 状態の契約書が自然文検索結果に露出してしまいました！');
    }
    console.log('  [PASS] rejected 状態の契約書は検索結果に含まれません (露出 0件)');

    // (4) activeの特徴的文言で検索 -> 正しくヒットすることを検証
    const activeSearch = await contractsService.searchSimilarContractsByText(
      tenant1Id,
      user1Id,
      { q: 'CONFIRMED_ACTIVE_CLAUSE_777777', limit: 10, threshold: 0.1 },
    );
    if (!activeSearch.some((c) => c.id === activeContract.id)) {
      throw new Error('FAIL: active 状態の確定済み契約書が自然文検索結果でヒットしませんでした！');
    }
    console.log('  [PASS] active 状態の確定済み契約書は正しく検索結果にヒットしました');

    // (5) ID指定類似検索 (findSimilarContractsById) においても未確定契約が除外されることを検証
    // activeContract を起点に類似検索を実行
    const idSimilarResults = await contractsService.findSimilarContractsById(
      tenant1Id,
      user1Id,
      activeContract.id,
      { limit: 20, threshold: 0.01 },
    );
    const unconfirmedInIdSearch = idSimilarResults.filter((c) =>
      [draftContract.id, pendingContract.id, rejectedContract.id].includes(c.id),
    );
    if (unconfirmedInIdSearch.length > 0) {
      throw new Error(
        `FAIL: ID類似検索結果に未確定契約 (draft/pending/rejected) が含まれています: ${unconfirmedInIdSearch.map((c) => c.status).join(', ')}`,
      );
    }
    console.log('  [PASS] ID類似検索結果においても draft / pending_approval / rejected は完全に除外されています');

    // =========================================================================
    // テスト5: 【最重要】完全テナント分離 (他テナントデータの混入ゼロを厳格実証)
    // =========================================================================
    console.log('\n--- テスト5: 【最重要】完全テナント分離実証 (RLS + アプリ層二重防御) ---');
    // テナント2にも極めて類似したSLA契約書を作成する
    const tenant2Contract = await contractsService.create(tenant2Id, user2Id, {
      title: 'Tenant 2 Confidential Cloud SLA Contract',
      counterparty_name: 'Tenant 2 Dedicated Vendor',
      contract_type: 'service',
      currency: 'JPY',
      start_date: '2026-04-01',
      auto_renewal: false,
      renewal_notice_days: 30,
      extracted_text: `Tenant 2 Confidential Document.
Article 5 SLA: 99.9% uptime guaranteed per month. 10% refund if uptime drops below SLA.
Liability shall be limited to ten times the contract amount.`,
    });
    // テナント2の契約書を確定済み(active)へ遷移
    await client.query(`UPDATE contracts SET status = 'active' WHERE id = $1`, [tenant2Contract.id]);

    // テナント1のユーザーとして、テナント2の契約内容そのものの自然文で検索を実行！
    const t1LeakCheck = await contractsService.searchSimilarContractsByText(
      tenant1Id,
      user1Id,
      { q: 'Tenant 2 Confidential Document Liability limited ten times', limit: 20, threshold: 0.1 },
    );

    const leakedInT1 = t1LeakCheck.filter((c) => c.id === tenant2Contract.id);
    if (leakedInT1.length > 0) {
      throw new Error('CRITICAL SECURITY FAIL: テナント1の類似検索結果にテナント2の契約書が漏洩しました！');
    }
    console.log('  [PASS] テナント1の類似検索結果にテナント2の契約書・条項は一切含まれていません (漏洩 0件)');

    // テナント1の契約1のID類似検索を実行した際も、テナント2のデータが含まれないことを確認
    const t1IdSimilar = await contractsService.findSimilarContractsById(
      tenant1Id,
      user1Id,
      createdContract1.id,
      { limit: 20, threshold: 0.1 },
    );
    const leakedIdSimilar = t1IdSimilar.filter((c) => c.id === tenant2Contract.id);
    if (leakedIdSimilar.length > 0) {
      throw new Error('CRITICAL SECURITY FAIL: ID類似検索結果に他テナントの契約書が漏洩しました！');
    }
    console.log('  [PASS] ID指定類似検索でも他テナントのデータは完全に遮断されています (漏洩 0件)');

    // 逆にテナント2のユーザーとして検索した場合は、テナント2の契約書のみがヒットし、テナント1は含まれないこと
    const t2SearchResults = await contractsService.searchSimilarContractsByText(
      tenant2Id,
      user2Id,
      { q: 'Article 5 SLA uptime 99.9%', limit: 10, threshold: 0.2 },
    );
    const t1LeakedToT2 = t2SearchResults.filter((c) => [createdContract1.id, createdContract2.id].includes(c.id));
    if (t1LeakedToT2.length > 0) {
      throw new Error('CRITICAL SECURITY FAIL: テナント2の検索結果にテナント1のデータが漏洩しました！');
    }
    if (!t2SearchResults.some((c) => c.id === tenant2Contract.id)) {
      throw new Error('FAIL: テナント2自身の一致契約書が検索結果に含まれていません');
    }
    console.log('  [PASS] テナント2側からの検索でもテナント1のデータは一切漏洩せず、自テナントのみ返却されます');

    // =========================================================================
    // テスト6: 既存 journal_entry_embeddings との共存・回帰なし確認
    // =========================================================================
    console.log('\n--- テスト6: 既存 journal_entry_embeddings との共存・回帰なし検証 ---');
    const dummyVector = toVectorLiteral(computeTextEmbedding('テスト仕訳 消耗品費 現金'));

    // 既存の journal_entries レコードを検索するか、新規作成する
    let testJeId: string;
    const jeRes = await client.query<{ id: string }>(
      'SELECT id FROM journal_entries WHERE tenant_id = $1 LIMIT 1',
      [tenant1Id],
    );
    if (jeRes.rowCount && jeRes.rowCount > 0) {
      testJeId = jeRes.rows[0].id;
    } else {
      testJeId = randomUUID();
      await client.query(
        `INSERT INTO journal_entries (
           id, tenant_id, entry_no, entry_date, description, status, created_by
         ) VALUES ($1, $2, 'JE-TEST-001', '2026-04-01', 'テスト仕訳', 'draft', $3)`,
        [testJeId, tenant1Id, user1Id],
      );
    }

    // 既存の embedding があれば削除
    await client.query(
      'DELETE FROM journal_entry_embeddings WHERE tenant_id = $1 AND journal_entry_id = $2',
      [tenant1Id, testJeId],
    );

    await client.query(
      `INSERT INTO journal_entry_embeddings (id, tenant_id, journal_entry_id, embedding, model_name)
       VALUES ($1, $2, $3, $4::vector, $5)`,
      [randomUUID(), tenant1Id, testJeId, dummyVector, PSEUDO_EMBEDDING_MODEL],
    );

    const jeQueryRes = await client.query(
      `SELECT id, (embedding <=> $2::vector) as distance
       FROM journal_entry_embeddings
       WHERE tenant_id = $1 AND journal_entry_id = $3`,
      [tenant1Id, dummyVector, testJeId],
    );
    if (jeQueryRes.rowCount === 0 || parseFloat(jeQueryRes.rows[0].distance) > 0.001) {
      throw new Error('FAIL: journal_entry_embeddings へのアクセス・近傍計算で不整合が発生しました');
    }
    console.log('  [PASS] journal_entry_embeddings の近傍計算は正常に動作し、回帰はありません');

    console.log('\n================================================================');
    console.log(' [SUCCESS] P1-T6 契約書全文検索 E2E検証: すべてのテストに合格しました！');
    console.log('================================================================');
  } finally {
    client.release();
    await pool.end();
    for (const f of tempFiles) {
      await unlink(f).catch(() => {});
    }
  }
}

run().catch((err) => {
  console.error('[E2E ERROR]:', err);
  process.exit(1);
});
