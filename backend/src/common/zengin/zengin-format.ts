import { createHash } from 'crypto';

/**
 * zengin-format.ts
 * =================
 * 全銀協標準フォーマット(総合振込・120バイト固定長)のテキストデータを生成する。
 *
 * レコード構成: ヘッダー(1) → データ(明細ごと, 種別コード"2") → トレーラー(8) → エンド(9)。
 * 各レコードは必ず120バイト(半角文字換算)になるよう固定長でパディングする。
 *
 * 実運用の全銀協仕様は契約金融機関ごとに微妙な差異があり、かつ委託者コードは
 * 銀行との契約時に払い出される値であるため、本実装ではMVPとして一般的な
 * 総合振込フォーマットの構造(ヘッダー/データ/トレーラー/エンド、半角カナ変換、
 * ゼロ埋め数値)を再現する。データレコードのチェックデジットは特定銀行の
 * 検査文字アルゴリズムではなく、口座情報+金額の数字列に対する簡易mod10
 * チェックサム(改ざん・入力誤り検知用)として実装している。
 *
 * ファイルは実際のShift-JISバイト列ではなく、半角カナ相当のUnicodeコードポイント
 * (U+FF61-U+FF9F等)を1文字1バイト相当として扱うテキスト表現で生成する
 * (Node標準にShift-JISエンコーダがなく、本タスクの依存追加はスコープ外のため)。
 * 実際の銀行送信時はこのテキストをShift-JISへ再エンコードする必要がある。
 */

const HALF_WIDTH_KANA_MAP: Record<string, string> = {
  ア: 'ｱ', イ: 'ｲ', ウ: 'ｳ', エ: 'ｴ', オ: 'ｵ',
  カ: 'ｶ', キ: 'ｷ', ク: 'ｸ', ケ: 'ｹ', コ: 'ｺ',
  ガ: 'ｶﾞ', ギ: 'ｷﾞ', グ: 'ｸﾞ', ゲ: 'ｹﾞ', ゴ: 'ｺﾞ',
  サ: 'ｻ', シ: 'ｼ', ス: 'ｽ', セ: 'ｾ', ソ: 'ｿ',
  ザ: 'ｻﾞ', ジ: 'ｼﾞ', ズ: 'ｽﾞ', ゼ: 'ｾﾞ', ゾ: 'ｿﾞ',
  タ: 'ﾀ', チ: 'ﾁ', ツ: 'ﾂ', テ: 'ﾃ', ト: 'ﾄ',
  ダ: 'ﾀﾞ', ヂ: 'ﾁﾞ', ヅ: 'ﾂﾞ', デ: 'ﾃﾞ', ド: 'ﾄﾞ',
  ナ: 'ﾅ', ニ: 'ﾆ', ヌ: 'ﾇ', ネ: 'ﾈ', ノ: 'ﾉ',
  ハ: 'ﾊ', ヒ: 'ﾋ', フ: 'ﾌ', ヘ: 'ﾍ', ホ: 'ﾎ',
  バ: 'ﾊﾞ', ビ: 'ﾋﾞ', ブ: 'ﾌﾞ', ベ: 'ﾍﾞ', ボ: 'ﾎﾞ',
  パ: 'ﾊﾟ', ピ: 'ﾋﾟ', プ: 'ﾌﾟ', ペ: 'ﾍﾟ', ポ: 'ﾎﾟ',
  マ: 'ﾏ', ミ: 'ﾐ', ム: 'ﾑ', メ: 'ﾒ', モ: 'ﾓ',
  ヤ: 'ﾔ', ユ: 'ﾕ', ヨ: 'ﾖ',
  ラ: 'ﾗ', リ: 'ﾘ', ル: 'ﾙ', レ: 'ﾚ', ロ: 'ﾛ',
  ワ: 'ﾜ', ヲ: 'ｦ', ン: 'ﾝ',
  ァ: 'ｧ', ィ: 'ｨ', ゥ: 'ｩ', ェ: 'ｪ', ォ: 'ｫ',
  ッ: 'ｯ', ャ: 'ｬ', ュ: 'ｭ', ョ: 'ｮ',
  ー: 'ｰ', '、': '､', '。': '｡', '「': '｢', '」': '｣', '・': '･', '゛': 'ﾞ', '゜': 'ﾟ',
  '　': ' ',
};

/** 全角カタカナ・全角英数記号を半角に変換する(全銀協データの標準要件)。マップにない文字はそのまま通す */
export function toHalfWidthKana(input: string | null | undefined): string {
  if (!input) return '';
  let result = '';
  for (const ch of input) {
    const mapped = HALF_WIDTH_KANA_MAP[ch];
    if (mapped !== undefined) {
      result += mapped;
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0xff01 && code <= 0xff5e) {
      result += String.fromCharCode(code - 0xfee0);
    } else {
      result += ch;
    }
  }
  return result;
}

function padText(value: string | null | undefined, length: number): string {
  const converted = toHalfWidthKana(value ?? '').toUpperCase();
  const truncated = converted.length > length ? converted.slice(0, length) : converted;
  return truncated.padEnd(length, ' ');
}

function padNumber(value: number, length: number): string {
  const normalized = Math.max(0, Math.round(value));
  const str = String(normalized);
  if (str.length > length) {
    throw new Error(`数値(${normalized})が全銀フォーマットの桁数(${length})を超えています`);
  }
  return str.padStart(length, '0');
}

function accountTypeCode(accountType: string | null | undefined): string {
  switch (accountType) {
    case 'ordinary':
      return '1';
    case 'checking':
      return '2';
    default:
      return '1';
  }
}

/** 数字以外を除去した上で各桁を合算し、mod10した1桁を検査文字として返す(MVP簡易チェックデジット) */
function computeCheckDigit(...parts: string[]): string {
  const digits = parts.join('').replace(/\D/g, '');
  let sum = 0;
  for (const d of digits) sum += Number(d);
  return String(sum % 10);
}

export interface ZenginSenderInfo {
  consignorCode: string;
  consignorName: string;
  bankCode: string;
  bankName: string;
  branchCode: string;
  branchName: string;
  accountType: string;
  accountNumber: string;
}

export interface ZenginTransferItem {
  bankCode: string;
  bankName: string;
  branchCode: string;
  branchName: string;
  accountType: string;
  accountNumber: string;
  payeeName: string;
  amount: number;
}

function assertRecordLength(record: string, label: string): string {
  if (record.length !== 120) {
    throw new Error(`${label}レコードの長さが120バイトではありません(実際: ${record.length})`);
  }
  return record;
}

function buildHeaderRecord(sender: ZenginSenderInfo, paymentDate: string): string {
  const mmdd = paymentDate.replace(/-/g, '').slice(4, 8);
  const record = [
    '1', // データ区分: ヘッダー
    '21', // 種別コード: 総合振込
    '0', // コード区分
    padText(sender.consignorCode, 10),
    padText(sender.consignorName, 40),
    mmdd, // 取組日(MMDD)
    padText(sender.bankCode, 4),
    padText(sender.bankName, 15),
    padText(sender.branchCode, 3),
    padText(sender.branchName, 15),
    accountTypeCode(sender.accountType),
    padText(sender.accountNumber, 7),
    ' '.repeat(17), // ダミー
  ].join('');
  return assertRecordLength(record, 'ヘッダー');
}

function buildDataRecord(item: ZenginTransferItem): string {
  const checkDigit = computeCheckDigit(
    item.bankCode,
    item.branchCode,
    item.accountNumber,
    String(Math.round(item.amount)),
  );
  const record = [
    '2', // データ区分: データ
    padText(item.bankCode, 4),
    padText(item.bankName, 15),
    padText(item.branchCode, 3),
    padText(item.branchName, 15),
    '0'.repeat(4), // 手形交換所番号(未使用)
    accountTypeCode(item.accountType),
    padText(item.accountNumber, 7),
    padText(item.payeeName, 30),
    padNumber(item.amount, 10),
    '1', // 新規コード
    ' '.repeat(10), // 顧客番号1(未使用)
    ' '.repeat(10), // 顧客番号2(未使用)
    '9', // 振込指定区分(その他)
    checkDigit,
    ' '.repeat(7), // ダミー
  ].join('');
  return assertRecordLength(record, 'データ');
}

function buildTrailerRecord(count: number, totalAmount: number): string {
  const checkDigit = computeCheckDigit(String(count), String(Math.round(totalAmount)));
  const record = [
    '8', // データ区分: トレーラー
    padNumber(count, 6),
    padNumber(totalAmount, 12),
    checkDigit,
    ' '.repeat(100), // ダミー
  ].join('');
  return assertRecordLength(record, 'トレーラー');
}

function buildEndRecord(): string {
  const record = ['9', ' '.repeat(119)].join('');
  return assertRecordLength(record, 'エンド');
}

export interface GenerateZenginFileResult {
  content: string;
  sha256: string;
  recordCount: number;
}

/**
 * ヘッダー/データ(明細ごと)/トレーラー/エンドの4種のレコードを結合した全銀協形式テキストを生成し、
 * そのSHA-256ハッシュを併せて返す(`payment_batches.file_hash` に記録するため)。
 */
export function generateZenginTransferFile(
  sender: ZenginSenderInfo,
  paymentDate: string,
  items: ZenginTransferItem[],
): GenerateZenginFileResult {
  const lines: string[] = [];
  lines.push(buildHeaderRecord(sender, paymentDate));
  for (const item of items) {
    lines.push(buildDataRecord(item));
  }
  const totalAmount = items.reduce((sum, i) => sum + i.amount, 0);
  lines.push(buildTrailerRecord(items.length, totalAmount));
  lines.push(buildEndRecord());

  // 全銀協仕様は本来レコード間の改行なし・固定長連結が原則だが、テキストファイルとして
  // 可読性・検証性を確保するためレコード単位でCRLF区切りを付与する。
  const content = lines.join('\r\n') + '\r\n';
  const sha256 = createHash('sha256').update(content, 'utf8').digest('hex');
  return { content, sha256, recordCount: lines.length };
}
