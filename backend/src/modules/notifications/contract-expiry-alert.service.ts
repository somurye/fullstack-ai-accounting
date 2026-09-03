import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../../database/database.service';

export interface ExpiryAlertBatchResult {
  processedTenants: number;
  createdNotifications: number;
  errors: Array<{ tenantId: string; error: string }>;
}

interface ExpiringContractRow {
  id: string;
  contract_no: string;
  title: string;
  end_date: string;
  auto_renewal: boolean;
  renewal_notice_days: number;
}

@Injectable()
export class ContractExpiryAlertService {
  private readonly logger = new Logger(ContractExpiryAlertService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * 1日1回（午前0時）定期実行される契約期限アラートバッチ。
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleScheduledCron(): Promise<void> {
    this.logger.log('Starting scheduled contract expiry alert batch...');
    try {
      const result = await this.runBatch();
      this.logger.log(
        `Scheduled batch finished: ${result.processedTenants} tenants processed, ${result.createdNotifications} notifications created, ${result.errors.length} errors.`,
      );
    } catch (err) {
      this.logger.error('Unexpected error in scheduled contract expiry alert batch', (err as Error).stack);
    }
  }

  /**
   * 全テナント横断バッチ実行本体。
   *
   * 【最重要設計原則: RLS非バイパス】
   * DB管理者権限による横断SELECT/UPDATE（BYPASSRLS）は一切行わない。
   * 1. テナントマスタ(tenants表、システム基準表)から有効なtenant_id一覧を取得。
   * 2. テナントごとにループし、各テナントのトランザクション内で
   *    `db.transaction(tenantId, null, callback)` を実行する。
   *    これにより `set_config('app.current_tenant_id', tenantId, true)` (SET LOCAL) が
   *    確実に設定され、RLSの完全な保護下で contracts を参照し notifications を作成する。
   *
   * 【障害隔離原則】
   * 1テナントの処理中にDB例外等が発生しても、他テナントの処理を巻き添えにしないよう
   * 各テナントの処理を独立した try-catch で保護する。
   */
  async runBatch(): Promise<ExpiryAlertBatchResult> {
    // 1. テナントマスタから有効なテナント一覧を取得
    const { rows: tenantRows } = await this.db.query<{ id: string }>(
      'SELECT id FROM tenants WHERE is_active = TRUE ORDER BY created_at ASC',
    );

    let createdNotificationsTotal = 0;
    const errors: Array<{ tenantId: string; error: string }> = [];

    for (const tenant of tenantRows) {
      try {
        const createdCount = await this.processTenant(tenant.id);
        createdNotificationsTotal += createdCount;
      } catch (err) {
        const errorMessage = (err as Error).message || String(err);
        this.logger.error(
          `Error processing expiry alerts for tenant ${tenant.id}: ${errorMessage}`,
          (err as Error).stack,
        );
        errors.push({
          tenantId: tenant.id,
          error: errorMessage,
        });
      }
    }

    return {
      processedTenants: tenantRows.length,
      createdNotifications: createdNotificationsTotal,
      errors,
    };
  }

  /**
   * 1テナント単位の契約期限アラート処理。
   * 必ず `db.transaction(tenantId, ...)` を経由して実行し、RLSを担保する。
   */
  async processTenant(tenantId: string): Promise<number> {
    return this.db.transaction(tenantId, null, async (client) => {
      // 1. 満了・更新予告期限に達している active 契約を抽出 (自テナントのみRLSで返却)
      const { rows: expiringContracts } = await client.query<ExpiringContractRow>(
        `SELECT
           id, contract_no, title, end_date::text, auto_renewal, renewal_notice_days
         FROM contracts
         WHERE tenant_id = $1
           AND status = 'active'
           AND end_date IS NOT NULL
           AND end_date <= (CURRENT_DATE + (COALESCE(renewal_notice_days, 30) || ' days')::interval)
           AND end_date >= CURRENT_DATE
         ORDER BY end_date ASC`,
        [tenantId],
      );

      let createdCount = 0;

      for (const contract of expiringContracts) {
        // 2. 未読通知の存在確認 (重複防止)
        const checkRes = await client.query<{ id: string }>(
          `SELECT id FROM notifications
           WHERE tenant_id = $1
             AND target_type = 'contract'
             AND target_id = $2
             AND type = 'contract_expiry'
             AND status = 'unread'`,
          [tenantId, contract.id],
        );

        if (checkRes.rowCount && checkRes.rowCount > 0) {
          // 既に未読通知が存在するため重複作成をスキップ
          continue;
        }

        // 3. auto_renewalの有無に応じた文面の生成
        const title = contract.auto_renewal
          ? `契約更新通知: ${contract.title}`
          : `契約満了通知: ${contract.title}`;

        const body = contract.auto_renewal
          ? `契約「${contract.title}」（契約番号: ${contract.contract_no}）は ${contract.end_date} に自動更新されます。`
          : `契約「${contract.title}」（契約番号: ${contract.contract_no}）は ${contract.end_date} に満了します。更新手続きが必要です。`;

        // 4. notifications テーブルへ INSERT (部分ユニークインデックスによる多層防御付き)
        const insertRes = await client.query(
          `INSERT INTO notifications (
             tenant_id, type, target_type, target_id, title, body, status
           ) VALUES (
             $1, 'contract_expiry', 'contract', $2, $3, $4, 'unread'
           )
           ON CONFLICT (tenant_id, target_type, target_id, type) WHERE status = 'unread'
           DO NOTHING`,
          [tenantId, contract.id, title, body],
        );

        if (insertRes.rowCount && insertRes.rowCount > 0) {
          createdCount++;
        }
      }

      return createdCount;
    });
  }
}
