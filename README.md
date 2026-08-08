# 経理・会計オールインワンAIアプリケーション（keiri-kaikei）

中小〜中堅企業向けに、経理・会計業務をこのアプリケーション1つで完結させる（All-in-One）ことを目的としたAI活用型SaaS。マネーフォワードクラウド、freee会計、楽楽精算、勘定奉行クラウド等が個別に提供する機能群（経費精算、請求書発行、支払管理、固定資産、給与連携、税務申告支援）を、単一の統合データモデル上で最初から結合して提供する。

設計思想の詳細は [docs/01_requirements.md](docs/01_requirements.md) を参照。

## 主な特徴（Key Features）

- **マルチテナントRLS隔離 & 不変（Append-Only）監査ログ**
  すべてのテナント固有テーブルは行レベルセキュリティ（RLS）で保護され、セッション変数 `app.current_tenant_id` が一致しない限り一切の行が見えない。監査ログは追記専用で改ざん不可。
- **Vision AI（Gemini / OpenAI / Anthropic）によるマルチレシートOCR精算**
  テナントごとに設定したAIプロバイダー（Gemini / OpenAI / Anthropic）のVision機能で証憑を読み取り、仕訳科目候補を提案。確定登録は人間承認を経由する決定的ロジックが担う。
- **銀行・給与明細の自動消込（アドバイザリロックによる二重防止）**
  銀行/カード明細CSV取込、売掛金・買掛金の自動消込、給与ソフトCSVからの複合仕訳生成を、PostgreSQLのアドバイザリロックで二重処理を防止しながら実行。
- **リアルタイム試算表（TB）/ PL / BS / 直接法CF（1円単位の完全一致）**
  貸借・PL/BS・CF間の整合性をDB制約とアプリケーションロジックの両方で保証。
- **外部税理士向け 14日間時限アクセス制御**
  監査・税理士向け専用ロール（`viewer_external`）による期限付きアクセス。
- **銀行オープンAPI連携（アダプタ方式・モック実装）**
  設定画面からOAuth風の認証連携（連携／解除）を行い、連携後は共通`IBankApiClient`インターフェース経由で明細を取得。冪等な取込（`external_transaction_id`による重複排除）と、既存の自動消込エンジンへの連携までをワンクリックで実行する。プロバイダーは`BANK_PROVIDER`環境変数で切り替え可能な設計（現状は`mock`のみ実装）。

## 技術スタック（Tech Stack）

**Backend**
- Node.js / TypeScript / NestJS
- PostgreSQL（Row-Level Security, pgvector）
- 生SQL駆動（`pg` / node-postgres、ORM不使用）
- Docker

**Frontend**
- React 19 / TypeScript / Vite
- Tailwind CSS

## ドキュメント

| # | ドキュメント |
|---|---|
| 01 | [要件定義書](docs/01_requirements.md) |
| 02 | [アーキテクチャ設計書](docs/02_architecture.md) |
| 03 | [データベース設計書](docs/03_database_design.md) |
| 04 | [技術リファレンス](docs/04_technical_reference.md) |
| 05 | [デプロイガイド](docs/05_deployment_guide.md) |
| - | [OpenAPI仕様](docs/openapi.yaml) |
| - | [開発経緯・シミュレーション報告](docs/PROJECT_HISTORY.md) |

## ローカル起動手順（Getting Started）

### 前提

- Docker / Docker Compose
- Node.js（backend / frontend 双方の `package.json` engines を参照）

### 1. データベースの起動

```bash
docker-compose up -d
```

`pgvector/pgvector:pg16` イメージでPostgreSQLが `localhost:5432` に起動する（DB名: `keiri_kaikei`）。

続けて、スーパーユーザー`postgres`でスキーマを流し込む（`001`がテーブル本体・RLS・実行ロール作成、`002`/`003`が銀行連携機能向けの追加カラム）。

```bash
docker compose exec -T postgres psql -U postgres -d keiri_kaikei < sql/001_initial_schema_all_in_one.sql
docker compose exec -T postgres psql -U postgres -d keiri_kaikei < sql/002_bank_integration.sql
docker compose exec -T postgres psql -U postgres -d keiri_kaikei < sql/003_bank_connector_link_status.sql
```

### 2. バックエンド

```bash
cd backend
cp .env.example .env   # DATABASE_URL / JWT_SECRET / SETTINGS_ENCRYPTION_KEY / BANK_PROVIDER を環境に合わせて設定
npm install
npm run start:dev
```

`SETTINGS_ENCRYPTION_KEY` は外部連携APIキー等の暗号化に使うマスター鍵。本番相当の値を使う場合は以下で生成する。

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 3. フロントエンド

```bash
cd frontend
npm install
npm run dev
```

デフォルトでは `http://localhost:5173` で起動し、backend（`http://localhost:3000`）と通信する。

## セキュリティに関する注意

- `.env` および実際のAPIキー・DB接続情報はコミットしないこと（`.gitignore` で除外済み）。
- 本番環境の `JWT_SECRET` / `SETTINGS_ENCRYPTION_KEY` / DB認証情報は、必ずシークレットマネージャ経由で注入すること。
