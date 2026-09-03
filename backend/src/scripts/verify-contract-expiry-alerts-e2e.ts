import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { ContractExpiryAlertService } from '../modules/notifications/contract-expiry-alert.service';
import { NotFoundException } from '@nestjs/common';

async function run() {
  const dsn = process.argv[2] || process.env.DATABASE_URL;
  if (!dsn) {
    console.error('Usage: ts-node verify-contract-expiry-alerts-e2e.ts <dsn>');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dsn });
  const db = new DatabaseService();
  (db as any).pool = pool;

  const notificationsService = new NotificationsService(db);
  const expiryAlertService = new ContractExpiryAlertService(db);

  const client = await pool.connect();

  try {
    console.log('=== P1-T4 契約期限アラート・全テナント横断バッチ 実DB E2E検証 ===\n');

    // 1. テナント取得 (少なくとも2テナント)
    const tenantsRes = await client.query('SELECT id, name FROM tenants ORDER BY created_at ASC LIMIT 2');
    if (tenantsRes.rowCount! < 2) {
      throw new Error('E2Eテストには少なくとも2つのテナントが必要です');
    }
    const tenant1 = tenantsRes.rows[0].id;
    const tenant2 = tenantsRes.rows[1].id;

    // ユーザー取得 (存在しない場合は作成して紐付け)
    let user1: string;
    let user2: string;

    const u1Res = await client.query(
      'SELECT user_id FROM tenant_users WHERE tenant_id = $1 LIMIT 1',
      [tenant1],
    );
    if (u1Res.rowCount && u1Res.rowCount > 0) {
      user1 = u1Res.rows[0].user_id;
    } else {
      user1 = randomUUID();
      await client.query('INSERT INTO users (id, email, name) VALUES ($1, $2, $3)', [
        user1,
        'u1-exp@example.com',
        'User One',
      ]);
      await client.query('INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)', [
        tenant1,
        user1,
      ]);
    }

    const u2Res = await client.query(
      'SELECT user_id FROM tenant_users WHERE tenant_id = $1 LIMIT 1',
      [tenant2],
    );
    if (u2Res.rowCount && u2Res.rowCount > 0) {
      user2 = u2Res.rows[0].user_id;
    } else {
      user2 = randomUUID();
      await client.query('INSERT INTO users (id, email, name) VALUES ($1, $2, $3)', [
        user2,
        'u2-exp@example.com',
        'User Two',
      ]);
      await client.query('INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)', [
        tenant2,
        user2,
      ]);
    }

    console.log(`[Setup] Tenant 1: ${tenant1}`);
    console.log(`[Setup] Tenant 2: ${tenant2}\n`);

    // クリーンアップ
    await client.query('DELETE FROM notifications WHERE tenant_id IN ($1, $2)', [tenant1, tenant2]);
    await client.query(
      "DELETE FROM contracts WHERE tenant_id IN ($1, $2) AND contract_no LIKE 'EXP-%'",
      [tenant1, tenant2],
    );

    // 2. テスト用契約データの作成
    // 契約A (Tenant 1): active, 期限まで10日 (notice: 30日) -> 通知対象 (満了: auto_renewal=false)
    const contractAId = randomUUID();
    await client.query(
      `INSERT INTO contracts (
         id, tenant_id, contract_no, title, counterparty_name, contract_type,
         start_date, end_date, auto_renewal, renewal_notice_days, status, created_by
       ) VALUES (
         $1, $2, 'EXP-001-A', '事務機器リース契約', '富士通リース', 'lease',
         CURRENT_DATE - INTERVAL '355 days', CURRENT_DATE + INTERVAL '10 days', FALSE, 30, 'active', $3
       )`,
      [contractAId, tenant1, user1],
    );

    // 契約B (Tenant 1): active, 期限まで10日 (notice: 30日) -> 通知対象 (自動更新: auto_renewal=true)
    const contractBId = randomUUID();
    await client.query(
      `INSERT INTO contracts (
         id, tenant_id, contract_no, title, counterparty_name, contract_type,
         start_date, end_date, auto_renewal, renewal_notice_days, status, created_by
       ) VALUES (
         $1, $2, 'EXP-002-B', 'クラウドサーバー保守契約', 'AWSパートナー', 'service',
         CURRENT_DATE - INTERVAL '355 days', CURRENT_DATE + INTERVAL '10 days', TRUE, 30, 'active', $3
       )`,
      [contractBId, tenant1, user1],
    );

    // 契約C (Tenant 1): active, 期限まで45日 (notice: 30日) -> 通知対象外 (猶予あり)
    const contractCId = randomUUID();
    await client.query(
      `INSERT INTO contracts (
         id, tenant_id, contract_no, title, counterparty_name, contract_type,
         start_date, end_date, auto_renewal, renewal_notice_days, status, created_by
       ) VALUES (
         $1, $2, 'EXP-003-C', 'オフィス賃貸借契約', '三井不動産', 'lease',
         CURRENT_DATE - INTERVAL '320 days', CURRENT_DATE + INTERVAL '45 days', FALSE, 30, 'active', $3
       )`,
      [contractCId, tenant1, user1],
    );

    // 契約D (Tenant 1): draft, 期限まで10日 (notice: 30日) -> 通知対象外 (draft状態)
    const contractDId = randomUUID();
    await client.query(
      `INSERT INTO contracts (
         id, tenant_id, contract_no, title, counterparty_name, contract_type,
         start_date, end_date, auto_renewal, renewal_notice_days, status, created_by
       ) VALUES (
         $1, $2, 'EXP-004-D', '下書き契約書', 'テスト取引先', 'outsourcing',
         CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE + INTERVAL '10 days', FALSE, 30, 'draft', $3
       )`,
      [contractDId, tenant1, user1],
    );

    // 契約E (Tenant 2): active, 期限まで5日 (notice: 15日) -> Tenant 2の通知対象 (満了)
    const contractEId = randomUUID();
    await client.query(
      `INSERT INTO contracts (
         id, tenant_id, contract_no, title, counterparty_name, contract_type,
         start_date, end_date, auto_renewal, renewal_notice_days, status, created_by
       ) VALUES (
         $1, $2, 'EXP-005-E', '顧問税理士契約', '佐藤税務会計事務所', 'service',
         CURRENT_DATE - INTERVAL '360 days', CURRENT_DATE + INTERVAL '5 days', FALSE, 15, 'active', $3
       )`,
      [contractEId, tenant2, user2],
    );

    console.log('--- 1. バッチ初回実行 ---');
    const batchRes1 = await expiryAlertService.runBatch();
    console.log(
      `  [Batch 1] 処理テナント数: ${batchRes1.processedTenants}, 新規通知数: ${batchRes1.createdNotifications}, エラー: ${batchRes1.errors.length}`,
    );

    if (batchRes1.errors.length > 0) {
      throw new Error(`バッチ初回実行で予期せぬエラー: ${JSON.stringify(batchRes1.errors)}`);
    }

    // Tenant 1 の通知確認
    const notifsT1 = await notificationsService.list(tenant1, { limit: 10 });
    console.log(`  [Tenant 1] 通知件数: ${notifsT1.items.length}, 未読件数: ${notifsT1.unread_count}`);

    if (notifsT1.items.length !== 2) {
      throw new Error(`Tenant 1 の通知件数が不正です。期待値: 2, 実際: ${notifsT1.items.length}`);
    }

    const notifA = notifsT1.items.find((n) => n.target_id === contractAId);
    const notifB = notifsT1.items.find((n) => n.target_id === contractBId);

    if (!notifA || !notifB) {
      throw new Error('契約Aまたは契約Bの通知が見つかりません');
    }

    // 文面の検証 (満了 vs 自動更新)
    if (!notifA.title.startsWith('契約満了通知') || !notifA.body.includes('満了します。更新手続きが必要です')) {
      throw new Error(`契約A(満了)の通知文面が不正です: ${JSON.stringify(notifA)}`);
    }
    console.log('  [PASS] 契約A(auto_renewal=false): 「満了します。更新手続きが必要です」の通知を生成');

    if (!notifB.title.startsWith('契約更新通知') || !notifB.body.includes('自動更新されます')) {
      throw new Error(`契約B(自動更新)の通知文面が不正です: ${JSON.stringify(notifB)}`);
    }
    console.log('  [PASS] 契約B(auto_renewal=true): 「自動更新されます」の通知を生成');

    // 契約C(猶予あり)と契約D(draft)に通知が作られていないこと
    const notifC = notifsT1.items.find((n) => n.target_id === contractCId);
    const notifD = notifsT1.items.find((n) => n.target_id === contractDId);
    if (notifC || notifD) {
      throw new Error('対象外契約(CまたはD)に誤って通知が生成されています');
    }
    console.log('  [PASS] 猶予あり契約(C)およびdraft契約(D)には通知が生成されないことを確認');

    // Tenant 2 の通知確認
    const notifsT2 = await notificationsService.list(tenant2, { limit: 10 });
    console.log(`  [Tenant 2] 通知件数: ${notifsT2.items.length}, 未読件数: ${notifsT2.unread_count}`);
    if (notifsT2.items.length !== 1 || notifsT2.items[0].target_id !== contractEId) {
      throw new Error(`Tenant 2 の通知が不正です。期待値: 契約Eの1件, 実際: ${JSON.stringify(notifsT2.items)}`);
    }
    console.log('  [PASS] Tenant 2 に契約Eの満了通知が1件のみ生成されたことを確認');

    console.log('\n--- 2. バッチ2回目実行 (重複防止・冪等性検証) ---');
    const batchRes2 = await expiryAlertService.runBatch();
    console.log(
      `  [Batch 2] 処理テナント数: ${batchRes2.processedTenants}, 新規通知数: ${batchRes2.createdNotifications}`,
    );

    if (batchRes2.createdNotifications !== 0) {
      throw new Error(`バッチ再実行で重複通知が作成されました: ${batchRes2.createdNotifications}件`);
    }

    const notifsT1After = await notificationsService.list(tenant1, { limit: 10 });
    if (notifsT1After.items.length !== 2) {
      throw new Error(`再実行後に通知件数が増加しています: ${notifsT1After.items.length}`);
    }
    console.log('  [PASS] バッチ再実行時、未読通知が既に存在する契約への重複通知作成はスキップされた (0件新規)');

    console.log('\n--- 3. 通知の既読化 API & RLS分離の検証 ---');
    // Tenant 1 で notifA を既読化
    const updatedA = await notificationsService.markAsRead(tenant1, notifA.id);
    if (updatedA.status !== 'read' || !updatedA.read_at) {
      throw new Error(`既読化後のステータスが不正です: ${JSON.stringify(updatedA)}`);
    }
    console.log('  [PASS] notifA を既読化 (status="read", read_at設定完了)');

    // 未読件数が 1 件に減少したことを確認
    const notifsT1Unread = await notificationsService.list(tenant1, { status: 'unread' });
    if (notifsT1Unread.items.length !== 1 || notifsT1Unread.unread_count !== 1) {
      throw new Error(`既読化後の未読件数が不正です: ${JSON.stringify(notifsT1Unread)}`);
    }
    console.log('  [PASS] 未読件数が 2 -> 1 に減少したことを確認');

    // 他テナントの通知に対するアクセス遮断 (RLS隔離)
    // Tenant 1 のコンテキストから Tenant 2 の notifE を既読化しようとすると 404 (NotFoundException)
    const notifE = notifsT2.items[0];
    let crossTenantBlocked = false;
    try {
      await notificationsService.markAsRead(tenant1, notifE.id);
    } catch (err) {
      if (err instanceof NotFoundException) {
        crossTenantBlocked = true;
      }
    }
    if (!crossTenantBlocked) {
      throw new Error('Tenant 1 が Tenant 2 の通知を既読化できてしまいました (RLS違反)');
    }
    console.log('  [PASS] Tenant 1 による Tenant 2 通知の既読化は RLS により遮断された (NotFoundException)');

    // Tenant 1 から Tenant 2 の通知が一覧に見えないこと
    const allT1 = await notificationsService.list(tenant1, { limit: 50 });
    const leaked = allT1.items.some((n) => n.tenant_id === tenant2 || n.target_id === contractEId);
    if (leaked) {
      throw new Error('Tenant 1 の一覧に Tenant 2 の通知が漏洩しています (RLS違反)');
    }
    console.log('  [PASS] Tenant 1 の通知一覧に Tenant 2 の通知は一切含まれないことを確認 (RLS完全隔離)');

    console.log('\n--- 4. 障害隔離原則の検証 ---');
    // 存在しないテナントや不正なテナントを模倣して processTenant が失敗しても runBatch は停止しない
    const originalProcessTenant = expiryAlertService.processTenant.bind(expiryAlertService);
    let errorInjected = false;
    expiryAlertService.processTenant = async (tId: string) => {
      if (tId === tenant1 && !errorInjected) {
        errorInjected = true;
        throw new Error('Simulated network failure on Tenant 1');
      }
      return originalProcessTenant(tId);
    };

    const batchResFault = await expiryAlertService.runBatch();
    console.log(
      `  [Fault Test] 処理テナント数: ${batchResFault.processedTenants}, エラー数: ${batchResFault.errors.length}`,
    );

    if (batchResFault.errors.length === 0 || !batchResFault.errors.some((e) => e.tenantId === tenant1)) {
      throw new Error('Tenant 1 で意図的に発生させたエラーが捕捉されていません');
    }
    console.log('  [PASS] 1テナントでエラーが発生してもバッチ全体は中断せず、他テナントの処理を継続 (障害隔離達成)');

    console.log('\n======================================================');
    console.log('全 E2E シナリオ PASS: 契約期限アラート・全テナント横断バッチは正常に動作しています');
    console.log('======================================================');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('[E2E FAILED]:', err);
  process.exit(1);
});
