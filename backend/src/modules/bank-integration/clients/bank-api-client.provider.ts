import type { Provider } from '@nestjs/common';
import type { IBankApiClient } from './bank-api-client.interface';
import { MockBankApiClient } from './mock-bank-api-client';

/** `BankSyncService`が`@Inject(BANK_API_CLIENT)`で参照するDIトークン */
export const BANK_API_CLIENT = 'BANK_API_CLIENT';

/**
 * bank-api-client.provider.ts
 * ============================
 * `BANK_PROVIDER`環境変数(既定値: `mock`)で実際に注入する`IBankApiClient`実装を
 * 切り替えるファクトリプロバイダー。将来、実銀行API(GMOあおぞらネット銀行API、
 * Moneytree LINK、全銀EDI等)を追加する場合は、`IBankApiClient`を実装した新しい
 * クラスを`clients/`配下へ追加し、下記switch文へ分岐を1つ増やすだけでよい。
 * `BankSyncService`側の実装変更は一切不要(アダプターパターン)。
 */
export const bankApiClientProvider: Provider = {
  provide: BANK_API_CLIENT,
  useFactory: (mockClient: MockBankApiClient): IBankApiClient => {
    const provider = process.env.BANK_PROVIDER ?? 'mock';
    switch (provider) {
      case 'mock':
        return mockClient;
      default:
        throw new Error(
          `未対応のBANK_PROVIDERが指定されています: "${provider}"(現時点では "mock" のみ対応)`,
        );
    }
  },
  inject: [MockBankApiClient],
};
