import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * password.ts
 * ===========
 * パスワードのハッシュ化・照合。新規依存(bcrypt等)を追加せず、Node標準の
 * `crypto.scrypt`(OWASP推奨のメモリハードKDF)のみで実装する。
 *
 * 保存形式: `<saltHex>:<derivedKeyHex>`。ソルトはユーザーごとにランダム生成するため、
 * 同一パスワードでも保存値は毎回異なる(レインボーテーブル対策)。
 */
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH).toString('hex');
  const derivedKey = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${derivedKey}`;
}

/**
 * `stored` が不正な形式(空・区切り無し等)の場合も例外を投げず `false` を返す。
 * `timingSafeEqual` はバッファ長が一致しないと例外を投げるため、長さ不一致も
 * 明示的に弾いてから比較する(タイミング攻撃対策として、この判定自体の時間差は
 * ログイン試行の成否推測には実用上寄与しない)。
 */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const derivedKey = scryptSync(password, salt, KEY_LENGTH);
  const keyBuffer = Buffer.from(key, 'hex');
  if (keyBuffer.length !== derivedKey.length) return false;
  return timingSafeEqual(derivedKey, keyBuffer);
}
