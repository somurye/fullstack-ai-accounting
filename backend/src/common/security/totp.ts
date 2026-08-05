import { createHmac } from 'node:crypto';

/**
 * totp.ts
 * =======
 * RFC 6238 (TOTP) の最小実装。新規依存(otplib等)を追加せず、Node標準の
 * `crypto.createHmac` のみで実装する。Base32デコードも自前実装する
 * (Node標準にBase32は無い。TOTPシークレットは認証アプリ間の相互運用上
 * Base32表現が事実上の標準のため、それに合わせる)。
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEFAULT_STEP_SECONDS = 30;
const DEFAULT_DIGITS = 6;

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const char of clean) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) continue;
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number, digits: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binCode % 10 ** digits).padStart(digits, '0');
}

export function generateTotp(
  base32Secret: string,
  options: { stepSeconds?: number; digits?: number; atMs?: number } = {},
): string {
  const stepSeconds = options.stepSeconds ?? DEFAULT_STEP_SECONDS;
  const digits = options.digits ?? DEFAULT_DIGITS;
  const counter = Math.floor((options.atMs ?? Date.now()) / 1000 / stepSeconds);
  return hotp(base32Decode(base32Secret), counter, digits);
}

/**
 * クロックドリフト・入力タイムラグを許容するため、前後1ステップ(合計±30秒)の
 * ウィンドウ内でコードを検証する。
 */
export function verifyTotp(
  base32Secret: string,
  code: string,
  options: { stepSeconds?: number; digits?: number; window?: number; atMs?: number } = {},
): boolean {
  const stepSeconds = options.stepSeconds ?? DEFAULT_STEP_SECONDS;
  const digits = options.digits ?? DEFAULT_DIGITS;
  const window = options.window ?? 1;
  const counter = Math.floor((options.atMs ?? Date.now()) / 1000 / stepSeconds);
  const secretBuffer = base32Decode(base32Secret);
  for (let drift = -window; drift <= window; drift++) {
    if (hotp(secretBuffer, counter + drift, digits) === code) {
      return true;
    }
  }
  return false;
}
