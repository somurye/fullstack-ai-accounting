import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * secret-encryption.ts
 * ====================
 * 外部連携APIキー等、可逆的に復号する必要がある機密情報をAES-256-GCMで暗号化・復号する。
 * `SETTINGS_ENCRYPTION_KEY`(base64エンコードされた32バイト鍵)をマスター鍵とし、
 * 暗号化のたびにランダムなIVを生成する(同一平文でも暗号文は毎回異なる)。
 * 認証タグにより改ざん検知も行う(復号時にタグ不一致なら例外)。
 */
const IV_LENGTH = 12;
const ALGORITHM = 'aes-256-gcm';

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

function getMasterKey(): Buffer {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('SETTINGS_ENCRYPTION_KEY environment variable is not set');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('SETTINGS_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded)');
  }
  return key;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getMasterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  const decipher = createDecipheriv(ALGORITHM, getMasterKey(), Buffer.from(secret.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/** マスク表示用: 末尾4桁以外を隠蔽する(例: "sk-ab12cd34" -> "••••cd34") */
export function maskSecret(last4: string): string {
  return `••••${last4}`;
}
