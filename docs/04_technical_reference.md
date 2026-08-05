# 経理・会計オールインワンAIアプリケーション 詳細技術書(実装リファレンス)

- 文書番号: DOC-04
- バージョン: 1.0.0
- 位置づけ: `01_requirements.md` / `02_architecture.md` / `03_database_design.md` は**設計時点の構想**を記した文書である。本書は実際に実装されたコードベース(`backend/`, `frontend/`, `sql/`)を精査して作成した**as-built(実装済み実態)のリファレンス**であり、設計書との差分がある箇所は明記する。
- 関連文書: `01_requirements.md`, `02_architecture.md`, `03_database_design.md`, `openapi.yaml`, `05_deployment_guide.md`

---

## 0. 設計書との主な差分(先に把握すべき事項)

`02_architecture.md` は「AIゲートウェイサービス」「バッチワーカー」「ジョブキュー」を独立コンポーネントとして描いているが、実装は**単一のNestJSモノリス**である。

| 設計書の記述 | 実装の実態 |
|---|---|
| AIゲートウェイサービス(独立プロセス) | `backend/src/modules/ai-suggestions/`・`expense-reports/receipt-ocr-extraction.service.ts` として同一NestJSプロセス内のモジュール。別プロセス化されていない |
| 勘定科目候補提案(pgvector類似検索) | **実LLM API呼び出しではなく、文字n-gramハッシュによる決定論的な疑似埋め込み**(`ai-suggestions/embedding.ts`)。外部AI課金・レイテンシなしで`journal_entry_embeddings`をpgvectorのコサイン距離で検索する仕組みのみ実装済み |
| レシートOCR(Vision AI) | `receipt-ocr-extraction.service.ts` が実際にAnthropic/OpenAI/Gemini各SDKを呼び出す(テナント設定でプロバイダ選択・APIキーはAES-256-GCM暗号化保存)。**ここは設計書通り実LLM連携** |
| バッチワーカー(非同期ジョブキュー) | ジョブキューは存在しない。減価償却バッチ・給与取込等はすべて**同期API呼び出し**(`POST /fixed-assets/depreciation-runs`等)として実装。呼び出し元(手動操作 or 外部スケジューラ)が能動的に叩く設計 |
| モバイルアプリ | 未実装。フロントエンドはSPA(React)のみ |
| オブジェクトストレージ(WORM) | `attachments`テーブルへの物理ファイル保存先(`storage_path`)はスキーマ上定義されているが、実際のアップロード先ストレージ実装(S3等)は本リポジトリのスコープ外(`multer`によるメモリ/ディスク受信までを実装範囲としている) |
| 全銀協FBデータ・e-Tax連携 | `payment_batches`／`payment_batch_items`テーブルとAPIモジュールは存在するが、固定長フォーマット生成の詳細実装は`payment-batches`モジュール実装時点のスコープを確認すること(本書執筆時点でコアの会計/経費/請求/給与/資産/税務/監査機能が優先実装されている) |

---

## 1. 技術スタック(実装ベース)

### 1.1 バックエンド

| 分類 | 技術 | 備考 |
|---|---|---|
| ランタイム | Node.js ≥20 | `package.json` `engines.node` |
| 言語 | TypeScript 5.5 (strict) | `tsconfig.json`: `strict: true`, `strictNullChecks: true`, `noImplicitAny: true` |
| フレームワーク | NestJS 10 | `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` |
| DBアクセス | `pg`(node-postgres) 8.x | ORM不使用、生SQL駆動(理由は`02_architecture.md` 4.2節) |
| 認証 | `@nestjs/jwt` + Node標準`crypto.scrypt` | パスワードは`scrypt`で`<saltHex>:<keyHex>`形式(bcrypt非依存) |
| バリデーション | `zod` 3.x | 各モジュール`dto/*.schemas.ts`でリクエストスキーマ定義 |
| セキュリティヘッダー | `helmet` | `main.ts`でグローバル適用 |
| AI SDK | `@anthropic-ai/sdk` | OCR機能でAnthropic/OpenAI/Gemini各APIを選択利用(テナント設定) |
| ベクトル検索 | PostgreSQL `pgvector`拡張 | `journal_entry_embeddings.embedding vector(1536)` |
| テスト | Jest + `ts-jest` | `npm test` |
| Lint | ESLint | `npm run lint`(実行環境によっては要インストール確認) |
| 型生成 | `openapi-typescript` | `openapi.yaml` → `src/types/api.generated.ts` |

### 1.2 フロントエンド

| 分類 | 技術 | 備考 |
|---|---|---|
| フレームワーク | React 19 | 関数コンポーネント + Hooks |
| ビルドツール | Vite 8 | `vite.config.ts`で`/v1`を開発時バックエンドへプロキシ |
| 言語 | TypeScript 5.9 | |
| ルーティング | React Router 7 | `src/routes/` |
| サーバー状態管理 | TanStack Query (React Query) v5 | クエリキー階層 `[RESOURCE, 'list'\|'detail', params]` |
| クライアント状態管理 | Zustand 5 | `src/stores/authStore.ts` 等 |
| HTTPクライアント | axios | `src/lib/apiClient.ts`、POSTへの`Idempotency-Key`自動付与、エラー正規化 |
| スタイリング | Tailwind CSS 3 | `tailwind-merge`, `clsx`併用 |
| アイコン | lucide-react | |

### 1.3 データベース・インフラ

| 分類 | 技術 |
|---|---|
| DBMS | PostgreSQL 16(`pgvector/pgvector:pg16`イメージ、`docker-compose.yml`) |
| スキーマ管理 | 単一の全部入りSQLファイル `sql/001_initial_schema_all_in_one.sql`(マイグレーションツール未導入。将来複数ファイル化する場合は`00N_*.sql`を追加する規約) |
| ローカルDB起動 | Docker Compose(`postgres`サービスのみ。アプリ本体はコンテナ化されていない) |

---

## 2. リポジトリ構成

```
keiri-kaikei/
├── backend/                  NestJS API サーバー
│   ├── src/
│   │   ├── main.ts           エントリポイント(port 3000, prefix /v1)
│   │   ├── app.module.ts     ルートモジュール(全28業務モジュールをimport)
│   │   ├── common/           横断的関心事(下記2.1)
│   │   ├── database/         DatabaseService(RLSコンテキスト管理)
│   │   ├── modules/          業務モジュール(1機能=1ディレクトリ)
│   │   ├── scripts/          運用・検証用スタンドアロンスクリプト
│   │   └── types/            openapi.yamlから自動生成された型
│   └── package.json
├── frontend/                 React SPA
│   └── src/
│       ├── pages/             業務モジュールごとのページ(backendのmodules/と1:1対応)
│       ├── components/        共通UI(layout/ui)
│       ├── stores/             Zustand(認証状態等)
│       ├── lib/                 apiClient・queryClient・汎用util
│       └── routes/              ルーティング定義
├── sql/001_initial_schema_all_in_one.sql   全DBスキーマ(DDL+トリガー+RLS+ロール)
├── docs/                      設計文書一式(本書含む)
├── scripts/                   DB検証(Python)・SQLシードスクリプト
└── docker-compose.yml         PostgreSQL(pgvector)コンテナ定義
```

### 2.1 `backend/src/common/` の主要コンポーネント

| ファイル | 役割 |
|---|---|
| `exceptions/app.exception.ts` | `AppException`(業務エラー用の標準例外)。`badRequest`/`unauthorized`/`forbidden`/`tenantMismatch`/`notFound`/`conflict`の静的ファクトリを提供 |
| `filters/http-exception.filter.ts` | 全例外を`{success:false, error:{code,message,details}, meta:{request_id}}`へ変換するグローバルフィルタ。5xxはスタックトレースをログのみに出力しレスポンスには含めない |
| `errors/pg-error-mapper.ts` | PostgreSQLのDBエラー(制約違反・トリガー例外)をアプリのエラーコードへマッピング |
| `guards/jwt-auth.guard.ts` / `tenant-auth.guard.ts` | JWT検証 + `X-Tenant-ID`ヘッダーとJWT内`tenant_id`の一致検証 |
| `guards/external-access.guard.ts` | `viewer_external`ロール向け時限アクセスガード。`db.transactionAsRole('app_readonly_external', ...)`でDBロールごと降格させる |
| `middleware/tenant-context.middleware.ts` | `RequestContext`(AsyncLocalStorage)へリクエストごとのtenantId/userId/requestId/ipAddressを設定 |
| `context/request-context.ts` | リクエストスコープの値をバケツリレーせずに参照するための`AsyncLocalStorage`ラッパー。**リクエストスコープ外(スタンドアロンスクリプト等)で呼ぶと`undefined`を安全に返す** |
| `security/password.ts` | `scrypt`によるパスワードハッシュ化・検証(タイミング攻撃対策込み) |
| `security/secret-encryption.ts` | AES-256-GCMによるAI APIキー等の暗号化保存 |
| `database/advisory-lock.ts` | `pg_advisory_xact_lock(hashtextextended(key,0))`によるトランザクションスコープの排他ロック共通ヘルパー |
| `journal/generate-entry-no.ts` | 仕訳番号`JE-{YYYYMMDD}-{4桁連番}`のテナント×日付単位採番(アドバイザリロックで直列化) |
| `csv/parse-csv.ts` | 銀行明細・給与CSVの共通パーサ |
| `http/upload-limits.ts` | アップロードファイルサイズ上限の定数(OCR画像15MB、CSV 10MB、添付ファイル20MB) |

---

## 3. バックエンドアーキテクチャ

### 3.1 レイヤー構成

各業務モジュールは NestJS の標準的な3層構成を取る。

```
Controller (HTTPリクエスト/レスポンス、DTOバリデーション)
    ↓
Service (トランザクション境界、生SQL、ビジネスルール)
    ↓
DatabaseService.transaction() → pg.PoolClient (生SQL実行)
```

ORMのRepositoryパターンは存在しない。全SQLは各`*.service.ts`内に文字列リテラルとして直接記述される(`03_database_design.md` 4.2節で述べた設計判断)。

### 3.2 `DatabaseService` — RLSコンテキスト管理の中核

`backend/src/database/database.service.ts` が提供する3つのAPI:

| メソッド | 用途 | RLSコンテキスト |
|---|---|---|
| `transaction(tenantId, userId, callback)` | **通常のAPI呼び出しの標準パターン**。`BEGIN`後に`SELECT set_config('app.current_tenant_id', $1, true)`等を実行し、callback完了で`COMMIT`、例外で`ROLLBACK` | tenantId/userIdをセット(nullなら未設定=fail-closedで0件) |
| `transactionAsRole(role, tenantId, userId, callback)` | 外部監査人(`app_readonly_external`)等、DBロール自体を降格させたい場合 | `SET LOCAL ROLE {role}`後に同様にset_config |
| `query(text, params)` | RLS非依存の低レベルエスケープハッチ。`roles`/`permissions`等グローバルマスタや、認証確立前の`fn_authenticate_user_by_email()`呼び出し専用 | 未設定 |

**重要な罠(このセッションで実際に踏んだ問題)**: `users`・`tenant_users`など`FORCE ROW LEVEL SECURITY`が付与されたテナント固有テーブルに対して`db.query()`(コンテキスト無し)を呼ぶと、**例外にならず黙って0件が返る**(fail-closed設計)。集計・検証用のアドホックなSQLを書く際は必ず`db.transaction(tenantId, userId, ...)`でラップすること。特に`users`テーブルはRLSの`WITH CHECK`が`id = fn_current_user_id()`(=自分自身の行のみ挿入可能)という**自己registration専用**の制約になっているため、管理者が他ユーザーを代理作成する処理を書く場合は、対象ユーザー自身のIDをRLSコンテキストの`userId`に設定してからINSERTする必要がある(`auth.service.ts`の`signup()`/`acceptInvite()`と同じパターン)。

### 3.3 デッドロック自動リトライ

行ロック(FK参照時の`FOR KEY SHARE`)とアドバイザリロック(採番)を併用する設計上、書き込みが特定の勘定科目・特定の日付キーに集中すると PostgreSQL のデッドロック検出(エラーコード`40P01`)が発生しうる。`DatabaseService.transaction()`/`transactionAsRole()`は共通境界で**最大4回まで自動リトライ**(20ms×試行回数+ジッターのバックオフ)する設計になっている(`runWithDeadlockRetry`)。呼び出し側でリトライ処理を書く必要はない。

> 検証実績: 100名規模・月150〜200件の経費申請を並行処理するシミュレーションで、リトライ導入前は99件のデッドロックがそのままAPIエラーとしてユーザーに露出していたが、導入後は0件に解消(`docs/05_deployment_guide.md` 9章参照)。

### 3.4 認証・認可

| 項目 | 実装 |
|---|---|
| ログイン | `POST /v1/auth/login` → パスワード照合 → MFA有効なら`mfa_token`発行、無効ならJWT(`access_token`)+リフレッシュトークン発行 |
| JWTペイロード | `sub`(userId), `tenant_id`, `roles`, `iat`, `exp`(既定`JWT_EXPIRES_IN=1h`) |
| リフレッシュトークン | 生トークンはSHA-256ハッシュのみDB保存(`refresh_tokens.token_hash`)。ログアウトで`revoked_at`を設定 |
| テナント境界検証 | `TenantAuthGuard`がJWT内`tenant_id`とリクエストの`X-Tenant-ID`ヘッダーの一致を検証。不一致・越境アクセスは404/403 |
| ロールモデル | `role_code_enum`: `owner, accounting_manager, accountant, approver, employee, payroll_admin, viewer_external, system_service`(全テナント共通の固定enum。テナント別カスタムロールは無し) |
| 招待フロー | `SettingsService.createInvitation()`(トークンはハッシュのみ保存)→`AuthService.acceptInvite()` |
| 外部監査アクセス | `external_access_grants`テーブル(`valid_from`/`valid_until`/`can_export`)。`viewer_external`ロール保持者にのみ発行可能。`ExternalAccessGuard`が`db.transactionAsRole('app_readonly_external', ...)`でDBロールごと降格させ、**RLSのRESTRICTIVEポリシーがDB層で強制的に読み取り専用・期限内のみへ制限**する(アプリ層のバグに依存しない多層防御) |
| ログアウト時の即時失効に関する既知の制約 | アクセストークン(JWT)はステートレスなため、`JWT_EXPIRES_IN`(既定1時間)が経過するまで理論上有効。メンバー無効化(`is_active=false`)・ログアウトは新規リクエストの認可を阻止するが、既発行トークンの即時失効機構(ブラックリスト等)は未実装。本番運用では`JWT_EXPIRES_IN`を短めに設定し、リフレッシュトークンのローテーションで実質的な失効を早める運用を推奨 |

### 3.5 並行処理制御パターン一覧

| パターン | 用途 | 実装箇所の例 |
|---|---|---|
| `SELECT ... FOR UPDATE` | 状態遷移の直列化(二重発行・二重確定防止) | `invoices.issue()`, `journal-entries.post()`/`addLine()`, `bank-transactions`のCAS処理 |
| `pg_advisory_xact_lock` | 「同一キーへのcheck-then-act」の直列化(採番、AI提案の二重判定防止) | `generate-entry-no.ts`, `invoices.generateInvoiceNo/generateCreditNoteNo`, `expense-reports.generateReportNo`, `ai-suggestions.lockDecisionGroup` |
| CAS UPDATE(compare-and-swap) | 銀行明細の消込クレーム(`match_status: unmatched→manually_matched`をWHERE句付きUPDATEで奪い合う) | `bank-transactions.claimForMatch()` |
| DBトリガーによる最終防御 | 貸借不一致・追記専用違反・自己承認をアプリ層のバグに依存せず阻止 | `fn_check_journal_balance`, `fn_prevent_update_delete`, `fn_prevent_self_approval`, `fn_guard_journal_entry_transition` |

### 3.6 append-only(追記専用)設計

以下のテーブルはDBトリガーによりUPDATE/DELETEが物理的に禁止されている(訂正は「反対仕訳」または「新規追記」で表現する):

- `journal_entries` / `journal_entry_lines`(`posted`後。`draft`のうちは変更可)
- `audit_logs`, `ai_suggestions`, `attachments`, `payments`, `credit_notes`, `invoice_payments`, `vendor_bill_payments`, `consumption_tax_return_lines`

`ai_suggestions`の accept/reject は既存行を書き換えず、**同一`(target_type, target_id, suggestion_type)`をキーとする新しい行を追記**することで判定確定を表現する(`ai-suggestions.service.ts`のクラス doc コメント参照)。

### 3.7 モジュール一覧(28モジュール)

| モジュール | 主要責務 | 特記事項 |
|---|---|---|
| `auth` | signup/login/MFA/招待受諾/ログアウト | パスワードはscrypt、テナント作成はsignup時のみ |
| `tenants` | テナント情報参照 | 作成はauth.signup経由のみ(専用create APIなし) |
| `users` | ユーザー参照 | |
| `settings` | テナント設定・会計設定(端数処理ルール)・AI連携設定・メンバー招待/権限管理 | AI APIキーはAES-256-GCM暗号化保存 |
| `accounts` | 勘定科目マスタCRUD | |
| `account-categories` | (`accounts`のcategory_idが参照するBS/PL区分) | 専用CRUD APIは無く、他モジュール経由で直接INSERTする運用 |
| `tax-categories` | 税区分マスタ(税率・軽減税率フラグ) | |
| `expense-categories` | 経費科目マスタ | **参照専用(list)のみ実装**。作成は直接SQL |
| `departments` | 部門マスタ | |
| `fiscal-periods` | 会計年度・会計期間参照 | **作成APIは無く、直接SQL**(意図的なギャップ。`05_deployment_guide.md`参照) |
| `journal-entries` | 仕訳の作成・追加行・確定(post)・Void・Reverse | `FOR UPDATE`でaddLine/postを直列化 |
| `expense-reports` | 経費精算申請・承認/却下・AI提案連動 | 起票日は明細の支出日ベース(本セッションで修正) |
| `invoices` | 売上請求書の作成・発行・入金消込・Void(24h)・クレジットノート | `issue()`は`FOR UPDATE`で二重発行防止 |
| `customers` | 得意先マスタ | |
| `vendors` | 仕入先マスタ(銀行口座情報含む) | |
| `vendor-bills` | 仕入請求書の作成・提出(承認ルール0件なら即approved)・支払消込 | |
| `bank-accounts` | 銀行口座マスタ(GL勘定との紐付け`linked_account_id`) | |
| `bank-transactions` | 銀行明細CSV取込・自動ルールマッチング・手動消込・AI提案 | CAS方式で二重消込を防止 |
| `auto-journal-rules` | 銀行明細の自動仕訳ルール(パターンマッチ) | |
| `payroll-import-mappings` | 給与CSV列マッピング設定のCRUD | openapi.yamlに元々無かったが、`payroll-imports`が動作するために追加実装 |
| `payroll-imports` | 給与CSV取込→複合仕訳自動生成→確定(accounting_manager限定) | 貸借一致は`payroll_import_lines`のCHECK制約で構造的に保証 |
| `fixed-assets` | 固定資産登録・除却/売却・月次減価償却バッチ | `runDepreciation`は`depreciation_schedules`のUNIQUE制約で冪等 |
| `approval-requests` | 汎用承認ワークフロー(承認/却下) | 承認者は`approval_rules`で厳格に検証(本セッションで権限昇格バグを修正) |
| `consumption-tax-returns` | 消費税申告データ計算(本則/簡易/2割特例) | 仕訳から自動集計。追記専用ログ設計 |
| `ai-suggestions` | 勘定科目提案・OCR結果保存・accept/reject | pgvectorの疑似埋め込み類似検索 |
| `attachments` | 証憑ファイルのメタデータ管理(電帳法対応) | |
| `external-access-grants` | 税理士・監査人向け時限アクセス許可の発行 | |
| `audit-logs` | 監査ログの記録(`record()`)・検索(`list()`) | 追記専用 |
| `payment-batches` | 支払バッチ管理 | |
| `reports` | 試算表(TB)/損益計算書(PL)/貸借対照表(BS)/キャッシュフロー計算書(CF) | BSは決算振替仕訳無しで「当期純利益(未処分)」を純資産区分に自動計上し恒等式を成立させる設計 |

---

## 4. フロントエンドアーキテクチャ

### 4.1 ディレクトリと責務

```
frontend/src/
├── pages/<module>/
│   ├── <Module>ListPage.tsx / <Module>FormPage.tsx / <Module>DetailPage.tsx
│   ├── hooks.ts        useQuery/useMutation ラッパー(キャッシュ無効化ロジックを集約)
│   ├── api.ts           axios呼び出し関数
│   └── types.ts          型(api.generated.tsを再エクスポート/拡張)
├── components/layout/    共通レイアウト(ナビゲーション等)
├── components/ui/        汎用UIコンポーネント
├── stores/authStore.ts   Zustand: アクセストークン・現在のテナントID等
├── lib/apiClient.ts       axiosインスタンス、Idempotency-Key付与、エラー正規化
├── lib/queryClient.ts     TanStack QueryClientの生成設定
└── routes/                ルーティング定義(pages/を束ねる)
```

`pages/`配下は`backend/src/modules/`と1対1でほぼ対応しており、バックエンドの機能追加時はフロントエンドの対応ディレクトリを確認すれば影響範囲が把握しやすい構成になっている。

### 4.2 状態管理の設計方針

- **サーバー状態は必ずTanStack Query経由**。コンポーネントでの直接`fetch`/`axios`呼び出しは行わない。
- クエリキーは`[RESOURCE_KEY, 'list', params]` / `[RESOURCE_KEY, 'detail', id]`の階層構造。
- ミューテーション成功時は影響を受ける**全てのクエリキーを`invalidateQueries`する**方針(片手落ちのキャッシュ無効化は「保存したのに古い画面が残る」バグの温床になるため、本セッションの監査でも複数箇所修正した)。特に承認・仕訳確定・Voidのような**複数リソースへ波及するアクション**では、対象自身のキーに加えて`reports`(財務諸表)・`ai-suggestions`・関連先(`journal-entries`等)のキーも横断的に無効化する。
- 二重送信防止は`useMutation().isPending`を各アクションボタンの`disabled`に必ずバインドする(ネットワーク遅延時の連打によるビジネスロジック二重実行を防止)。

### 4.3 `authStore`(Zustand)の注意点

signup/招待受諾フローでは、`setSession()`(トークン保存)後に**`setCurrentTenant()`を明示的に呼ぶ必要がある**(自動連動しない設計)。呼び忘れるとログイン直後の画面でテナントコンテキストが古いまま(または未設定)になるバグが過去に発生している。新規のログイン系フローを実装する際は必ずこの2段階を意識すること。

---

## 5. データベース設計の実装確認事項

`03_database_design.md`の設計に対し、実装時点で確認できた具体的な運用パラメータを補足する。

### 5.1 DBロール構成(実装値)

`sql/001_initial_schema_all_in_one.sql` 末尾(1570行目付近)でスキーマ適用時に自動作成される:

| ロール | 権限 | 既定パスワード(要変更) |
|---|---|---|
| `app_runtime` | 全テーブルSELECT/INSERT/UPDATE/DELETE(RLSポリシー適用下)。アプリのコネクションプールが常時これでログインする | `change_me_in_production` |
| `app_readonly_external` | 全テーブルSELECTのみ。`app_runtime`から`SET LOCAL ROLE`で降格して使う(`GRANT app_readonly_external TO app_runtime`により降格自体は許可されているが、権限は`app_runtime`の真部分集合なので昇格経路にはならない) | `change_me_in_production` |

このロールを実際に作成するのは**スキーマ適用スクリプト自身**(`postgres`スーパーユーザーで`psql -f sql/001_initial_schema_all_in_one.sql`を実行する前提)。アプリの`.env`の`PGUSER=app_runtime`等はこのロールを指す。

### 5.2 `FORCE ROW LEVEL SECURITY`の対象テーブル

`tenants`を含む主要業務テーブル群(約50テーブル)と、個別ポリシーを持つ`users`/`user_roles`はいずれも`FORCE ROW LEVEL SECURITY`が有効。**テーブルオーナー(`postgres`)であってもRLSを迂回できない**設計であるため、開発時にテストデータを直接SQLでいじる場合は`postgres`ロールで接続しても0件しか見えない/操作できないケースがある(TRUNCATE等のDDL特権操作自体はテーブルオーナー権限で可能。SELECT/DML的操作はRLS適用)。`app_runtime`ロールもRLS適用対象であり`BYPASSRLS`属性を持たない。

### 5.3 グローバル(RLS非適用)テーブル

`roles`, `permissions`, `role_permissions`は全テナント共通のマスタデータのためRLS非適用。`refresh_tokens`もテナントに依存しない認証専用テーブルのためRLS非適用(コメント参照: ログイン処理自体がテナントコンテキスト確立前に実行されるため)。

---

## 6. 本セッションまでに発見・修正した既知の課題(技術的負債台帳)

過去2回のハードニング作業で発見し、**修正済み**の項目:

| # | 分類 | 内容 | 修正箇所 |
|---|---|---|---|
| 1 | セキュリティ | 承認依頼(expense_report)を割り当てられていない第三者が承認/却下できた(権限昇格) | `approval-requests.service.ts`, `expense-reports.service.ts` に`assertAssignedApprover`追加 |
| 2 | データ整合性 | 銀行明細の消込が未ロックで二重入金計上されうる | `bank-transactions.service.ts` にCAS方式のclaim/release実装 |
| 3 | データ整合性 | 請求書`issue()`の二重発行レース | `FOR UPDATE`追加 |
| 4 | 並行性 | 採番(`entry_no`/`invoice_no`/`credit_note_no`/`report_no`)がCOUNT+1の素朴な実装で競合しうる | 共有`advisory-lock.ts`で直列化 |
| 5 | 並行性 | `journal_entry_lines`の`addLine()`と`post()`間のTOCTOU | `FOR UPDATE`追加 |
| 6 | データ整合性 | 固定資産減価償却バッチがdraft仕訳のまま`accumulated_depreciation`だけ先に加算し、GLとキャッシュ値がドリフトしうる | バッチ内で即時posted確定するよう変更 |
| 7 | 可用性 | アップロードエンドポイントにファイルサイズ上限が無くメモリ枯渇リスク | `upload-limits.ts` + 各コントローラへ`multer`制限追加 |
| 8 | 可用性/セキュリティ | Anthropic OCR呼び出しにタイムアウト未設定(デフォルト10分+リトライ)でDBコネクションプールを長時間占有しうる | タイムアウト設定 + AI呼び出しをDBトランザクション外へ分離 |
| 9 | 並行性 | AI提案のaccept/reject二重判定レース | アドバイザリロックで直列化 |
| 10 | セキュリティ | `CORS_ORIGIN`未設定時に全オリジン許可へフォールバックする設計 | fail-closed(空配列)に変更 |
| 11 | 会計精度 | 経費精算の仕訳日・申請番号がサーバー実時刻固定で、過去日付の経費が処理実行日のPLに計上されてしまう | 明細の支出日ベースに変更 |
| 12 | AI/UX | AI提案が費目カテゴリに紐付かない科目(役員報酬・減価償却費等)を提案し、accept時に失敗する「受理不能な提案」を生成しうる | 候補を費目カテゴリ経由で到達可能な科目のみへ絞り込み |
| 13 | 並行性 | 高負荷時のデッドロック(`40P01`)がそのままAPIエラーになる | `DatabaseService`共通境界で自動リトライ実装 |

**未修正・既知のトレードオフとして残っている項目**(影響が限定的、または設計判断が必要なため意図的に見送り):

- ログアウト/メンバー無効化がJWT即時失効を保証しない(3.4節参照)
- テナント設定`rounding_rule`(floor/ceil/round)が保存はされるが、実際の税額計算箇所(invoices/vendor-bills/consumption-tax-returns)で参照されず全箇所floor固定
- アップロードファイルのMIME検証がクライアント申告のContent-Typeのみ(マジックバイト未検証)
- Zengin(全銀協)固定長フォーマットの実出力ロジックの実装範囲は要個別確認

---

## 7. テスト・検証資産

| 資産 | 用途 |
|---|---|
| `scripts/verify_schema.py` | Docker上に使い捨てPostgreSQLを起動し、RLS分離・貸借チェック・追記専用・24h Void・自己承認禁止・外部時限アクセスをpsycopg2で自動検証 |
| `scripts/seed_*.sql` | 開発時の手動確認用の簡易シードSQL(経費/請求書/仕入請求書/レポート) |
| `backend/src/scripts/simulate-100-users-year.ts` | 100名規模テナントの1年分(12ヶ月)フル業務フローを実サービス層経由で生成する統合シミュレーションスクリプト。BS/PL/CFの1円単位整合性検証込み。詳細は`05_deployment_guide.md` 9章 |
| `backend/test/`(Jest) | ユニット/統合テスト(`npm test`) |

---

## 8. API仕様

REST APIの正式なスキーマ定義は `docs/openapi.yaml` を正とする。全エンドポイントは `/v1` プレフィックス配下。エラーレスポンスは共通エンベロープ:

```json
{
  "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [] },
  "meta": { "request_id": "..." }
}
```

副作用を伴うPOST操作には`Idempotency-Key`ヘッダーを推奨(フロントエンドの`apiClient.ts`が自動付与)。フロントエンドの型は`npm run generate:types`で`openapi.yaml`から`src/types/api.generated.ts`へ再生成できる(スキーマ変更時は必ず再実行すること)。
