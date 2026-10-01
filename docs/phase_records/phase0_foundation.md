# Phase 0: 基盤汎用化（承認ワークフロー／ドキュメント管理の共通基盤）詳細記録

> [← 計画書本体に戻る](../backoffice_expansion_plan.md) | [サマリを見る](../backoffice_expansion_summary.md)

本ドキュメントは、`docs/backoffice_expansion_plan.md` から分割された Phase 0 の全実装指示プロンプト、SOレビュー結果、FIXプロンプト、マージ指示の完全な全文記録です（要約・省略なし）。

---

### 2.4 Phase 0 指示プロンプト群（Gemini向け）


# 実装対象
1. 新規マイグレーション sql/006_generic_approval_targets.sql を作成し、
   target_type に許可する値のCHECK制約（またはENUM）に 'contract', 'purchase_request' を追加。
2. approval_rules に、新しい target_type ごとの承認ルール（承認ステップ数・承認者ロール）を
   登録できることを確認するテストデータ（INSERT文）をマイグレーション末尾に追記。
3. backend側（NestJS）の approval モジュールが target_type を文字列としてバリデーションしている
   箇所（enumやunion type定義）を特定し、'contract' / 'purchase_request' を許可リストに追加。

# 受け入れ基準（Definition of Done）
- [ ] 既存の expense_report 承認フローの単体テストが全て通過する（デグレなし）
- [ ] target_type = 'contract' で approval_requests を作成し、承認/却下の一連の操作ができる
- [ ] 自己承認（申請者=承認者）が新target_typeでも拒否されることを確認するテストを追加
- [ ] マイグレーションがロールバック可能な形（対応するdown処理 or 明示的なコメント）で書かれている

# ChatGPTレビュー時の確認観点
- CHECK制約の実装が、将来target_typeが増えるたびにマイグレーションを要する設計になっていないか
  （テーブル駆動にできないか）
- RLSポリシーが新target_typeのレコードに対しても正しく機能しているか（他テナントから見えないか）
- トランザクション境界（SET LOCAL app.current_tenant_id）が新ドメインのAPIエンドポイントでも
  漏れなく設定されているか
```

---

#### 【マージ指示プロンプト P0-T1-MERGE】mainへのマージ

ChatGPT(SO)よりP0-T1が正式PASSと判定されたため、Geminiへマージを指示する。

```
# 指示
feature/p0-t1-approval-target-type を main へマージしてください。
SO(ChatGPT)による正式PASS判定（コミット96ffcf4時点）を得ています。
マージ後、以下を確認し報告してください。
- main上でBackend Jest 8/8 PASS、Backend/Frontend TypeScript 0 errorsを再実行して確認
- マージコミットハッシュ
- 作業ブランチ feature/p0-t1-approval-target-type の削除（マージ済み後）
```

これでP0-T1は完了。次はP0-T2（attachmentsテーブルの汎用化）へ進む。

---

#### 【指示プロンプト P0-T2】attachmentsテーブルの汎用化

```
# 背景・目的
現行の attachments テーブルはレシート・請求書等の証憑（電帳法対応）を前提にした列構成になっている。
契約書PDF等、性質の異なる文書も同じテーブル・同じ添付UIで扱えるよう汎用性を検証・拡張する。

# 前提となる既存実装
- docs/02_architecture.md セクション3.4（電子帳簿保存法対応ストレージ）
- docs/03_database_design.md の attachments テーブル定義とインデックス設計
  （transaction_date, amount, counterparty_name の3項目検索インデックス）

# やってはいけないこと
- 既存の電帳法対応要件（transaction_date/amount/counterparty_nameによる検索性）を壊さない。
  契約書のように「金額」が本質的でない文書でも、これらの列はNULL許容にする形で共存させる。
- WORM（追記専用）特性を弱めない。契約書も一度確定登録したら物理削除不可という制約を維持する。

# 実装対象
1. 新規マイグレーション sql/007_attachments_document_category.sql を作成し、
   attachments に document_category 列（'receipt' | 'invoice' | 'contract' | 'other' 等）を追加。
   デフォルト値は既存データ互換のため 'receipt' とする。
2. 契約書特有のメタデータ（契約期間の開始/終了日、自動更新フラグ）は
   attachments を汚さず、新テーブル contracts（Phase 1で作成）側に持たせる設計とする。
   このタスクでは attachments 側に「文書種別タグ」を持たせるだけに留めること。
3. 既存の全文検索・trgmインデックスが新カテゴリでも機能するか確認。

# 受け入れ基準
- [ ] 既存の証憑アップロード機能（レシート等）に一切の回帰がない
- [ ] document_category = 'contract' で添付ファイルを登録できる
- [ ] 既存の電帳法検索（3項目検索）が引き続き動作する
- [ ] feature/p0-t2-attachments-category ブランチにコミット・pushし、比較URLを報告に含める（本計画書0.4節の完了報告ルールに従う）

# ChatGPTレビュー時の確認観点
- document_category を後からENUM化しやすい設計になっているか（文字列直書きを避けているか）
- 既存データに対するマイグレーションのデフォルト値設定が安全か（NULL埋めによる検索漏れがないか）
```

---

---

#### 【マージ指示プロンプト P0-T2-MERGE】mainへのマージ

ChatGPT(SO)よりP0-T2が実質PASS（CONDITIONAL PASSだが追加修正不要、DEBT-001として記録のみ）と判定されたため、Geminiへマージを指示する。

```
# 指示
feature/p0-t2-attachments-category を main へマージしてください。
SO(ChatGPT)による判定（コミット6ddd3cb時点、CONDITIONAL PASSだが追加修正は不要と判断）を得ています。
なお、ファイル保存とDBトランザクションの非原子性についてはDEBT-001として計画書側で
追跡することとし、今回のマージ・今後のタスクをブロックするものではありません。
マージ後、以下を確認し報告してください。
- main上でBackend/Frontendのテストを再実行して確認
- マージコミットハッシュ
- 作業ブランチ feature/p0-t2-attachments-category の削除（マージ済み後）
```

これでP0-T2は完了。次はP0-T3（AIゲートウェイの汎用提案インターフェース定義）へ進む。

---

#### 【指示プロンプト P0-T3】AIゲートウェイの汎用提案インターフェース

```
# 背景・目的
現行のAIゲートウェイはOCR・勘定科目提案に特化した出力スキーマになっている。契約書の条項抽出等、
将来の全ドメイン展開に備え、「文書種別によらず構造化提案を返す」共通インターフェースに一般化する。

# 前提となる既存実装
- docs/02_architecture.md セクション1.2（レイヤー構成と責務分離の表）、
  および3.3（AIゲートウェイ仕様の入出力契約）
- 「AI出力は必ず suggested_* 列 / 一時テーブルに格納し、確定用列に直接書き込ませない」という
  ガードレール原則

# やってはいけないこと
- AIゲートウェイに確定処理の権限を一切持たせない（このルールは全ドメイン共通で絶対）。
- 既存の仕訳科目提案（OCR）のプロンプト・出力精度を劣化させる変更をしない。

# 実装対象
1. AIゲートウェイのレスポンス型を、現行の「勘定科目候補特化」型から
   汎用型 { document_type: string, suggested_fields: Record<string, {value, confidence, rationale}> }
   に拡張する。既存の勘定科目提案は suggested_fields の一種として後方互換的に扱えるようにする。
2. 契約書向けの初期プロンプトテンプレート（契約期間・金額・自動更新条項・相手先名の抽出）を
   ai-gateway モジュール内に追加するが、実際のDB書き込み先（contractsテーブル）はPhase1で実装する
   ため、このタスクでは提案JSON生成までをスコープとする。

# 受け入れ基準
- [ ] 既存のレシートOCR→科目提案のE2Eテストが通過する
- [ ] 契約書PDFを渡すと suggested_fields に契約期間・金額等が候補として返る（精度は問わない、
      構造が正しく返ることを確認）
- [ ] AIゲートウェイのレスポンスがどのエンドポイントを叩いても確定用テーブルに直接書き込まれていない
      ことをコードレビューで確認できる
- [ ] feature/p0-t3-ai-gateway-generic-suggestions ブランチにコミット・pushし、比較URLを報告に含める（本計画書0.4節に従う）

# ChatGPTレビュー時の確認観点
- 型の後方互換性が本当に保たれているか（既存フロントエンドが壊れないか）
- confidence スコアの扱いが一貫しているか（低信頼度の提案を人間が見分けられるUIになっているか）
```

---

---

#### 【マージ指示プロンプト P0-T3-MERGE】mainへのマージ

ChatGPT(SO)よりP0-T3が判定（CONDITIONAL PASSだが追加修正不要、DEBT-002/003として記録）されたため、Geminiへマージを指示する。

```
# 指示
feature/p0-t3-ai-gateway-generic-suggestions を main へマージしてください。
SO(ChatGPT)による判定（コミットe01384d時点、CONDITIONAL PASSだが追加修正は不要と判断）を得ています。
以下2点はDEBT-002/DEBT-003として計画書側で追跡することとし、今回のマージ・今後のタスクを
ブロックするものではありません。
- DEBT-002: suggested_fields.*.confidence / confidenceScore のruntime 0-1 validation未実装
- DEBT-003: model_nameデフォルト値が実際の生成方式（ルールエンジン）と乖離している
マージ後、以下を確認し報告してください。
- main上でBackend/Frontendのテストを再実行して確認
- マージコミットハッシュ
- 作業ブランチ feature/p0-t3-ai-gateway-generic-suggestions の削除（マージ済み後）
```

これでP0-T3は完了。次はP0-T4（法務向けロールの追加）へ進む。P0-T4完了でPhase 0は全タスク完了となる。

---

#### 【指示プロンプト P0-T4】法務向けロールの追加

```
# 背景・目的
Phase 1で契約書管理を導入するにあたり、既存の viewer_external（外部税理士向け時限アクセス）と
同様のパターンで、総務・法務担当向けロールをRBACに追加する。

# 前提となる既存実装
- docs/03_database_design.md セクション6（RLS設計の詳細）
- roles / permissions / role_permissions / user_roles テーブル定義
- external_access_grants の時限アクセス実装（期限切れ後の自動遮断ロジック）

# やってはいけないこと
- 既存ロール（owner, accountant, viewer_external等）の権限範囲を変更しない。
- fail-closed の原則（未設定・不一致時は0件返却）を崩さない。

# 実装対象
1. 新規マイグレーション sql/008_legal_role.sql で roles に 'legal_admin'（契約書のCRUD権限）と
   'legal_viewer'（閲覧のみ）を追加。
2. permissions テーブルに contract 関連の権限コード（contract:create, contract:approve,
   contract:view 等）を追加し、role_permissions で紐付け。
3. RLSポリシーは既存の tenant_id = fn_current_tenant_id() 標準パターンを踏襲し、
   契約書テーブル固有の追加ポリシーが必要かはPhase1のテーブル設計時に判断する
   （このタスクではロール・権限マスタの整備のみ）。

# 受け入れ基準
- [ ] 新ロールでログインしたユーザーが、権限のないテーブル（journal_entries等）に
      アクセスできないことを確認
- [ ] 既存ロールの権限テストに回帰がない
- [ ] feature/p0-t4-legal-role ブランチにコミット・pushし、比較URLを報告に含める（本計画書0.4節に従う）

# ChatGPTレビュー時の確認観点
- permissions のコード体系が既存の命名規則（例: expense:approve のような形式）と一貫しているか
```

---

#### 【フォローアップ指示プロンプト P0-T4-FIX】REQUEST CHANGES対応（ENUM実行順序・権限矛盾）

ChatGPT(SO)よりP0-T4が「REQUEST CHANGES」と判定されたため、以下をGeminiに指示する。

```
# SOレビュー結果：P0-T4 REQUEST CHANGES
main...feature/p0-t4-legal-role の実差分を確認した結果、現状はマージ不可です。以下を修正してください。

# BLOCKER-01: ENUM追加後の同一トランザクション使用問題
sql/008_legal_roles.sql で、
  ALTER TYPE role_code_enum ADD VALUE IF NOT EXISTS 'legal_admin';
  ALTER TYPE role_code_enum ADD VALUE IF NOT EXISTS 'legal_viewer';
  INSERT INTO roles (code, name) VALUES ('legal_admin', ...), ('legal_viewer', ...);
という順序になっています。PostgreSQLでは ALTER TYPE ... ADD VALUE で追加した値を
同一トランザクション内で直後に使用すると "unsafe use of new value" エラーになり得ます。
リポジトリの既存マイグレーション実行方式（1トランザクションか、ステートメントごとか）を確認し、
確実に安全な方式へ修正してください。具体的には、ALTER TYPE部分と roles への INSERT を
別マイグレーションファイルに分割する（例: 008a_legal_roles_enum.sql / 008b_legal_roles_insert.sql）か、
リポジトリのmigrationランナーがステートメントごとに自動commitする方式であることを確認した上で
その根拠を報告に明記するか、いずれかの対応を取ってください。

# MAJOR-01: 完了報告と実装内容の矛盾
完了報告では「既存ロールの権限・アクセス範囲には一切変更なし」としていますが、実際のSQLでは
owner / approver / accounting_manager / accountant に contract.* 系の新規権限を付与しており、
これは明確に既存ロールのアクセス範囲変更です。以下のどちらかに揃えてください。
  (a) 既存ロールへの契約権限付与を意図した設計として採用する場合:
      完了報告・ドキュメントの記述を「legal_admin/legal_viewerの新設に加え、既存ロールにも
      契約閲覧・承認権限を付与」に修正する。
  (b) P0-T4のスコープを「新規legal roleの追加のみ、既存ロールは不変」に厳密に限定する場合:
      owner/approver/accounting_manager/accountantへのcontract関連権限追加を削除する。
どちらの方針を取るか判断し、報告に明記してください（本計画書のPhase 1タスクとの整合を考えると
(a)の方が自然な可能性がありますが、最終判断はGemini実装側の状況を踏まえてください）。

# MEDIUM-01: legal_adminのSoD（職務分掌）確認（今回は必須修正ではない）
legal_admin が contract.create と contract.approve の両方を持つため、Phase 1で
contracts / approval workflow を実装する際には、既存の自己承認禁止（fn_prevent_self_approval）が
契約ドメインにも確実に適用されることを必須条件とする。この確認は今回のP0-T4修正では不要だが、
報告内で「Phase 1実装時の必須確認事項」として明記すること。

# 修正後に再実行すること
1. schema migration実行確認（実際にマイグレーションを実行してエラーが出ないこと）
2. scripts/verify_schema.py
3. backend npm test
4. backend/frontend npm run typecheck
5. frontend npm run build
6. git diff main...feature/p0-t4-legal-role
7. feature/p0-t4-legal-role へ修正コミットをpush（本計画書0.4節に従う）

# 受け入れ基準（Definition of Done）
- [ ] ENUM追加とINSERTの実行順序が安全であることを、実際にマイグレーションを実行して確認できる
- [ ] 完了報告と実装内容（既存ロールへの権限付与有無）が一致している
- [ ] MEDIUM-01がPhase 1実装時の必須確認事項として報告に明記されている
- [ ] 修正コミットがpushされ、比較URLが報告に含まれる

# ChatGPTレビュー時の確認観点
- 修正後のマイグレーションが、実際のPostgreSQL実行順序（ステートメントごとのcommit境界含む）で
  問題なく流れることを、報告だけでなく実行ログ等で確認できるか
- MAJOR-01でどちらの方針を選んだかが、Phase 1のcontracts設計・承認ワークフローと矛盾しないか
```

---

#### 【フォローアップ指示プロンプト P0-T4-VERIFY】実DB migration実行確認（コード変更なし）

ChatGPT(SO)よりP0-T4-FIXの修正内容自体はCONDITIONAL PASS。残る確認事項は実DB migration実行のみ。

```
P0-T4-FIXの修正内容そのものはSOとして承認可能です。
残る確認事項は実DB migrationの実行確認のみです。コード変更は不要です。

以下を実行してください。
1. npm run db:migrate
2. npm run db:verify-schema

特に、008a_legal_roles_enum.sql → 008b_legal_roles_setup.sql の順序で正常適用されること、
そして verify_schema.py のP0-T4検証がPASSすることを確認してください。
既に適用済みDBの場合は、可能であればクリーンな検証DBでも確認してください。

実行結果と終了ステータスを報告してください。
SO判定は現在 CONDITIONAL PASS。上記実DB確認がPASSすれば正式PASSとします。
```

---

#### 【マージ指示プロンプト P0-T4-MERGE】mainへのマージ ＋ Phase 0クローズ

ChatGPT(SO)よりP0-T4が正式PASS（コミット470f2dc）と判定された。実DB E2E未実施はDEBT-004として記録し、Geminiへマージを指示する。

```
# 指示
feature/p0-t4-legal-role を main へマージしてください。
SO(ChatGPT)による正式PASS判定（コミット470f2dc時点）を得ています。
実DB migration実行（db:migrate / verify_schema.pyのDB接続確認）は開発環境にpsqlクライアントが
存在しないため未実施ですが、これはDEBT-004として計画書側で追跡することとし、
今回のマージをブロックするものではありません。
マージ後、以下を確認し報告してください。
- main上でBackend/Frontendのテストを再実行して確認
- マージコミットハッシュ
- 作業ブランチ feature/p0-t4-legal-role の削除（マージ済み後）
```

**Phase 0の基盤タスク(P0-T1〜T4)は完了。** ただしPhase 1着手前にDEBT-004（実DB E2E未検証）を解消する方針としたため、**P0-T5（開発環境へのpsql整備）を挟んでからPhase 1へ移行する。**

### Phase 0 → Phase 1 引継ぎ事項

Phase 1着手にあたり、以下を必須確認事項として持ち越す。

1. **SoD/自己承認**: `fn_prevent_self_approval()` が契約承認（`target_type='contract'`）にも確実に適用されることを、P1-T1のcontractsテーブル実装時に検証する（P1-T1プロンプトのDoDに既に反映済み）。
2. **DEBT-001**（P0-T2）: ファイル保存とDBトランザクションの非原子性。ストレージ本格化まで対応不要。
3. **DEBT-002 / DEBT-003**（P0-T3）: confidence値のruntime validation未実装、model_nameが実態(ルールエンジン)と乖離。**DEBT-003はP1-T2（契約書AI条項抽出）着手時に対応必須**。
4. **DEBT-004**（P0-T4）: 開発環境にpsqlクライアントが未整備で実DB E2E検証ができていない。**P0-T5として対応する（下記プロンプト参照）。**

---

#### 【指示プロンプト P0-T5】開発環境へのpsql整備 ＋ 実DB migration E2E確認

```
# 背景・目的
これまでのPhase 0タスク（P0-T1〜T4）は、開発/レビュー環境にPostgreSQLクライアント(psql)が
存在しないため、SQL migrationの実DB接続を伴う実行確認（実DB E2E）ができていなかった
（DEBT-004）。Phase 1のP1-T1（contractsテーブル新規作成）はステータス遷移トリガー・
改ざん防止トリガー等、実DBでの動作確認が本質的に重要になるため、着手前にこれを解消する。

# 前提となる既存実装
- backend/scripts/db-migrate.js（migration runner。ファイルごとに独立psqlプロセスを起動する方式）
- scripts/verify_schema.py（DB接続を伴うスキーマ検証スクリプト）
- sql/ 配下の 001〜008b までの全migrationファイル

# やってはいけないこと
- 本番/共有の環境変数・DB接続情報を変更しない。あくまでローカル/CI向けの検証環境整備に限定する。
- 既存のCI設定ファイル（あれば）を、他のジョブに影響する形で不用意に書き換えない。

# 実装対象
1. psqlクライアントの導入方法を整備する。個人開発（Docker前提と推測）であることを踏まえ、
   以下のいずれかを状況に応じて選択・実装する。
   a. 既存のdocker-compose（PostgreSQLコンテナ）に対し、ホスト側からも
      `docker exec -it <postgres_container> psql ...` で接続できることを確認し、
      db-migrate.js / verify_schema.py がこの経路で実行できるようスクリプトまたは
      READMEを整備する。
   b. もしホスト環境に直接psqlクライアントを入れる方が既存ワークフローに合うなら、
      README（docs/05_deployment_guide.md 等、既存の該当ドキュメント）に
      OS別のインストール手順を追記する。
   どちらを選んだかを報告に明記すること。
2. クリーンな検証用DB（新規docker volumeまたは新規DB）に対し、001から008bまでの
   全migrationを順に実行し、途中でエラーが出ないことを確認する。
3. `python scripts/verify_schema.py` をDB接続ありで実行し、これまでのPhase 0タスク
   （target_type拡張、attachments.document_category、AI suggestion汎用化、legal role）
   の検証項目が全てPASSすることを確認する。
4. 今後同様の状況が起きないよう、README等に「migration実装後は必ず実DB E2Eを実行すること」を
   一文で明記する。

# 受け入れ基準（Definition of Done）
- [ ] クリーンなDBに対し001〜008bの全migrationが順にエラーなく適用できる
- [ ] verify_schema.pyがDB接続ありで実行でき、Phase 0の検証項目が全てPASSする
- [ ] psql実行手順（docker exec経由 or 直接インストール）がREADME等に記録されている
- [ ] DEBT-004が解消済みとして扱えることを報告に明記する
- [ ] feature/p0-t5-psql-env-setup ブランチにコミット・pushし、比較URLを報告に含める
      （本計画書0.4節に従う）

# ChatGPTレビュー時の確認観点
- 検証手順が再現可能か（他の開発者やCI環境でも同じ手順で実DB E2Eができるか）
- クリーンDBでの検証が、既存の開発用DBを汚染していないか（別DB/別volumeを使っているか）
```

---

#### 【フォローアップ指示プロンプト P0-T5-FIX】REQUEST CHANGES対応（Docker fallbackの接続先保証）

ChatGPT(SO)よりP0-T5が「REQUEST CHANGES」と判定されたため、以下をGeminiに指示する。

```
# SOレビュー結果：P0-T5 REQUEST CHANGES
main...feature/p0-t5-psql-env-setup の実差分を確認した結果、現状はマージ不可です。以下を修正してください。

# MAJOR-01: Docker fallbackがDATABASE_URLを無視している
db-migrate.js の fallback順序は host psql → Docker psql → node-postgres となっていますが、
Docker経路（docker compose exec -T postgres psql -U postgres -d keiri_kaikei）が接続先を
完全に固定しており、DATABASE_URLの内容と無関係に接続しています。
これは、DATABASE_URLがリモートDB（例: production）を指している環境でhost psqlが無い場合、
意図せずローカルDocker上のPostgreSQLにmigrationを実行してしまうリスクがあります。
DB migration runnerとしては、DATABASE_URLが唯一の接続先情報であるべきです。

# 修正方針（A案を採用）
DATABASE_URLをパースし、host/port/databaseがDocker composeのPostgreSQL設定
（localhost/127.0.0.1、標準ポート、keiri_kaikei等）と一致する場合にのみDocker fallbackを使用する。
一致しない場合はDocker経路を使わず、node-postgres fallbackへ進む。
（B案＝Docker内psqlからDATABASE_URLの接続先を使う、は今回の開発環境では複雑になりすぎるため採用しない）

# 実装対象
1. db-migrate.js に、DATABASE_URLをパースしてDocker composeの接続設定と比較する処理を追加。
   一致しない場合はDocker fallbackをスキップし、ログにその理由（「DATABASE_URLがDocker
   composeの接続先と一致しないためスキップ」等）を出力する。
2. 一致しない場合に誤ってDockerへ実行してしまわないことを確認するテストを追加
   （例: DATABASE_URLをリモート風の値に設定した状態でDocker fallbackが選択されないこと）。
3. 完了報告の表現を整理する。今回のP0-T5で完成したのは「実DB E2E検証ができる環境」であり、
   「verify_schema.pyの全項目が実DB上でPASSした」という実施結果そのものではない点を区別する。
   今回、実際に verify_schema.py をDB接続ありで最後まで実行し、Phase 0の検証項目
   （target_type拡張、attachments.document_category、AI suggestion汎用化、legal role）が
   全てPASSすることを確認し、その実行ログ/結果を完了報告に添付すること。

# 受け入れ基準（Definition of Done）
- [ ] DATABASE_URLがDocker composeの接続先と一致しない場合、Docker fallbackが使われないことを
      テストで確認できる
- [ ] DATABASE_URLがDocker composeの接続先と一致する場合は、従来どおりDocker fallbackが動作する
- [ ] verify_schema.py を実DB接続で最後まで実行し、Phase 0の全検証項目PASSの実行結果を報告に添付する
- [ ] 修正コミットをfeature/p0-t5-psql-env-setup にpushし、比較URLを報告に含める

# ChatGPTレビュー時の確認観点
- DATABASE_URLのパース処理が、パスワードや特殊文字を含む接続文字列でも正しく動作するか
- 「一致しない場合はスキップしてnode-postgresへ」というフォールバック順序が、
  意図しないタイミングでもDocker側に接続しない設計になっているか
- 今回添付された実DB E2E結果が、本当にクリーンなDBに対するものか（既存データが残った状態での
  実行ではないか）
```

---

#### 【マージ指示プロンプト P0-T5-MERGE】mainへのマージ ＋ Phase 0完全クローズ

ChatGPT(SO)よりP0-T5が正式PASS（Docker fallback接続先問題は解消、実DB E2E 34/34 PASS）と判定された。

```
# 指示
feature/p0-t5-psql-env-setup を main へマージしてください。
SO(ChatGPT)による正式PASS判定を得ています（Docker fallbackのDATABASE_URL無視問題は解消、
クリーンDBに対する001〜008b全migration適用＋verify_schema.py 34/34 PASSを確認済み）。
マージ後、以下を確認し報告してください。
- main上でBackend Jest 33/33、TypeScript、Frontend buildを再実行して確認
- マージコミットハッシュ
- 作業ブランチ feature/p0-t5-psql-env-setup の削除（マージ済み後）
```

**これでPhase 0（基盤汎用化）は全5タスク完了。** Phase 1（総務・法務: 契約書管理）へ正式に移行する。

### Phase 0クローズ時点のサマリ

| タスク | 最終判定 |
|--------|----------|
| P0-T1 | ✅ PASS |
| P0-T2 | ✅ PASS（DEBT-001残） |
| P0-T3 | ⚠️ CONDITIONAL PASS（DEBT-002/003残） |
| P0-T4 | ✅ PASS |
| P0-T5 | ✅ PASS（DEBT-004解消） |

**重要**: 34/34の実DB E2E PASSは「DBレベルの重要な防御境界（RLS・fail-closed・SoD・RBAC・WORM等）がPostgreSQL上で機能すること」を確認したものであり、DEBT-001/002/003を自動的に解消するものではない。これらは引き続き4節の技術的負債ログで追跡する。

Phase 1（特にP1-T1のcontractsテーブル実装）では、Phase 0で確立した実DB E2E検証基盤（クリーンDB×verify_schema.py）を前提として、contracts固有のRLS・tenant_id・RBAC・approval・SoDについても同様の実DB検証を受け入れ基準に含めること。

---

#### 【フォローアップ指示プロンプト P0-T1-FIX】コミット・プッシュ ＋ SO指摘事項対応

ChatGPT(SO)のP0-T1レビューが「CONDITIONAL PASS」で返ってきたため、以下をGeminiに追加指示する。

```
# 背景・目的
P0-T1の実装報告についてChatGPT(SO)からレビューを受けたが、実装がGitHubへpushされておらず、
「報告ベースのレビュー」に留まっている。正式PASSにするため、以下2点を実施した上で
コミット・プッシュし、レビュー可能な状態にすること。

# 前提
- 直前のP0-T1指示プロンプトでの実装内容（このタスクは追加修正であり、再実装ではない）
- 完了報告ルール（本計画書 0.4節）に従うこと

# 対応事項

## 1. コミット・プッシュ（最優先）
- 作業ブランチ feature/p0-t1-approval-target-type にすべての変更をコミットし、GitHubへpushする。
- push後、比較URL（https://github.com/somurye/fullstack-ai-accounting/compare/main...feature/p0-t1-approval-target-type）
  を報告に含めること。
- mainへは絶対にマージしないこと（レビューPASS後にClaudeが指示するまで待機）。

## 2. SO指摘事項①: 承認基盤と業務データの責務分離の明示化
「承認完了＝対象業務の確定処理ではない」という原則が実装上も明確であることを示す。
- approval-requests.service.ts（または相当のファイル）内で、approve処理が
  approval_requests / approval_history / audit_logs のみを更新し、
  contracts や purchase_requests 等の対象ドメインテーブルを一切直接更新していないことを確認する。
- もし現状、汎用承認サービスから対象ドメインテーブルへの参照・更新が存在する場合は、
  イベント発行（例: ApprovalCompletedEvent）に置き換え、対象ドメイン側のサービスが
  そのイベントを購読して自身のテーブルを更新する設計に修正する。
  ※Phase 1でcontractsテーブルはまだ存在しないため、現時点ではこのイベント発行の「受け口」が
    存在しなくても構わない。承認サービス側が汎用イベントを発行する準備までを対象とする。
- この責務分離が分かるよう、該当コードに一言コメント
  （例: // 承認基盤は状態・履歴・監査ログのみを管理し、対象ドメインの確定処理は行わない）を残す。

## 3. SO指摘事項②: purchase_requestの自己承認拒否・tenant isolationテスト追加
現状 contract のみ検証されている以下のテストを purchase_request にも追加する。
- 自己承認拒否（fn_prevent_self_approval が purchase_request でも機能すること）
- tenant isolation（他テナントから見えないこと）
最終的に以下のマトリクスが全てPASSする状態にする。

| 観点 | contract | purchase_request |
|------|:---:|:---:|
| 作成 | ○ | ○ |
| 承認 | ○ | ○ |
| 却下 | ○ | ○ |
| 自己承認拒否 | ○ | ○ |
| 権限外承認拒否 | ○ | ○ |
| tenant isolation | ○ | ○ |
| audit/history | ○ | ○ |

# 受け入れ基準（Definition of Done）
- [ ] feature/p0-t1-approval-target-type ブランチがGitHubにpushされている
- [ ] 承認基盤がcontracts/purchase_requests等のドメインテーブルを直接更新していないことがコードで確認できる
- [ ] 上記マトリクス7項目 × 2ドメイン(contract, purchase_request) = 14ケース全てテストPASS
- [ ] 完了報告に比較URL・変更ファイル一覧・テスト結果を含める

# ChatGPTレビュー時の確認観点
- push後のコードで、承認サービスの実装がドメインテーブルを本当に参照していないか（import文、
  リポジトリ層の呼び出し関係まで確認）
- purchase_requestの自己承認拒否テストが、contract用テストのコピペで終わっておらず、
  実際に別テナント・別ユーザーでのテストケースになっているか
- migration Down処理について、新targetのデータが存在する状態でのロールバック手順が
  コメントまたはドキュメントとして残っているか（SOが「軽微な確認事項」とした点への対応）
```

---

#### 【フォローアップ指示プロンプト P0-T1-FIX2】migrationからテストデータINSERTを除去

ChatGPT(SO)の実コードレビュー(コミット `77eb503`)により、責務分離(承認基盤がcontract/purchase_requestの
業務データを直接確定しない設計)は問題なしと確認された。唯一の必須修正はmigrationの純化のみ。

```
# 背景・目的
006_generic_approval_targets.sql に、SELECT ... LIMIT 1 で任意の1テナントを選び、
そのテナントへ実際の approval_rules（contract/purchase_request向け）をINSERTする
DO $$ ... $$ ブロックが含まれている。これはschema migrationの範囲を超えた
「業務データ変更」であり、本番適用時に意図しないテナントへ承認ルールが混入するリスクがある。
これを除去し、migrationをスキーマ/制約変更のみに純化する。

# 前提となる既存実装
- 直前のコミット 77eb503 の 006_generic_approval_targets.sql
- verify_schema.py（スキーマ検証スクリプト。テストfixtureの置き場所として利用する）

# やってはいけないこと
- CHECK制約の拡張自体（target_typeにcontract/purchase_requestを追加する部分）はそのまま維持する。
  今回削除するのは末尾の DO $$ ... approval_rules INSERT ... END $$; ブロックのみ。
- 既存の8件の単体テストが依存しているテストデータがあれば、migration削除によって
  テストが壊れないよう、テストデータの生成元をテスト側（fixture/setup）に付け替える。

# 実装対象
1. 006_generic_approval_targets.sql から、実テナントへのapproval_rules INSERTブロックを完全に削除する。
   （CHECK制約変更部分は残す）
2. 削除したテストデータは、verify_schema.py 内、または新規の test fixture
   （例: tests/fixtures/approval_rules.seed.sql、もしくはテストコード内でのINSERT）として
   作成し直す。本番migrationとは明確に分離されたパスに置くこと。テナントIDはLIMIT 1のような
   暗黙選択ではなく、テストごとに明示的に生成・指定する。
3. 既存の8件の単体テストを実行し、fixtureの付け替えによって回帰していないことを確認する。
4. down migrationについて、「実際のmigration frameworkでdown処理を実行する仕組みが
   存在するか」を確認し、報告に一言記載する（このタスクのブロッカーではない、確認のみ）。

# 受け入れ基準（Definition of Done）
- [ ] 006_generic_approval_targets.sql に業務データ（実テナント向けINSERT）が一切含まれていない
- [ ] CHECK制約の拡張（target_type = contract/purchase_request許可）は維持されている
- [ ] テストデータはfixture/seed側に分離され、既存8件の単体テストが引き続き全てPASSする
- [ ] down migrationの実行可否について一言確認結果を報告に含める
- [ ] feature/p0-t1-approval-target-type ブランチに追加コミット・pushし、比較URLを報告に含める
      （本計画書0.4節に従う）

# ChatGPTレビュー時の確認観点
- migration適用後、まっさらなDB（テストデータなし）でschemaが正しく作られることを確認できるか
- fixture化されたテストデータが、特定の1テナントを暗黙に選ぶ（LIMIT 1のような）設計を
  引き継いでいないか（テストではテナントIDを明示的に生成・指定するのが望ましい）
```

---
