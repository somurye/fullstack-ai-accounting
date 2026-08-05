import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Vite 8のネイティブ設定ローダーは `__dirname` を提供しないため、
// Node 20.11+ で利用可能な `import.meta.dirname` を使用する。

/**
 * vite.config.ts
 * ==============
 * 開発サーバーは `/v1` プレフィックス配下へのリクエストをバックエンド
 * (`backend/`, NestJS, デフォルトport 3000)へプロキシする。
 * 本番ビルドでは `VITE_API_BASE_URL` 環境変数でAPIのベースURLを直接指定する
 * (`src/lib/apiClient.ts` 参照)。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/v1': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
