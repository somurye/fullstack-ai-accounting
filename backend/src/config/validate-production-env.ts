import { Logger } from '@nestjs/common';

/**
 * validate-production-env.ts
 * ===========================
 * `NODE_ENV=production`起動時、機密系環境変数が未設定・またはリポジトリの
 * `.env.example` 由来のデフォルト値のまま残っていないかを検証する。
 *
 * `JWT_SECRET`(認証トークン署名鍵)や`SETTINGS_ENCRYPTION_KEY`(外部連携APIキー等の
 * 暗号化マスター鍵)がデフォルト値のまま本番稼働すると、JWT偽造や暗号化秘密情報の
 * 復号が第三者に可能になる致命的な脆弱性となる。実行時エラーとして後から気づくのではなく、
 * 起動そのものを fail-fast で止める。
 */
const DEFAULT_SENTINEL = 'change-me-in-production';

interface RequiredSecret {
  envVar: string;
  description: string;
}

const REQUIRED_SECRETS: RequiredSecret[] = [
  { envVar: 'JWT_SECRET', description: '認証トークンの署名鍵' },
  { envVar: 'SETTINGS_ENCRYPTION_KEY', description: '外部連携APIキー等の暗号化マスター鍵' },
];

export function validateProductionEnv(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const errors: string[] = [];
  for (const secret of REQUIRED_SECRETS) {
    const value = process.env[secret.envVar];
    if (!value || value === DEFAULT_SENTINEL) {
      errors.push(`  - ${secret.envVar}(${secret.description})が未設定、またはデフォルト値のままです`);
    }
  }

  if (errors.length > 0) {
    Logger.error(
      `本番環境(NODE_ENV=production)の起動を中止しました。以下の環境変数を正しく設定してください:\n${errors.join('\n')}`,
      'BootstrapGuard',
    );
    process.exit(1);
  }
}
