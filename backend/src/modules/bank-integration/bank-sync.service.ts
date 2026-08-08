import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { DatabaseService } from '../../database/database.service';
import { BankTransactionsService } from '../bank-transactions/bank-transactions.service';
import type { BankTransactionDto as MappedBankTransactionDto } from '../bank-transactions/bank-transactions.mapper';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { BANK_API_CLIENT } from './clients/bank-api-client.provider';
import type { IBankApiClient } from './clients/bank-api-client.interface';
import type { BankTransactionDto as ExternalBankTransactionDto } from './dto/bank-transaction.dto';
import type { BankIntegrationSyncInput } from './dto/bank-integration.schemas';

export interface BankSyncResult {
  synced_count: number;
  duplicate_skipped_count: number;
  auto_matched_count: number;
  transactions: MappedBankTransactionDto[];
}

const DEFAULT_LOOKBACK_DAYS = 30;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number, fromIso: string): string {
  const d = new Date(`${fromIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * BankSyncService
 * ================
 * `IBankApiClient`(現状は`MockBankApiClient`のみ)経由で取得した銀行明細
 * (`ExternalBankTransactionDto[]`)を`bank_transactions`テーブルへ同期する。
 *
 * 冪等性: `(tenant_id, external_transaction_id)`の部分一意インデックス
 * (`sql/002_bank_integration.sql`)へ`INSERT ... ON CONFLICT ... DO NOTHING`する
 * ことで、同じ明細を何度同期しても二重に取り込まれないことを保証する
 * (`bank-transactions.service.ts`の`importCsv`が`import_hash`で行っているのと
 * 同じ設計思想を、外部API由来の取引IDに対して適用したもの)。
 *
 * 消込エンジンとの連携: 新規に取り込んだ行1件ごとに、既存の
 * `BankTransactionsService.match()`(自動仕訳ルール評価 → 不適合ならAI提案生成、
 * かつCASによる二重消込防止込み)をそのまま呼び出す。消込ロジック自体を
 * 本サービスで再実装しない(既存のテスト済みコードパスを再利用する)。
 */
@Injectable()
export class BankSyncService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(BANK_API_CLIENT) private readonly bankApiClient: IBankApiClient,
    private readonly bankTransactionsService: BankTransactionsService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async sync(tenantId: string, userId: string, dto: BankIntegrationSyncInput): Promise<BankSyncResult> {
    const bankAccount = await this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<{ id: string; account_number: string }>(
        `SELECT id, account_number FROM bank_accounts WHERE tenant_id = $1 AND id = $2`,
        [tenantId, dto.bank_account_id],
      );
      return result.rows[0] ?? null;
    });
    if (!bankAccount) {
      throw AppException.notFound('指定された銀行口座が見つかりません');
    }

    const endDate = dto.end_date ?? todayIso();
    const startDate = dto.start_date ?? daysAgoIso(DEFAULT_LOOKBACK_DAYS, endDate);

    // 実銀行では clientId/clientSecret はテナントごとの連携設定(将来的に
    // `tenant_integration_settings`相当の暗号化ストレージへ保存する想定)から
    // 取得するが、モックプロバイダーでは値そのものは検証されないため、
    // 未設定環境でも動作するよう既定値を用意する。
    const clientId = process.env.BANK_API_CLIENT_ID ?? 'demo-client-id';
    const clientSecret = process.env.BANK_API_CLIENT_SECRET ?? 'demo-client-secret';
    const { accessToken } = await this.bankApiClient.authenticate({ clientId, clientSecret });

    const externalTransactions = await this.bankApiClient.fetchTransactions({
      accessToken,
      accountId: bankAccount.account_number,
      startDate,
      endDate,
    });

    let syncedCount = 0;
    let duplicateSkippedCount = 0;
    let autoMatchedCount = 0;
    const transactions: MappedBankTransactionDto[] = [];

    for (const externalTx of externalTransactions) {
      const insertedId = await this.insertIfNew(tenantId, userId, dto.bank_account_id, externalTx);
      if (!insertedId) {
        duplicateSkippedCount++;
        continue;
      }
      syncedCount++;

      const matched = await this.bankTransactionsService.match(tenantId, userId, insertedId, {});
      if (matched.match_status !== 'unmatched') {
        autoMatchedCount++;
      }
      transactions.push(matched);
    }

    await this.db.transaction(tenantId, userId, (client) =>
      this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'bank_integration.synced',
        targetType: 'bank_account',
        targetId: dto.bank_account_id,
        afterData: {
          start_date: startDate,
          end_date: endDate,
          synced_count: syncedCount,
          duplicate_skipped_count: duplicateSkippedCount,
          auto_matched_count: autoMatchedCount,
        },
      }),
    );

    return {
      synced_count: syncedCount,
      duplicate_skipped_count: duplicateSkippedCount,
      auto_matched_count: autoMatchedCount,
      transactions,
    };
  }

  /**
   * 明細1件を挿入する。`(tenant_id, external_transaction_id)`が既存の場合はDO NOTHINGで
   * 何もせず`null`を返す(呼び出し側で重複スキップとしてカウントする)。
   * `bank_transactions.import_hash`はNOT NULL制約があるため、CSV取込と同じ形式
   * (`sha256`)で外部取引IDから生成し、`(bank_account_id, import_hash)`側の
   * 一意制約もあわせて満たす。
   */
  private async insertIfNew(
    tenantId: string,
    userId: string,
    bankAccountId: string,
    externalTx: ExternalBankTransactionDto,
  ): Promise<string | null> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const importHash = createHash('sha256')
        .update(`api:${bankAccountId}:${externalTx.externalTransactionId}`)
        .digest('hex');

      // 摘要には`description`をそのまま用いる(振込人名義は各プロバイダーの`description`
      // 生成規約に委ねる。`payeeName`は自動仕訳ルールの名義マッチング等、摘要文字列とは
      // 別の構造化データとして使う用途のためのフィールドであり、ここで連結すると
      // プロバイダー側が既に名義を摘要に含めているケースで二重表記になる)。
      const description = externalTx.description || externalTx.payeeName;

      const result = await client.query<{ id: string }>(
        `INSERT INTO bank_transactions
           (tenant_id, bank_account_id, transaction_date, description, amount, balance_after,
            import_hash, external_transaction_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (tenant_id, external_transaction_id) WHERE external_transaction_id IS NOT NULL
           DO NOTHING
         RETURNING id`,
        [
          tenantId,
          bankAccountId,
          externalTx.transactionDate,
          description,
          externalTx.amount,
          externalTx.balance,
          importHash,
          externalTx.externalTransactionId,
        ],
      );
      return result.rows[0]?.id ?? null;
    });
  }
}
