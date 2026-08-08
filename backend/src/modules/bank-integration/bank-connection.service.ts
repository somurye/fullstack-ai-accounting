import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { BANK_API_CLIENT } from './clients/bank-api-client.provider';
import type { IBankApiClient } from './clients/bank-api-client.interface';

export interface BankConnectionStatus {
  is_linked: boolean;
  provider: string | null;
  linked_at: string | null;
}

interface BankConnectionStatusRow {
  bank_connector_status: string;
  bank_connector_provider: string | null;
  bank_connector_linked_at: string | null;
}

const BANK_CONNECTION_STATUS_COLUMNS = `
  bank_connector_status,
  bank_connector_provider,
  bank_connector_linked_at
`;

function mapBankConnectionStatusRow(row: BankConnectionStatusRow): BankConnectionStatus {
  return {
    is_linked: row.bank_connector_status === 'connected',
    provider: row.bank_connector_provider,
    linked_at: row.bank_connector_linked_at,
  };
}

/**
 * BankConnectionService
 * ======================
 * 設定画面「銀行・外部決済コネクタ」カードが表示するテナント単位のOAuth連携状態
 * (`tenant_integration_settings.bank_connector_status`、`BankSyncService`が同期を
 * 実行する際の前提となる連携有無)を管理する。連携有無自体は`SettingsService`が
 * 既に読み書きしている同じテーブル・カラムをそのまま共有し(1テナント1行のため
 * `ON CONFLICT (tenant_id) DO UPDATE`で冪等に扱える)、二重管理を避ける。
 */
@Injectable()
export class BankConnectionService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(BANK_API_CLIENT) private readonly bankApiClient: IBankApiClient,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async getStatus(tenantId: string, userId: string | null): Promise<BankConnectionStatus> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<BankConnectionStatusRow>(
        `SELECT ${BANK_CONNECTION_STATUS_COLUMNS} FROM tenant_integration_settings WHERE tenant_id = $1`,
        [tenantId],
      );
      if (result.rowCount === 0) {
        return { is_linked: false, provider: null, linked_at: null };
      }
      return mapBankConnectionStatusRow(result.rows[0]);
    });
  }

  /**
   * OAuth認可を模したモック認証を行い、成功したらテナントの連携状態を「連携済み」へ更新する。
   * `BankSyncService.sync()`と同じく、認証自体はDBトランザクションの外で行う(外部APIへの
   * 呼び出しをトランザクション内に含めない、という既存の設計方針を踏襲)。
   */
  async connect(tenantId: string, userId: string): Promise<BankConnectionStatus> {
    const clientId = process.env.BANK_API_CLIENT_ID ?? 'demo-client-id';
    const clientSecret = process.env.BANK_API_CLIENT_SECRET ?? 'demo-client-secret';
    await this.bankApiClient.authenticate({ clientId, clientSecret });

    const provider = process.env.BANK_PROVIDER ?? 'mock';

    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<BankConnectionStatusRow>(
        `INSERT INTO tenant_integration_settings
           (tenant_id, bank_connector_status, bank_connector_provider, bank_connector_linked_at)
         VALUES ($1, 'connected', $2, now())
         ON CONFLICT (tenant_id) DO UPDATE SET
           bank_connector_status = 'connected',
           bank_connector_provider = $2,
           bank_connector_linked_at = now()
         RETURNING ${BANK_CONNECTION_STATUS_COLUMNS}`,
        [tenantId, provider],
      );
      const row = result.rows[0];

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'bank_integration.connected',
        targetType: 'tenant',
        targetId: tenantId,
        afterData: { provider },
      });

      return mapBankConnectionStatusRow(row);
    });
  }

  async disconnect(tenantId: string, userId: string): Promise<BankConnectionStatus> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<BankConnectionStatusRow>(
        `INSERT INTO tenant_integration_settings
           (tenant_id, bank_connector_status, bank_connector_provider, bank_connector_linked_at)
         VALUES ($1, 'not_connected', NULL, NULL)
         ON CONFLICT (tenant_id) DO UPDATE SET
           bank_connector_status = 'not_connected',
           bank_connector_provider = NULL,
           bank_connector_linked_at = NULL
         RETURNING ${BANK_CONNECTION_STATUS_COLUMNS}`,
        [tenantId],
      );
      const row = result.rows[0];

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'bank_integration.disconnected',
        targetType: 'tenant',
        targetId: tenantId,
      });

      return mapBankConnectionStatusRow(row);
    });
  }
}
