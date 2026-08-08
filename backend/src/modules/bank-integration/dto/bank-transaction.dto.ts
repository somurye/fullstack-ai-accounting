/**
 * bank-transaction.dto.ts
 * ========================
 * 銀行API/アグリゲーションAPI(GMOあおぞらネット銀行API、Moneytree LINK、
 * 全銀EDI等)ごとに異なるレスポンス形式を、会計コア側(`BankSyncService`)が
 * 単一のフォーマットで処理できるよう抽象化した共通DTO。
 *
 * `IBankApiClient`を実装する各プロバイダー(`MockBankApiClient`等)は、
 * 実際のAPIレスポンスをこの形へマッピングしてから返す責務を持つ。
 * `bank-transactions`モジュールの`BankTransactionDto`(DBの`bank_transactions`行を
 * APIレスポンス形式へマッピングした型)とは別物であるため、同一ファイル内で
 * 両方を扱う場合は名前衝突に注意してインポート時にエイリアスすること。
 */
export interface BankTransactionDto {
  /** 銀行側の取引ユニークID。冪等性キー(`bank_transactions.external_transaction_id`)として使用する */
  externalTransactionId: string;
  /** 金融機関コード (例: "9999") */
  bankCode: string;
  /** 店番号 (例: "001") */
  branchCode: string;
  /** 口座番号 */
  accountNumber: string;
  /** 取引日 (YYYY-MM-DD) */
  transactionDate: string;
  /** 金額 (入金: 正の数, 出金: 負の数) */
  amount: number;
  /** 入金 / 出金 */
  type: 'DEPOSIT' | 'WITHDRAWAL';
  /** 振込人・請求先名義 (全角カナ/漢字) */
  payeeName: string;
  /** 摘要・取引内容 */
  description: string;
  /** 取引後残高 */
  balance: number;
}
