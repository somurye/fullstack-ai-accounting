# 経理・会計 + 全社バックオフィス統合AI SaaS（keiri-kaikei）

中小〜中堅企業向けに、経理・会計業務をこのアプリケーション1つで完結させる（All-in-One）ことを目的としたAI活用型SaaS。マネーフォワードクラウド、freee会計、楽楽精算、勘定奉行クラウド等が個別に提供する機能群（経費精算、請求書発行、支払管理、固定資産、給与連携、税務申告支援）を、単一の統合データモデル上で最初から結合して提供する。

さらに、全社バックオフィス拡張（Phase 0〜5）の実装完了により、経理・会計コアにとどまらず、**契約書管理・電子帳簿保存法対応、購買調達・3点照合、人事労務・給与計算内製化・年末調整、見積書・案件パイプライン・契約更新連携、全社横断KPIダッシュボード・文脈連動型AIレコメンドエンジン**までを単一のPostgreSQL基盤・統一RBACの下でシームレスに統合した「全社バックオフィス統合プラットフォーム」へと進化しました。

設計思想の詳細は [docs/01_requirements.md](docs/01_requirements.md) 、拡張の全経緯・実装記録は [docs/backoffice_expansion_plan.md](docs/backoffice_expansion_plan.md) を参照。

## 主な特徴（Key Features）

### 経理・会計コア基盤
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

### 全社バックオフィス拡張機能（Phase 1〜5）
- **法務・契約書管理 & 電帳法対応（Phase 1）**
  契約書のPDFアップロード・テキスト抽出・AI条項解析・ライフサイクル（ドラフト〜締結〜終了）管理。更新期限前（30日前等）の自動アラート通知、`pg_trgm`を活用した契約書全文検索、社内稟議・汎用申請ワークフロー。
- **購買・調達管理 & 3点照合（Phase 2）**
  品目別購買申請・多段階承認・発注管理から、納品受領（受領書）および仕入請求書の照合までを一元化。発注書・受領書・請求書の「3点照合（Three-Way Matching）」を経て買掛金（`vendor_bills`）へ自動連動。発注残・未払残を可視化する購買ダッシュボード。
- **人事労務・給与計算内製化 & 年末調整（Phase 3）**
  従業員台帳管理、Web勤怠打刻・月次集計（所定外・深夜時間の自動計算）。有効期間付き社会保険料率・所得税額表マスタに基づく給与計算エンジン（確定後WORM不変性保証）、Web給与明細PDF出力、2026年分（令和8年分）年末調整計算エンジン。
- **営業事務・商流管理（Phase 4）**
  見積書のライフサイクル管理（自動採番、改訂履歴リンク、確定後WORM不変性、PDF生成）。案件（Deal）パイプライン管理（ステージ進捗、受注・失注の終端ロック不変性）。契約書↔案件↔見積書の契約更新リンク連携（対称的WORM保護と二重変換防止アドバイザリロック）、営業KPIダッシュボード。
- **全社横断KPIダッシュボード & 文脈連動型AIレコメンド（Phase 5）**
  財務（売上・利益・CF）、購買（発注・未払残）、人事（人件費・残業時間）、営業（パイプライン金額・受注率）の全社KPIを既存ドメインサービス委譲型で集計するエグゼクティブダッシュボード。各業務画面に連動して次の推奨アクションを提示するルールベースAIレコメンドエンジン（状態遷移ガード付き）。
- **多層防御セキュリティ & RBACドリフト自動検知**
  PostgreSQL 16 RLSによる全テーブルの物理テナント隔離、WORM不変性トリガーによる改ざん不能性。アプリケーション層のGuard静的権限マップとDB `role_permissions`（全10ロール×機能権限の200組）が完全一致することをスキーマ検証スクリプトで常時自動検証。

## 技術スタック（Tech Stack）

**Backend**
- Node.js / TypeScript / NestJS
- PostgreSQL（Row-Level Security, pgvector, pg_trgm, btree_gist）
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
| - | [バックオフィス拡張計画書（Phase 0〜5 実装・検証記録）](docs/backoffice_expansion_plan.md) |
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

### 年末調整機能の対象年分・簡略化モデルおよびマスタ連携
- **サポート対象年分**: 現状の実装は **2026年分（令和8年分）の簡略税制モデルのみ** をサポートしています。API/Service層で `tax_year === 2026` を検証し、それ以外の年度が指定された場合は `400 Bad Request (UNSUPPORTED_TAX_YEAR)` で拒絶します。
- **簡略化モデルの範囲**:
  - 基礎控除（年収2,400万円以下一律480,000円）
  - 配偶者控除（上限380,000円）
  - 扶養控除（1人あたり一律380,000円）
  - 生命保険料控除（上限120,000円）
  - 地震保険料控除（上限50,000円）
  - 住宅借入金等特別控除（入力額全額控除）
  - 給与所得控除（速算表モデル）
  - 復興特別所得税（基準所得税額の102.1%）
- **計算根拠マスタ（`applied_rate_ids`）の追跡保証**:
  - 年末調整の算出にあたっては、対象年度（2026年）・扶養親族等の数・課税給与所得金額に応じた `income_tax_withholding_brackets`（源泉徴収税額表）を実際にDBから検索し、実際にマッチしたレコードのIDのみを `applied_rate_ids` に記録します。条件に合致するマスタが存在しない場合は `400 Bad Request (TAX_BRACKET_NOT_FOUND)` で計算を拒絶します。
- **将来の拡張予定（DEBT-021）**:
  - 複数年度対応および控除額・計算式の完全マスタ化（`income_deduction_rules` 等の有効期間付きマスタへの切り出し）は技術的負債（DEBT-021）として将来対応に回しています。

## セキュリティに関する注意

- `.env` および実際のAPIキー・DB接続情報はコミットしないこと（`.gitignore` で除外済み）。
- 本番環境の `JWT_SECRET` / `SETTINGS_ENCRYPTION_KEY` / DB認証情報は、必ずシークレットマネージャ経由で注入すること。
- `NODE_ENV=production` 起動時、`JWT_SECRET` / `SETTINGS_ENCRYPTION_KEY` が未設定、または `.env.example` 由来のデフォルト値のままの場合はfail-fastでプロセスが即座に終了する（`backend/src/config/validate-production-env.ts`）。
- **DB最終防御の限界と受容するセキュリティ境界（計画書0.5節）**:
  - 本システムは単一の共有DBロール（`app_runtime`）で全DB操作を行うアーキテクチャを採用しています。そのため、DBトリガーが検証できるのはDBに格納された事実に基づく構造的な業務ルール（テナント完全分離・自己承認の禁止・承認権限ロールの保有等）であり、「生SQL文を実行している主体の本人性」そのものをDB単独で検証することはできません。
  - 正規のAPI・Service層を経由する限り、`approval_history.approver_id` を含む操作主体IDは常にサーバー側の認証済みセッション（JWT等）から強制導出され、クライアント入力（リクエストボディやクエリ）で上書きすることは構造的に不可能です。
  - **したがって、本システムの防御境界は「正規のAPI・Service層を経由した操作である限り、構造的業務ルールを確実に守る」という範囲までとし、`app_runtime` のDB認証情報自体を奪取した攻撃者による生SQL実行（本人性偽造）までは防御対象外（受容境界）とします。**


