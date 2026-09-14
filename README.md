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

続けて、スーパーユーザー`postgres`でスキーマを流し込む（`001`がテーブル本体・RLS・実行ロール作成、`002`以降は追加カラム・追加機能向けの増分マイグレーション）。

`sql/001_initial_schema_all_in_one.sql` 〜 `sql/008b_*.sql` までの全マイグレーションを連番順に一括適用するには、`backend`ディレクトリで以下を実行する（ホストの `psql`、`docker compose exec`、または `node-postgres` 経由で自動適用される）。

```bash
cd backend
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/keiri_kaikei" npm run db:migrate
```

> **開発・運用ルール**: **マイグレーション実装後は必ず実DB E2E検証（`python scripts/verify_schema.py`）を実行し、全テストケースがPASSすることを確認すること。**

```bash
# 実DB E2E検証の実行
python scripts/verify_schema.py --dsn "postgresql://postgres:postgres@localhost:5432/keiri_kaikei"
# または使い捨てコンテナで完全自動検証
python scripts/verify_schema.py --use-docker
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

## 人事労務・給与マスタ運用上の重要事項（保険料率・税額表の運用原則）

本システムは計画書5.2節の設計原則に基づき、健康保険・厚生年金・雇用保険の各料率、および所得税源泉徴収税額表（月額表）を**コードやマイグレーションにハードコードせず、有効期間付きのマスタデータとしてDB管理**しています。

### 初期サンプルデータと本番運用の区別
- **初期登録値はサンプル・参考値です**: DB初期化時やテスト環境に投入される保険料率および源泉徴収税額表は、動作確認用のサンプル値です。これをそのまま本番運用の正しい確定値として扱わないでください。
- **本番運用開始前の必須作業**: 実務運用（給与計算エンジンの実行・支給控除一覧表作成・法定納付等）を開始する前に、必ず管理画面（`/rate-masters`）または管理者APIを用いて、貴社が属する協会けんぽ各支部・健康保険組合、日本年金機構、および国税庁公表の最新法令値に更新してください。
- **法改正・年度更新時の運用**:
  - 料率や税額表は `effective_from`（適用開始日）および `effective_to`（適用終了日）による履歴管理が行われます。
  - 過去の給与再計算や監査証跡を保護するため、**過去の確定済みレコードを上書き更新せず、改定日に応じた新たなレコードを追加登録**してください。
  - 同一テナント・同一種別・同一扶養人数における有効期間および所得帯の重複は、PostgreSQLのEXCLUDE制約（`btree_gist`拡張）によりDBレベルで確実に拒否されます。

## セキュリティに関する注意

- `.env` および実際のAPIキー・DB接続情報はコミットしないこと（`.gitignore` で除外済み）。
- 本番環境の `JWT_SECRET` / `SETTINGS_ENCRYPTION_KEY` / DB認証情報は、必ずシークレットマネージャ経由で注入すること。
- `NODE_ENV=production` 起動時、`JWT_SECRET` / `SETTINGS_ENCRYPTION_KEY` が未設定、または `.env.example` 由来のデフォルト値のままの場合はfail-fastでプロセスが即座に終了する（`backend/src/config/validate-production-env.ts`）。
- **DB最終防御の限界と受容するセキュリティ境界（計画書0.5節）**:
  - 本システムは単一の共有DBロール（`app_runtime`）で全DB操作を行うアーキテクチャを採用しています。そのため、DBトリガーが検証できるのはDBに格納された事実に基づく構造的な業務ルール（テナント完全分離・自己承認の禁止・承認権限ロールの保有等）であり、「生SQL文を実行している主体の本人性」そのものをDB単独で検証することはできません。
  - 正規のAPI・Service層を経由する限り、`approval_history.approver_id` を含む操作主体IDは常にサーバー側の認証済みセッション（JWT等）から強制導出され、クライアント入力（リクエストボディやクエリ）で上書きすることは構造的に不可能です。
  - **したがって、本システムの防御境界は「正規のAPI・Service層を経由した操作である限り、構造的業務ルールを確実に守る」という範囲までとし、`app_runtime` のDB認証情報自体を奪取した攻撃者による生SQL実行（本人性偽造）までは防御対象外（受容境界）とします。**


