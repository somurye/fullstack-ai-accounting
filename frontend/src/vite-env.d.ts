/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** APIのベースURL。未設定時は開発サーバーのプロキシ経由 (`/v1`) を使用する */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
