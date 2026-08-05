# 経理・会計オールインワンAIアプリケーション 完全導入マニュアル

- 文書番号: DOC-05
- バージョン: 1.0.0
- 関連文書: `04_technical_reference.md`, `01_requirements.md`, `03_database_design.md`

本書は、このリポジトリを**何も入っていない環境からクローンし、開発サーバーを起動し、初回ログインできる状態にするまで**を一気通貫で説明する。すべての手順は実際にこのリポジトリ上で実行・検証済みのコマンドに基づく。

---

## 1. 前提条件

| 項目 | 要件 | 確認コマンド |
|---|---|---|
| Node.js | 20以上 | `node -v` |
| npm | Node同梱のもの | `npm -v` |
| Docker Desktop | PostgreSQL(pgvector)をローカルで起動するために使用 | `docker -v` |
| Python 3 + psycopg2-binary | スキーマ検証スクリプト(`scripts/verify_schema.py`)を使う場合のみ必須 | `python3 -V` |
| OS | Windows / macOS / Linux いずれも可(本書のコマンド例はWindows + Git Bash想定だが、macOS/Linuxでも同一) |

> **Windows特有の注意**: Docker Desktopのデーモンは自動起動しないことがある。`docker ps`が `error during connect ... dockerDesktopLinuxEngine` を返す場合は、Docker Desktopアプリを起動してから10〜20秒待つ(`docker-compose.yml`の`restart: unless-stopped`が効いていれば、デーモン起動後に既存コンテナは自動的に立ち上がる)。

---

## 2. リポジトリ取得と全体構成の確認

```bash
git clone <このリポジトリのURL> keiri-kaikei
cd keiri-kaikei
```

ルート直下の構成:

```
backend/        NestJS APIサーバー
frontend/       React SPA
sql/            DBスキーマ(全部入り1ファイル)
docs/           設計文書(本書含む)
scripts/        DB検証・シードスクリプト
docker-compose.yml   PostgreSQL(pgvector)のみ定義。アプリ本体は未コンテナ化
```

---

## 3. データベースのセットアップ

### 3.1 PostgreSQLコンテナの起動

```bash
docker compose up -d
```

`docker-compose.yml`は以下を定義している:

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: keiri_kaikei
    ports:
      - "5432:5432"
```

起動確認:

```bash
docker compose ps
# STATUS が "Up (healthy)" になっていることを確認
```

### 3.2 スキーマの適用

`sql/001_initial_schema_all_in_one.sql` を、コンテナ作成時の**スーパーユーザー`postgres`**で流し込む。このSQL自身が、アプリが実際に使う`app_runtime`/`app_readonly_external`ロールをこの中で作成する。

```bash
# ホストにpsqlがある場合
PGPASSWORD=postgres psql -h localhost -U postgres -d keiri_kaikei -f sql/001_initial_schema_all_in_one.sql

# psqlが無い場合はコンテナ内のpsqlを使う(推奨・環境非依存)
docker compose exec -T postgres psql -U postgres -d keiri_kaikei < sql/001_initial_schema_all_in_one.sql
```

あるいは `backend/package.json` のスクリプトを使う(`DATABASE_URL`環境変数が必要。3.4節参照):

```bash
cd backend
npm run db:apply-schema
```

適用後、テーブル数を確認する(61テーブルが作成される):

```bash
docker compose exec postgres psql -U postgres -d keiri_kaikei -c "\dt" | wc -l
```

### 3.3 (推奨)スキーマ検証スクリプトの実行

RLSによるテナント分離・貸借チェック・追記専用・24時間Void・自己承認禁止・外部時限アクセスが実際に機能するかを、使い捨てのDockerコンテナ上で自動検証できる。

```bash
python3 -m pip install psycopg2-binary
python3 scripts/verify_schema.py --use-docker
```

既に3.1節でコンテナを起動済みの場合は、そのDSNを直接指定してもよい:

```bash
python3 scripts/verify_schema.py --dsn "postgresql://postgres:postgres@localhost:5432/keiri_kaikei"
```

### 3.4 ロールパスワードの確認・変更

スキーマ適用直後、`app_runtime`/`app_readonly_external`のパスワードは**既定値`change_me_in_production`のまま**になっている。ローカル開発ではこのままで構わないが、**本番相当環境へ展開する場合は必ず変更する**:

```sql
ALTER ROLE app_runtime PASSWORD '<強力なランダム文字列>';
ALTER ROLE app_readonly_external PASSWORD '<強力なランダム文字列>';
```

変更後は`backend/.env`の`DATABASE_URL`/`PGPASSWORD`も同じ値に更新すること。

---

## 4. バックエンドのセットアップ

### 4.1 依存パッケージのインストール

```bash
cd backend
npm install
```

### 4.2 環境変数ファイルの作成

```bash
cp .env.example .env
```

`.env`の全項目:

| 変数 | 既定値(`.env.example`) | 説明 |
|---|---|---|
| `PORT` | `3000` | APIサーバーのリッスンポート |
| `CORS_ORIGIN` | `http://localhost:5173` | 許可するオリジン(カンマ区切りで複数指定可)。**未設定にすると全オリジン拒否**(fail-closed設計、本書執筆時点の修正済み挙動) |
| `DATABASE_URL` | `postgresql://app_runtime:change_me_in_production@localhost:5432/keiri_kaikei` | 優先される接続文字列 |
| `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` | 個別接続情報 | `DATABASE_URL`未設定時のフォールバック(実装上は両方指定されている場合`DATABASE_URL`の値が優先される。値は一致させておくこと) |
| `PG_POOL_MAX` | `20` | コネクションプール最大数 |
| `JWT_SECRET` | `change-me-in-production` | JWT署名鍵。**本番では必ずシークレットマネージャ経由で注入** |
| `JWT_EXPIRES_IN` | `1h` | アクセストークン有効期限。ログアウト即時失効機構が無いため、本番では短めの設定を推奨(`04_technical_reference.md` 3.4節参照) |
| `SETTINGS_ENCRYPTION_KEY` | `change-me-in-production` | AI連携APIキー等の暗号化マスター鍵(base64エンコード済み32バイト)。生成例: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |

### 4.3 型チェック

```bash
npm run typecheck
```

エラーが出ないことを確認してから次に進む。

### 4.4 開発サーバーの起動

```bash
npm run start:dev
```

`🚀 API server listening on http://localhost:3000/v1` が出力されれば起動成功。ヘルスチェック代わりに以下でルーティングが有効か確認できる(未認証なので401が返るのが正常):

```bash
curl -i http://localhost:3000/v1/accounts
```

---

## 5. フロントエンドのセットアップ

### 5.1 依存パッケージのインストール

```bash
cd frontend
npm install
```

### 5.2 環境変数(任意)

フロントエンドに`.env.example`は存在しない。開発時はVite devサーバーの`/v1`プロキシ(`vite.config.ts`、既定で`http://localhost:3000`へフォワード)がそのまま機能するため、通常は環境変数の設定は不要。本番ビルドでAPIのベースURLを明示したい場合のみ`.env.production`等を作成する:

```
VITE_API_BASE_URL=https://api.example.com/v1
```

バックエンドのポートを3000以外に変更した場合は、Viteの proxy 先を上書きできる:

```
VITE_API_PROXY_TARGET=http://localhost:4000
```

### 5.3 型チェック

```bash
npm run typecheck
```

### 5.4 開発サーバーの起動

```bash
npm run dev
```

`http://localhost:5173` をブラウザで開く。

---

## 6. 初回セットアップ(テナント作成〜ログイン)

このアプリには管理者による初期データ投入は不要で、**サインアップ画面から最初のテナント(会社)とオーナーユーザーを同時に作成する**フローになっている。

1. `http://localhost:5173/signup`(または画面上のサインアップ導線)を開く。
2. 会社名・氏名・メールアドレス・パスワードを入力して送信する。
3. 内部的には `POST /v1/auth/signup` が呼ばれ、以下が1トランザクションで作成される:
   - `tenants` 行
   - `users` / `tenant_users` 行(あなた自身)
   - `user_roles`(`owner`ロール付与)
   - `tenant_accounting_settings`(既定値: 端数処理=floor)
4. 成功するとそのままログイン状態になる(アクセストークン・リフレッシュトークンが発行される)。

以降、勘定科目・税区分・取引先・銀行口座・給与CSVマッピング等のマスタは、**設定画面またはAPI経由で自分のテナント内に作成していく**(初期状態でマスタは空)。マスタ作成の実例(勘定科目・税区分・費目カテゴリ・取引先・給与マッピング等を一通り作成する完全な手順)は `backend/src/scripts/simulate-100-users-year.ts` のフェーズ1〜11を参照すると、実際に動くコードとして再現できる。

### 6.1 会計年度・会計期間の作成に関する注意

`fiscal-periods`モジュールは**参照専用**であり、会計年度(`fiscal_years`)・会計期間(`fiscal_periods`)を作成するAPIが存在しない(意図的なギャップ、`04_technical_reference.md` 3.7節参照)。減価償却バッチ(`fixed-assets`)やレポートの期間指定機能を使う場合は、直接SQLで作成する必要がある:

```sql
INSERT INTO fiscal_years (id, tenant_id, start_date, end_date, status)
VALUES (gen_random_uuid(), '<tenant_id>', '2025-04-01', '2026-03-31', 'open');

-- 12ヶ月分。start_date/end_dateは月初〜月末、period_noは1〜12
INSERT INTO fiscal_periods (id, tenant_id, fiscal_year_id, period_no, start_date, end_date, status)
VALUES (gen_random_uuid(), '<tenant_id>', '<fiscal_year_id>', 1, '2025-04-01', '2025-04-30', 'open');
-- ... period_no=2〜12を繰り返す
```

このINSERTはRLS対象テーブルへの書き込みのため、`app_runtime`ロールで、かつ`app.current_tenant_id`をセットしたトランザクション内で実行する必要がある(アプリ経由でなく直接`psql`で行う場合は、代わりにNestJSの`DatabaseService`経由のスクリプトを書くか、`FORCE ROW LEVEL SECURITY`の制約を踏まえた上で`postgres`スーパーユーザーで実行する)。

---

## 7. サンプルデータ投入(統合シミュレーションスクリプト)

動作確認・デモ・負荷検証用に、100名規模のテナントを1年分(12ヶ月)フル稼働させるスタンドアロンスクリプトが用意されている。

```bash
cd backend
npx ts-node src/scripts/simulate-100-users-year.ts
```

このスクリプトは実行のたびに**新規テナントを作成**する(既存データを壊さない)。内部でNestJSの`NestFactory.createApplicationContext(AppModule)`を使い、HTTPを経由せず実サービス層(認証・RLS・DBトリガーを含む本番と同一コードパス)を直接呼び出して以下を行う:

- テナント・101名分のユーザー(役員3・経理4・社員93・外部監査1)の作成
- 勘定科目・税区分・費目カテゴリ・取引先・銀行口座・承認ルール・給与CSVマッピングの作成
- 12ヶ月分の経費申請(月150〜200件)・売上請求書(発行/Void/入金消込)・仕入請求書(銀行明細CSV消込込み)・給与連携・固定資産減価償却の生成
- 11月に税理士向け時限外部アクセスのシミュレーション(RLS制限の実地検証込み)
- 3月末の決算整理仕訳(貸倒引当金・法人税等見積)・消費税申告データ計算
- 最終的にBS/PL/CFの1円単位整合性を検証し、`simulation-report.json`(リポジトリルート)へ結果を出力

### 7.1 実行パラメータ

| 環境変数 | 既定値 | 用途 |
|---|---|---|
| `SIM_SCALE` | `1` | 月次件数のスケール係数。`0.05`等に下げると数秒〜十数秒で完走するスモークテストになる |
| `SIM_MONTHS` | `12` | 処理する月数(先頭から)。`1`にすると初月のみで動作確認できる |

```bash
# 数秒で終わる動作確認
SIM_SCALE=0.02 SIM_MONTHS=1 npx ts-node src/scripts/simulate-100-users-year.ts

# フル実行(実測: 約3分、journal_entries約4,000件生成)
npx ts-node src/scripts/simulate-100-users-year.ts
```

実行完了後、標準出力とレポートJSONの `reconciliation.allPass` が `true` であることを確認する。`false`または`errorCount > 0`の場合は`errors`配列に失敗フェーズと内容が記録される。

### 7.2 データのリセット

同スクリプトは新規テナントを毎回作るため既存データを破壊しないが、検証を繰り返す際にDBをまっさらに戻したい場合は、**`postgres`スーパーユーザーで**(`app_runtime`はRLS制約でTRUNCATE権限を持たない)以下を実行する:

```bash
docker compose exec postgres psql -U postgres -d keiri_kaikei -c "TRUNCATE tenants CASCADE; TRUNCATE users CASCADE;"
```

`users`はテナントに直接のFKを持たないグローバル表のため、`tenants`のCASCADEだけでは削除されない点に注意(`tenant_users`経由の間接的な関連のみ)。両方のTRUNCATEが必要。

---

## 8. 本番相当環境への展開に向けた考慮事項

このリポジトリには本番用Dockerfile/CI設定は含まれていない(開発リポジトリの範囲)。実際に展開する場合の指針:

### 8.1 ビルド

```bash
cd backend && npm run build   # dist/ に出力、`node dist/main.js` で起動
cd frontend && npm run build  # dist/ に静的アセットを出力(任意の静的ホスティングへ配置)
```

### 8.2 必須の本番前チェックリスト

- [ ] `app_runtime` / `app_readonly_external` のDBパスワードを既定値から変更(3.4節)
- [ ] `JWT_SECRET` をシークレットマネージャ経由の強力なランダム値に変更
- [ ] `SETTINGS_ENCRYPTION_KEY` を32バイトのランダム鍵に変更(既存の暗号化済みAPIキーがある場合は鍵変更で復号不能になるため、切替時は再設定が必要)
- [ ] `CORS_ORIGIN` を実際のフロントエンドドメインに限定(空/未設定のままだと全オリジン拒否になり、逆に接続不能になる点にも注意)
- [ ] `JWT_EXPIRES_IN` を運用要件に応じて短縮(既知の制約: ログアウト即時失効非対応)
- [ ] PostgreSQLへの接続はTLS終端・プライベートネットワーク経由を推奨(DATABASE_URLに`sslmode=require`等を付与)
- [ ] `PG_POOL_MAX` をAPIサーバーの想定同時実行数に合わせて調整
- [ ] `frontend`の`VITE_API_BASE_URL`を本番APIのURLに設定してビルド

### 8.3 バックアップ

`journal_entries`等はDBトリガーで追記専用が保証されるため、**論理的な改ざん耐性はDB自体に備わっている**が、物理障害対策としての通常のPostgreSQLバックアップ(`pg_dump`/WALアーカイブ等)は別途運用で用意すること。

---

## 9. トラブルシューティング

本書の手順を実際に一からやり直して検証する過程で遭遇した問題とその対処。

| 症状 | 原因 | 対処 |
|---|---|---|
| `docker ps` が `dockerDesktopLinuxEngine` 系のエラーを返す | Docker Desktopのデーモンが起動していない(Windows) | Docker Desktopアプリを起動し10〜20秒待つ。`docker-compose.yml`の`restart: unless-stopped`により既存コンテナは自動再開する |
| `db.query()`でテナント固有テーブルを検索すると常に0件になる | `FORCE ROW LEVEL SECURITY`が有効なテーブルに対し、RLSコンテキスト(`app.current_tenant_id`)を設定しない`db.query()`エスケープハッチを使っている | `db.transaction(tenantId, userId, cb)`でラップする(`04_technical_reference.md` 3.2節) |
| `users`テーブルへの管理者代理INSERTが `new row violates row-level security policy` で失敗する | `users`のRLS `WITH CHECK`は`id = fn_current_user_id()`(自己registration専用) | 対象ユーザー自身の新規生成IDをRLSコンテキストの`userId`として設定したトランザクション内でINSERTする |
| `postgres`スーパーユーザーで`TRUNCATE`しようとすると`permission denied for table ...` | node-postgresの`Client`/`Pool`設定で`connectionString`と個別の`user`/`password`等を同時に渡すと、実装によっては`connectionString`側の認証情報が優先され、意図したロールで接続できていない | `postgresql://postgres:postgres@localhost:5432/keiri_kaikei`のように**単一のconnectionStringとして**明示的に指定する |
| 経費申請を大量並行処理すると `deadlock detected` (`40P01`) が発生する | 行ロック(FK参照)とアドバイザリロック(採番)の組み合わせにより高負荷時に理論上発生しうる。本アプリでは`DatabaseService`が自動リトライ(最大4回)する実装になっている | 通常は自動解消される。それでも頻発する場合はAPIサーバーの水平スケールよりも先に、同一テナント・同一日付への書き込み集中度(採番ロックの粒度)を見直す |
| `npm run lint` が実行できない/コマンドが見つからないと表示される | 環境によって`eslint`が未インストールの場合がある | `npm run typecheck`で代替可能(型検査は必須要件、lintは補助的品質ゲート) |
| フロントエンドから叩くとCORSエラーになる | `CORS_ORIGIN`が未設定(fail-closed設計により空配列=全拒否になる) | `backend/.env`の`CORS_ORIGIN`にフロントエンドのオリジンを設定してAPIサーバーを再起動 |
| 大量データ投入後にレポート系APIが遅い | (本アプリでは実測上、journal_entries約4,000件・経費申請約2,000件の規模でTB/PL/BS/CFいずれも100ms未満で応答することを確認済み。この規模で顕著に遅い場合は`accounts`/`journal_entry_lines`の想定インデックスが欠落していないか`\d journal_entry_lines`等で確認) | `03_database_design.md` 4章の主要インデックス一覧と照合する |

---

## 10. 動作確認チェックリスト(まとめ)

新規環境構築後、以下を上から順に実行して全て成功すれば導入完了とみなせる。

```bash
# 1. DB起動
docker compose up -d
docker compose ps   # healthy確認

# 2. スキーマ適用
docker compose exec -T postgres psql -U postgres -d keiri_kaikei < sql/001_initial_schema_all_in_one.sql

# 3. (任意)スキーマ検証
python3 scripts/verify_schema.py --dsn "postgresql://postgres:postgres@localhost:5432/keiri_kaikei"

# 4. バックエンド
cd backend
cp .env.example .env
npm install
npm run typecheck
npm run start:dev &   # 別ターミナル推奨

# 5. フロントエンド
cd ../frontend
npm install
npm run typecheck
npm run dev &         # 別ターミナル推奨

# 6. ブラウザで http://localhost:5173 を開きサインアップ

# 7. (任意)サンプルデータで総合動作確認
cd ../backend
SIM_SCALE=0.05 SIM_MONTHS=2 npx ts-node src/scripts/simulate-100-users-year.ts
```
