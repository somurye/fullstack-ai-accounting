import { Injectable } from '@nestjs/common';
import type { BankTransactionDto } from '../dto/bank-transaction.dto';
import type { IBankApiClient } from './bank-api-client.interface';

const MOCK_ACCESS_TOKEN = 'mock_access_token_xyz';
const MOCK_BANK_CODE = '9999';
const MOCK_BRANCH_CODE = '001';

/** 既存の消込エンジン(自動仕訳ルール)で即座に自動消込テストが可能となる取引名義 */
const TEST_PAYEE_NAME = 'カブシキガイシャ テスト';

const DEPOSIT_PAYEE_FIXTURES = [TEST_PAYEE_NAME, 'ゴウドウガイシャ サンプル', 'カ)ミライトレーディング'];
const WITHDRAWAL_PAYEE_FIXTURES = ['外注先パートナー(株)', '不動産管理(株)', '関東電力(株)', 'オフィスサプライ(株)'];

/** `ai-suggestions/embedding.ts`と同じFNV-1aハッシュ手法による決定論的疑似乱数シード生成 */
function fnv1aHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32疑似乱数生成器(同一シードから毎回同一系列を返す。テスト再現性のため) */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function enumerateDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function pick<T>(arr: readonly T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)];
}

function round100(value: number): number {
  return Math.round(value / 100) * 100;
}

/**
 * MockBankApiClient
 * ==================
 * `BANK_PROVIDER=mock`(既定値)のときに`bank-api-client.provider.ts`から注入される
 * 開発・デモ用のダミー銀行APIクライアント。実際の外部通信は一切行わない。
 *
 * 同一の`accountId`/期間を指定すれば毎回同じ明細セットを返す(決定論的疑似乱数)ため、
 * デモや自動テストでの再現性を確保している。
 */
@Injectable()
export class MockBankApiClient implements IBankApiClient {
  async authenticate(credentials: {
    clientId: string;
    clientSecret: string;
  }): Promise<{ accessToken: string; expiresIn: number }> {
    // 実銀行のOAuth2フローを模倣する最小限の検証(空文字は拒否する)。
    // モックのため、値そのものの正当性は検証しない。
    if (!credentials.clientId?.trim() || !credentials.clientSecret?.trim()) {
      throw new Error('MockBankApiClient.authenticate: clientId/clientSecretを指定してください');
    }
    return { accessToken: MOCK_ACCESS_TOKEN, expiresIn: 3600 };
  }

  async fetchTransactions(params: {
    accessToken: string;
    accountId: string;
    startDate: string;
    endDate: string;
  }): Promise<BankTransactionDto[]> {
    if (!params.accessToken || !params.accessToken.startsWith('mock_access_token')) {
      throw new Error(
        'MockBankApiClient.fetchTransactions: 無効なアクセストークンです(authenticate()を先に呼び出してください)',
      );
    }

    const dates = enumerateDates(params.startDate, params.endDate);
    const rand = mulberry32(fnv1aHash(`${params.accountId}:${params.startDate}:${params.endDate}`));

    let runningBalance = round100(1_000_000 + rand() * 500_000);
    const transactions: BankTransactionDto[] = [];
    let seq = 0;

    for (const date of dates) {
      // 1日あたり約35%の確率で明細が発生する(月20〜30営業日でおおよそ数件〜十数件)。
      if (rand() > 0.35) continue;
      seq += 1;

      const isDeposit = rand() > 0.45;
      if (isDeposit) {
        const amount = round100(30_000 + rand() * 470_000);
        runningBalance += amount;
        const payeeName = pick(DEPOSIT_PAYEE_FIXTURES, rand);
        transactions.push({
          externalTransactionId: `MOCKTX-${params.accountId}-${date}-${seq}`,
          bankCode: MOCK_BANK_CODE,
          branchCode: MOCK_BRANCH_CODE,
          accountNumber: params.accountId,
          transactionDate: date,
          amount,
          type: 'DEPOSIT',
          payeeName,
          description: `振込入金 ${payeeName}`,
          balance: runningBalance,
        });
      } else {
        const amount = round100(10_000 + rand() * 190_000);
        runningBalance -= amount;
        const payeeName = pick(WITHDRAWAL_PAYEE_FIXTURES, rand);
        transactions.push({
          externalTransactionId: `MOCKTX-${params.accountId}-${date}-${seq}`,
          bankCode: MOCK_BANK_CODE,
          branchCode: MOCK_BRANCH_CODE,
          accountNumber: params.accountId,
          transactionDate: date,
          amount: -amount,
          type: 'WITHDRAWAL',
          payeeName,
          description: `振込出金 ${payeeName}`,
          balance: runningBalance,
        });
      }
    }

    // 消込エンジンの動作検証がすぐ行えるよう、テスト名義("カブシキガイシャ テスト")の
    // 入金取引が期間内に1件も無ければ最終日付で1件補完する。
    if (dates.length > 0 && !transactions.some((t) => t.payeeName === TEST_PAYEE_NAME)) {
      seq += 1;
      const amount = round100(100_000 + rand() * 200_000);
      runningBalance += amount;
      const lastDate = dates[dates.length - 1];
      transactions.push({
        externalTransactionId: `MOCKTX-${params.accountId}-${lastDate}-${seq}`,
        bankCode: MOCK_BANK_CODE,
        branchCode: MOCK_BRANCH_CODE,
        accountNumber: params.accountId,
        transactionDate: lastDate,
        amount,
        type: 'DEPOSIT',
        payeeName: TEST_PAYEE_NAME,
        description: `振込入金 ${TEST_PAYEE_NAME}`,
        balance: runningBalance,
      });
    }

    return transactions.sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));
  }
}
