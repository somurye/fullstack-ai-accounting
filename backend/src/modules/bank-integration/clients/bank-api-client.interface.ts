import type { BankTransactionDto } from '../dto/bank-transaction.dto';

/**
 * bank-api-client.interface.ts
 * =============================
 * 銀行API/アグリゲーションAPIの共通アダプター・インターフェース。
 *
 * 実銀行(GMOあおぞらネット銀行API、Moneytree LINK等)への接続を追加する場合は、
 * このインターフェースを実装する新しいクラスを`clients/`配下に追加し、
 * `bank-api-client.provider.ts`のファクトリへ分岐を1つ増やすだけでよい。
 * `BankSyncService`はこのインターフェースにのみ依存しており、具象クラスへの
 * 依存を一切持たない(Dependency Inversion)。
 */
export interface IBankApiClient {
  /** OAuth2認証 / トークン取得・更新 */
  authenticate(credentials: {
    clientId: string;
    clientSecret: string;
  }): Promise<{ accessToken: string; expiresIn: number }>;

  /** 指定口座の入出金明細取得 */
  fetchTransactions(params: {
    accessToken: string;
    accountId: string;
    startDate: string; // YYYY-MM-DD
    endDate: string; // YYYY-MM-DD
  }): Promise<BankTransactionDto[]>;
}
