# keiri-kaikei 全社バックオフィス統合SaaS 拡張計画書

- 文書番号: PLAN-01
- バージョン: 1.0.0
- 対象リポジトリ: `fullstack-ai-accounting`（経理・会計基盤）
- 関連文書: `docs/01_requirements.md`, `docs/02_architecture.md`, `docs/03_database_design.md`

---

## 0. コンセプトと設計原則

### 0.1 プロダクトコンセプト

経理・会計基盤で確立した「AIエージェントによる最大効率化」×「人の領域とAIの領域の明確な区分」を、全バックオフィス業務（総務・法務／購買・調達／人事労務／営業事務）に横展開する。目標は、**実働の事務担当者が1人しかいない小規模テナントでも、単独で業務を完結できること**。

### 0.2 人とAIの領域区分の原則（全ドメイン共通・不可侵ルール）

既存の経理会計基盤で確立済みのこの分離を、新ドメインでも必ず踏襲する。

| 領域 | 担当 | 確定処理の可否 |
|------|------|-----------------|
| 提案・下書き生成 | AIゲートウェイ（OCR、条項抽出、異常検知、マッチング候補提示） | 不可（`suggested_*`列 / staging領域にのみ書込） |
| 確定・承認・実行 | コアAPI ＋ 人間の承認アクション | 可（唯一の確定処理実行主体） |
| 最終防御 | DB制約・トリガー（RLS、追記専用、貸借/整合性チェック） | 強制 |

新ドメインの設計時は必ず「①AIが下書き提案 → ②人間が承認 → ③DB制約が最終検証」の三段構成を踏襲すること。これにより1人テナントでも「AIが9割の下書きを作り、人は確認・承認するだけ」の運用が成立する。

### 0.3 マルチエージェント開発体制

| 役割 | 担当 | 責務 |
|------|------|------|
| 進行管理（本計画の維持・更新） | Claude | フェーズ／タスクの要件定義、Geminiへの実装指示プロンプト作成、ChatGPTレビュー結果を踏まえた差し戻し判断、次タスクへの反映 |
| 実装エンジニア | Gemini | 指示プロンプトに基づく実際のコード実装（SQL migration、NestJSモジュール、Reactコンポーネント等） |
| レビューSO（セカンドオピニオン） | ChatGPT | 実装差分に対する第三者視点でのレビュー（セキュリティ、RLS漏れ、規約違反、抜け漏れの指摘） |

**運用フロー**: Claude が計画書の該当タスクから指示プロンプトを起こす → Gemini が実装 → 実装差分をChatGPTにレビュー依頼 → 指摘事項をClaudeが取りまとめ、必要なら指示プロンプトを修正して再実装 → マージ。

**指示プロンプトの共通フォーマット**（Geminiに渡す際は必ずこの構成を維持する）:
1. 背景・目的
2. 前提となる既存実装（参照ファイル・テーブル）
3. やってはいけないこと（アーキテクチャ制約）
4. 実装対象（具体的なファイル・テーブル・関数）
5. 受け入れ基準（Definition of Done）
6. ChatGPTレビュー時の確認観点（あらかじめ明示しておくとレビューが速い）
7. **完了報告の必須要件（コミット・プッシュ）**

### 0.4 完了報告ルール（全タスク共通・必須）

ChatGPT（SO）は実コードとの差分照合を前提にレビューする。**「報告ベース」のレビューはコード未反映時の暫定判定にしかならず、正式PASSにはできない。** そのため、以下を全指示プロンプトの完了報告要件として明記する。

1. 実装完了後は、必ず作業ブランチ（命名規則: `feature/{タスクID}-{短い説明}`、例: `feature/p0-t1-approval-target-type`）にコミットし、GitHubへpushすること。
2. 完了報告には以下を必ず含める:
   - ブランチ名 / コミットハッシュ（または比較用URL: `https://github.com/somurye/fullstack-ai-accounting/compare/main...{branch}`）
   - 変更ファイル一覧
   - テスト実行結果（コマンドとPASS件数）
3. `main` へのマージは、ChatGPTレビューが正式PASSになってからClaudeが指示する（Geminiが独断でmainへマージしない）。
4. push前の「報告のみ」の完了通知は受け付けない。実装が終わっていてもpushされていなければタスクは「未完了」として扱う。
5. **テストが全件PASSしていることは、機能が実際に意図通り動作していることの証明にはならない。** 特に外部入力（PDF、ユーザー入力ファイル等）を扱うタスクでは、固定のfixtureやモックデータだけでなく、実際の入力データを使ったE2E検証をDoDに含めること（P1-T2で、テストは56/56 PASSしていたにもかかわらずPDF本文が実際には読み込まれず固定テキストで代替されていた事例を教訓とする）。

---

## 1. 拡張ロードマップ全体像

実装順序は「①汎用化基盤への投資対効果」「②既存資産の再利用度」「③規制・専門性の複雑さ」の3軸で決定。複雑な人事労務を後回しにし、まず汎用ワークフローエンジンを固めてから横展開する設計。

| Phase | ドメイン | 主な機能 | 既存資産の再利用度 | 規制複雑度 |
|-------|----------|----------|---------------------|-------------|
| **Phase 0** | 基盤汎用化 | 承認ワークフローエンジンの完全汎用化、汎用ドキュメント管理基盤 | −（投資フェーズ） | 低 |
| **Phase 1** | 総務・法務 | 契約書管理、稟議申請、条項AI抽出、更新期限アラート | 高（承認・監査ログ・AI Gateway） | 中 |
| **Phase 2** | 購買・調達 | 発注申請、サプライヤー管理、購買稟議 | 高（Phase0/1のワークフロー・帳票基盤） | 低〜中 |
| **Phase 3** | 人事労務 | 勤怠管理、給与計算内製化、社保・年末調整 | 中（給与連携は既存、計算ロジックは新規） | 高（労働法制） |
| **Phase 4** | 営業事務 | 見積書、契約更新連携、案件管理 | 高（請求書発行・契約管理の延長） | 低 |
| **Phase 5** | 統合最適化 | 横断ダッシュボード、AIエージェントによる業務横断レコメンド | −（統合フェーズ） | 低 |

> 各Phaseの詳細タスク分解と実装指示プロンプトは、**そのPhaseに着手するタイミングでClaudeが都度作成する**（Phase 2以降は直前Phaseの実装結果に依存するため、事前に確定させすぎない）。本計画書ではPhase 0とPhase 1（今回合意した優先領域）のみ、タスクレベルまで展開する。

---

## 2. Phase 0: 基盤汎用化（承認ワークフロー／ドキュメント管理の共通基盤）

### 2.1 目的

既存の`approval_requests`/`approval_history`は既に`target_type`/`target_id`によるポリモーフィック設計になっており、`journal_entry`/`expense_report`/`vendor_bill`を横断的に扱える。この汎用性を**契約書・稟議・発注**等の新ドメインにも正式に拡張し、かつ「証憑ファイル管理（`attachments`）」を契約書PDF等でも使い回せる形に一般化する。

### 2.2 タスク分解

| タスクID | タスク名 | 概要 | 依存 | ステータス |
|----------|----------|------|------|-----------|
| P0-T1 | `approval_rules`/`approval_requests`のtarget_type拡張 | `contract`, `purchase_request`等を新たなtarget_typeとして受け入れられるようENUM/CHECK制約とルールエンジンを拡張 | なし | ✅ SO正式PASS（コミット96ffcf4、mainマージ指示済み） |
| P0-T2 | `attachments`テーブルの汎用化確認・拡張 | 現状レシート/請求書向け前提の列（`counterparty_name`等）が契約書にも自然にフィットするか検証し、必要なら`document_category`列を追加 | なし | ✅ SO正式PASS（コミット6ddd3cb、DEBT-001を記録済み、mainマージ指示済み） |
| P0-T3 | AIゲートウェイの汎用提案インターフェース定義 | OCR/科目提案に限定されている現行の提案スキーマを、「文書種別によらず`suggested_fields: JSON`を返す」形に一般化 | なし | ✅ SO判定CONDITIONAL PASS（コミットe01384d、DEBT-002/003を記録済み、mainマージ指示済み） |
| P0-T4 | ロール／権限マスタへの新ロール追加 | `viewer_legal`等、総務・法務向けロールをRBACに追加（既存`viewer_external`と同パターン） | なし | ✅ SO正式PASS（コミット470f2dc、DEBT-004を記録済み、mainマージ指示済み） |
| P0-T5 | 開発環境へのpsql整備 ＋ 実DB migration E2E確認（DEBT-004対応） | 開発/CI環境にPostgreSQLクライアントを整備し、006〜008bまでの全migrationをクリーンDBに実行して`verify_schema.py`を実DB接続でPASSさせる | P0-T4 | ✅ SO正式PASS・mainマージ完了（マージコミット`b57968a`、main上でJest 33/33・typecheck 0 errors・build成功を再確認済み）— **Phase 0完了** |

### 2.3 Phase 0 実装指示プロンプト（Gemini向け）

以下、コピーしてそのままGeminiに渡せる形式で用意。

---

#### 【指示プロンプト P0-T1】承認ワークフローのtarget_type拡張

```
# 背景・目的
keiri-kaikei（経理会計SaaS）を全社バックオフィス統合SaAへ拡張するプロジェクトのPhase 0タスク。
既存の approval_requests / approval_history は target_type / target_id によるポリモーフィック設計で
journal_entry, expense_report, vendor_bill を横断的に扱っている。この仕組みを新ドメイン
（contract = 契約書, purchase_request = 購買稟議）でも使えるよう拡張する。

# 前提となる既存実装（必ず先に読むこと）
- docs/03_database_design.md セクション2.5（承認ワークフローのER図と説明）
- sql/001_initial_schema_all_in_one.sql 内の approval_rules, approval_requests, approval_history 定義
- fn_prevent_self_approval() トリガー関数の実装

# やってはいけないこと
- approval_requests / approval_history のテーブル構造そのもの（列構成）は変更しない。
  target_type に新しい文字列値を追加できるようにするだけに留める。
- fn_prevent_self_approval のロジック（申請者=承認者を拒否する職務分掌チェック）を弱めない。
- RLSポリシーを外したり緩めたりしない。全テナント固有テーブルは
  ENABLE ROW LEVEL SECURITY / FORCE ROW LEVEL SECURITY を維持すること。
- 既存の journal_entry / expense_report / vendor_bill 向けの承認ロジックに
  一切の回帰（デグレ）を起こさないこと。

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

### 3.1 目的

Phase 0で汎用化した承認エンジン・添付ファイル基盤・AIゲートウェイの上に、契約書管理機能そのものを構築する。1人テナント運用を想定し、**契約書アップロード→AIによる条項候補抽出→人間の確認→登録→期限アラート**までを最短導線で完結させる。

### 3.2 タスク分解

| タスクID | タスク名 | 概要 | 依存 | ステータス |
|----------|----------|------|------|-----------|
| P1-T1 | `contracts`テーブル設計・実装 | 契約書メタデータ本体（相手先、種別、金額、期間、自動更新有無、ステータス） | P0-T1, P0-T2, P0-T5 | ✅ SO判定CONDITIONAL PASS（コミット48c8f56、DEBT-006を記録済み、mainマージ指示済み） |
| P1-T2 | 契約書アップロード〜AI条項抽出フロー | PDFアップロード→AIゲートウェイでの条項抽出提案→人間確認画面（DEBT-002/DEBT-003をあわせて解消） | P0-T3, P1-T1 | ✅ SO正式PASS（コミット923ccfd修正後、実PDF内容依存性をE2Eで確認済み、DEBT-007を記録・mainマージ指示済み） |
| P1-T3 | 契約RBAC強制・AI提案ライフサイクル正式化 | ~~承認ワークフロー統合~~（P1-T1で先行実装済みのため統合済み）→ **スコープ変更**: (1) DEBT-005: contract permissionのAPI認可強制、(2) `ai_suggestions.target_type/target_id`のライフサイクル正式決定、(3) 状態遷移・SoDの最終確認 | P0-T1, P0-T4, P1-T1, P1-T2 | ✅ SO正式PASS（コミットb9a948d、DEBT-005/006/source_suggestion_id整合性を解消、DEBT-008を記録、mainマージ指示済み） |
| P1-T4 | 契約期限アラート・バッチ | 満了/自動更新の一定日数前に通知を生成するバッチワーカー | P1-T1 | ✅ 実装完了・実DB E2E 71/71全PASS（全テナント横断バッチ・RLS非バイパス・未読重複防止・既読化・障害隔離を実証、コミット・SOレビュー待ち） |
| P1-T5 | 稟議申請（汎用ワークフロー起票UI） | 契約以外の一般的な稟議（購買以外の申請）もこの画面から起票できる汎用フォーム | P0-T1 | 未着手 |
| P1-T6 | 契約書全文検索（pgvector活用） | 既存のjournal_entry_embeddingsと同様のパターンで契約書本文をベクトル化し類似契約検索を提供 | P1-T1 | 未着手 |

### 3.3 Phase 1 実装指示プロンプト（Gemini向け）

Phase 0が完了し、実際のテーブル・API状態が確定した時点でP1-T1から着手する。以下はP1-T1（最初のタスク）の指示プロンプト。P1-T2以降はP1-T1の実装結果（実際のテーブル定義・API形状）を踏まえてClaudeが都度作成する。

---

#### 【指示プロンプト P1-T1】contractsテーブルの設計・実装

```
# 背景・目的
Phase 0で汎用化した承認ワークフロー（approval_requests target_type='contract'）と
attachments（document_category='contract'）を実際に活用する契約書管理の中核テーブルを実装する。

# 前提となる既存実装
- Phase 0 の成果物（sql/006, 007, 008 のマイグレーション）を必ず先に読むこと
- docs/03_database_design.md セクション6（RLS設計）を踏襲すること
- 既存の vendor_bills / invoices のテーブル設計パターン（ステータス遷移、監査ログ連携）を参考にする

# やってはいけないこと
- 金額を持つ列（contract_amount等）を作る場合、journal_entries同様に numeric 型を用い、
  float等の誤差が出る型を使わない。
- ステータス遷移（draft→pending_approval→active→expired等）を
  アプリケーション側だけで管理せず、既存パターンに倣いDB制約/トリガーでも不正遷移を防止する。
- RLSを外さない。全テナント固有テーブルとして ENABLE/FORCE ROW LEVEL SECURITY を必須とする。

# 実装対象
1. 新規マイグレーション sql/009_contracts.sql:
   contracts テーブル（列例: id, tenant_id, contract_no, counterparty_name, contract_type,
   contract_amount, currency, start_date, end_date, auto_renewal, renewal_notice_days,
   status(draft/pending_approval/active/expired/terminated), created_by, approved_at 等）
   - attachments とは attachment_id FK、または attachment_links 経由で紐付け（既存パターンに倣う）
   - audit_logs 連携（既存の全テーブル共通パターンを踏襲）
2. NestJS側に contracts モジュール（Controller/Service/Repository相当）を作成し、
   CRUD APIと、approval_requests への申請起票APIを実装。
3. 既存の journal_entries と同様、posted相当（active）後の重要項目改変は
   トリガーで制限する（契約金額等の事後改ざん防止）。訂正は新バージョン登録で行う設計とする。

# 受け入れ基準（Definition of Done）
- [ ] 契約書を新規作成（draft）→承認申請→承認完了でactiveになる一連のE2E動作を確認
- [ ] 他テナントから当該契約が一切見えないことをRLSテストで確認
- [ ] active化後にcontract_amount等の重要列を直接UPDATEしようとするとトリガーで拒否される
- [ ] audit_logsに一連の操作が記録される
- [ ] **Phase 0で確立した実DB E2E検証基盤（クリーンDB×verify_schema.py）を用いて、contractsの
      RLS・tenant分離・SoD（自己承認防止）を実PostgreSQL上で検証し、結果を報告に添付する**
      （P0-T5で整備した環境を前提とする。mockベースの単体テストのみでの完了報告は不可）
- [ ] feature/p1-t1-contracts-table ブランチにコミット・pushし、比較URLを報告に含める（本計画書0.4節に従う）

# ChatGPTレビュー時の確認観点
- ステータス遷移の状態機械が抜け漏れなく定義されているか（不正な遷移パスがないか）
- 既存のvendor_bills等と比べて設計の一貫性が保たれているか（レビュアーが「なぜここだけ違う設計か」を
  問えるように、差分がある場合はコメントで理由を明記させる）
- 1人テナント運用を想定したとき、承認者が自分しかいない場合のUX（自己承認防止トリガーとの衝突）
  が考慮されているか ← ★重要: 1人テナントでは「承認者不在」が起こり得るため、
  承認ステップ数0（自動承認）を選べる設計になっているか要確認
```

---

#### 【フォローアップ指示プロンプト P1-T1-FIX】REQUEST CHANGES対応（自動承認の暗黙適用・tenant整合性）

ChatGPT(SO)よりP1-T1が「REQUEST CHANGES」と判定されたため、以下をGeminiに指示する。

```
# SOレビュー結果：P1-T1 REQUEST CHANGES
main...feature/p1-t1-contracts-table の実差分（コミットdcfe6f0）を確認した結果、
現状はマージ不可です。以下2点を修正してください。

# MAJOR-01: 「承認ルールがない」＝「自動承認」になってしまっている
現状の実装は、contract向けの有効な承認ルールのステップ数が0（totalSteps === 0）の場合に
即座にactiveとする設計ですが、これは「承認ルールが明示的に0-stepで設定されている」場合と
「そもそも承認ルールが未設定（テナント管理者が設定を忘れている等）」の場合を区別できていません。
複数人テナントで承認ルール未設定のまま契約が自動的にactive化されてしまうと、
意図せずSoDを無効化する経路になります。

## 修正方針
1. approval_rules（またはcontract向けの承認設定）に、「明示的な自動承認（0-step auto-approve）」
   であることを表すフラグ（例: is_explicit_auto_approve BOOLEAN）を追加する。
2. 承認申請（submit-approval）時のロジックを以下のように変更する。
   - 該当テナント・target_type='contract'の承認ルールが1件も存在しない場合 →
     エラーを返す（「承認ルールが設定されていません。設定を行ってください」等）。
     自動的にactiveへ遷移させない。
   - 承認ルールが存在し、is_explicit_auto_approve=true（0-step）の場合 → 即座にactive
     （1人テナント運用のユースケースはこちらで担保される）。
   - 承認ルールが存在し、1ステップ以上の場合 → 従来通りの承認フロー。
3. 実DB E2Eテストに以下を追加する。
   - 承認ルール未設定のテナントでcontract承認申請をするとエラーになり、activeにならないこと
   - 明示的に0-stepルールを設定したテナントでは従来通り即座にactiveになること

# MAJOR-02: tenant_idとFK先（attachment_id / created_by）のtenant整合性がDB未保証
現状、contracts.tenant_id と attachments.tenant_id（attachment_id経由）、
contracts.tenant_id と created_byユーザーの所属tenantの整合性は、アプリケーション層の
SELECTクエリでのみ担保されており、DB制約としては保証されていません。
このプロジェクトの原則「DB制約/RLSを最終防衛線にする」に沿って、DBレベルでも保証してください。

## 修正方針
1. CHECK制約では別テーブルを参照できないため、トリガー関数（例:
   fn_validate_contract_tenant_consistency()）を作成し、contracts への
   INSERT/UPDATE時に以下を検証してエラーにする。
   - attachment_id が設定されている場合、参照先attachmentsのtenant_idがcontracts.tenant_idと
     一致すること
   - created_byユーザーの所属tenant（既存のuser-tenant関連テーブルを参照）が
     contracts.tenant_idと一致すること
2. 実DB E2Eテストに、他テナントのattachment_id / created_byを指定してcontractsへINSERTしようと
   すると拒否されるケースを追加する。

# 修正不要（今回は仕様確認のみで対応可）
- draft→terminatedの状態遷移が本当に必要か、報告内で一言、意図した仕様かどうかを確認・明記して
  ください（不要と判断すれば削除、必要な仕様であれば理由を一言添えてください）。修正は必須ではありません。
- RBAC API enforcement（contract.*パーミッションのAPI側チェック）は今回のP1-T1では対応不要です。
  DEBT-005として計画書側で追跡し、P1-T3で対応します。

# 受け入れ基準（Definition of Done）
- [ ] 承認ルール未設定のテナントでcontract申請時にエラーとなり、自動activeにならないことをテストで確認
- [ ] 明示的0-step自動承認は引き続き機能する（1人テナント運用を壊さない）
- [ ] 他テナントのattachment_id / created_byを指定したcontracts INSERTがDBトリガーで拒否される
- [ ] draft→terminated遷移について意図した仕様か報告に一言明記する
- [ ] 修正後、クリーンDBで001〜009+今回の追加migrationを実行し、verify_schema.pyで
      追加テストを含めて全件PASSすることを確認する
- [ ] feature/p1-t1-contracts-table ブランチに追加コミット・pushし、比較URLを報告に含める

# ChatGPTレビュー時の確認観点
- 「承認ルール未設定→エラー」への変更が、既存のvendor_bill/expense_report等、Phase 0以前からの
  承認フローに影響を与えていないか（target_type='contract'に限定した変更になっているか）
- tenant整合性トリガーが、attachment_idがNULL（契約書PDF未添付）のケースを正しくスキップしているか
```

---

#### 【マージ指示プロンプト P1-T1-MERGE】mainへのマージ

ChatGPT(SO)よりP1-T1-FIXが「CONDITIONAL PASS（マージを止める問題なし）」と判定されたため、Geminiへマージを指示する。

```
# 指示
feature/p1-t1-contracts-table を main へマージしてください。
SO(ChatGPT)による判定（コミット48c8f56時点、CONDITIONAL PASSだがマージを止める問題はないと判断）
を得ています。
DEBT-005（RBAC API未強制）はP1-T3で、DEBT-006（自動承認ルールと通常ルールの混在防止）は
承認ルール管理API/UI実装時に対応することとし、今回のマージをブロックするものではありません。
マージ後、以下を確認し報告してください。
- main上でBackend/Frontendのテストを再実行して確認
- マージコミットハッシュ
- 作業ブランチ feature/p1-t1-contracts-table の削除（マージ済み後）
```

これでP1-T1は完了。次はP1-T2（契約書アップロード〜AI条項抽出フロー）へ進む。

---

#### 【指示プロンプト P1-T2】契約書アップロード〜AI条項抽出フロー

```
# 背景・目的
P0-T3で「汎用AI提案インターフェース」と契約書向けの下書き抽出（extractContractTerms() /
generateContractSuggestion()、ルールエンジンによるPoC実装）を用意し、P1-T1で実際の
contractsテーブルとステータス遷移・承認統合を実装した。本タスクでは、これらを実際に
つなぎ込み、「PDFアップロード → AI提案 → 人間確認 → contracts確定」という一連のフローを
完成させる。同時に、Phase 0から持ち越している DEBT-002 / DEBT-003 をこのタイミングで解消する。

# 前提となる既存実装（必ず先に読むこと）
- P0-T3の成果物: ai_suggestions テーブル、generateGenericSuggestion() / generateContractSuggestion()
  / extractContractTerms()
- P0-T2の成果物: attachments.document_category（'contract'を含む）
- P1-T1の成果物: contracts テーブル、ステータス遷移トリガー、tenant整合性トリガー
- 本計画書 DEBT-002（confidence runtime validation未実装）、DEBT-003（model_nameが実態と乖離）

# やってはいけないこと
- AI提案（ai_suggestions）から contracts テーブルへの書き込みを、人間の確認・確定操作を経ずに
  自動で行わない。既存原則「AI提案 → 人間承認 → Core API → DB制約」を厳守する。
- 既存のOCR（レシート等）のAI提案フローに回帰を起こさない。

# 実装対象
1. **DEBT-003の解消**: generateContractSuggestion()のmodel_nameデフォルト値を
   'claude-3-5-sonnet-20241022'から、実態に即した値（例: provider='rule_engine',
   model_name='contract-extractor-v1'）に修正する。将来LLMベースの抽出に切り替える際に
   provider='anthropic'等へ変更できる構造は維持する。
2. **DEBT-002の解消**: suggested_fields.*.confidence および confidenceScore に対し、
   共通スキーマ（Zod等）で0〜1の範囲をruntime validationする。範囲外の値が渡された場合は
   保存前にエラーとする。
3. 契約書アップロードAPI: document_category='contract'でattachmentsに登録された文書に対し、
   AIゲートウェイでcontract term抽出を実行し、ai_suggestionsに
   target_type='contract'（対象のcontracts.idがまだ存在しない場合は一時的にattachment_id等で
   紐付ける設計とする）として保存するエンドポイントを実装する。
4. 人間確認UI: 抽出された suggested_fields（契約期間・金額・自動更新条項・相手先名等）を
   フィールドごとにconfidenceとともに表示し、人間が値を確認・修正した上で「確定」操作を行うと、
   その内容でcontracts（P1-T1のCRUD API）にdraftレコードを作成/更新するフローを実装する。
   この「確定」操作は既存のcontracts CRUD APIを呼び出す形とし、AIゲートウェイ側に
   確定処理の権限を持たせない。
5. 実DB E2Eテストに、契約書PDFアップロード→AI提案生成→人間確認→contracts確定までの
   一連のフローを追加する。

# 受け入れ基準（Definition of Done）
- [ ] DEBT-002: 範囲外のconfidence値（例: 1.5, -0.3）を渡すとAI提案保存時にエラーになることを確認
- [ ] DEBT-003: 契約書提案のmodel_name/providerが実態（ルールエンジン）を正しく表している
- [ ] 契約書PDFアップロードからAI提案生成までのフローが動作する
- [ ] AI提案は人間の確認・確定操作を経ずにcontractsへ書き込まれない
      （ai_suggestionsサービスがcontractsテーブルを直接更新していないことをコードで確認）
- [ ] 人間確認画面で修正した値がcontractsのdraftレコードへ正しく反映される
- [ ] 既存のレシートOCR→科目提案フローに回帰がないことを確認
- [ ] Phase 0で確立した実DB E2E検証基盤（クリーンDB×verify_schema.py）で、本タスクの
      新規テストケースを含めて全件PASSすることを確認し、結果を報告に添付する
- [ ] feature/p1-t2-contract-ai-extraction ブランチにコミット・pushし、比較URLを報告に含める
      （本計画書0.4節に従う）

# ChatGPTレビュー時の確認観点
- AIゲートウェイ側のコードが、確認・確定前のcontractsテーブルへの書き込み権限を一切持っていないか
  （P0-T3で確立した境界がP1-T2でも維持されているか）
- confidence validationがJSONB保存経路の全箇所（既存OCR経路含む）に一貫して適用されているか
- model_name/providerの修正が、既存のOCR提案（実際にLLMを呼んでいる場合）の値まで
  誤って書き換えていないか（契約書向けのルールエンジン経路にのみ適用されているか）
```

---

#### 【フォローアップ指示プロンプト P1-T2-FIX】REQUEST CHANGES対応（PDF本文の実読込が未実装）

ChatGPT(SO)よりP1-T2が「REQUEST CHANGES」と判定されたため、以下をGeminiに指示する。

**重要**: 今回の指摘は他のタスクより重大度が高い。「56/56 PASS」という報告があったにもかかわらず、
`ContractsService.extractTerms()` が実際にはアップロードされたPDFを一切読まず、
固定のテスト用文章（テスト株式会社、パートナー企業、2026年4月1日〜等のハードコード文字列）を
抽出エンジンへ渡していたことが実コード確認で判明した。テストが通っていることと機能が実際に
動作することは別問題であるという、このプロジェクトが繰り返し確認してきた教訓が今回も当てはまる。

```
# SOレビュー結果：P1-T2 REQUEST CHANGES
main...feature/p1-t2-contract-ai-extraction の実差分（コミット923ccfd）を確認した結果、
現状はマージ不可です。以下を修正してください。

# BLOCKER-01: PDF本文が実際には読み込まれていない
ContractsService.extractTerms() は、raw_textが渡されなかった場合に固定のテスト用文章
（「甲: テスト株式会社」「乙: パートナー企業」等のハードコード文字列）を契約書本文として
抽出エンジン（extractContractTerms）へ渡しています。つまり、実際にアップロードしたPDFの
内容に関わらず、常に同じ固定文章から抽出しているだけの状態です。フロントエンドからのPDF
アップロード自体は正しく行われていますが、抽出処理側でそのPDFのstorage_path・PDF実体・
PDFテキストが一切取得・利用されていません。

## 修正方針
1. attachments.storage_path を使ってPDF実体を取得し、PDFテキスト抽出ライブラリ
   （例: pdf-parse、pdfjs-dist等、既存の依存関係やライセンスと矛盾しないもの）を用いて
   実際のPDF本文をテキストとして取り出す処理を実装する。
2. extractTerms() は、この実際に抽出したテキストを contractText として
   extractContractTerms() / generateContractSuggestion() に渡すよう修正する。
   固定のテスト用文章を返すフォールバックは、テストコード側（fixture）にのみ残し、
   本番相当のサービスロジックからは完全に除去する。
3. PDFがスキャン画像のみで構成されテキスト抽出できない場合（本文0文字等）の扱いを決め、
   その場合はconfidenceを低く設定する、またはAI提案自体を生成せずエラーを返す、
   のいずれかの方針を報告に明記する（どちらでも構わないが、無言で固定テキストにフォール
   バックすることだけは避けること）。
4. 実DB E2Eテストに、実際に既知のテキストを含むPDFファイルをアップロードし、
   抽出されたsuggested_fieldsがそのPDFの内容（例: 契約金額、契約期間）と一致することを
   確認するテストを追加する。これまでのようなmockベースのテストや、固定文章に対する
   テストだけでは「56/56 PASS」であってもこの指摘の解消とはみなさない。

# MINOR-01: providerフィールドの完了報告と実装の不一致
完了報告で「model_name='contract-extractor-v1'（provider='rule_engine'）」と記載されていますが、
実装を確認する限り provider をDBに保存する設計が見当たりません。以下のいずれかに揃えてください。
  (a) ai_suggestionsにprovider列を追加し、実際に'rule_engine'として保存する（将来の
      マルチプロバイダ対応を見据えるなら望ましい）
  (b) providerを保存しない設計のままなら、完了報告からproviderに関する記述を削除し、
      model_nameのみで実態を表現する
どちらを選んだか報告に明記してください。

# MINOR-02: AI suggestionのtarget_typeと監査ログのtargetTypeの不一致（今回は要整理のみ、修正必須ではない）
現状 target_type='contract' / target_id=<attachment.id> としている一方、監査ログ側は
targetType='attachment' / targetId=<attachment.id> となっており、論理的な対象がずれています。
契約レコード（contracts.id）がまだ存在しない抽出段階であることを踏まえると、
target_type='attachment'に統一する方が自然である可能性があります。今回のP1-T2-FIXで
修正必須ではありませんが、どちらの方針を取るか報告に一言記載し、必要であれば
P1-T3着手前に正式決定してください。

# 受け入れ基準（Definition of Done）
- [ ] 既知のテキストを含む実PDFをアップロードし、そのPDF本文に基づいた条項抽出結果が
      ai_suggestionsに保存されることを実DB E2Eで確認する（固定テスト文章への依存を排除）
- [ ] サービスロジックのどこにも「PDFが読めない場合に固定のダミー契約文章へフォールバックする」
      経路が残っていないことをコードで確認できる
- [ ] providerフィールドの扱い（実装するか、完了報告の記述を修正するか）が明確になっている
- [ ] target_type/targetの不一致について、方針（今回は現状維持でも可）を報告に明記する
- [ ] 修正後、クリーンDBでverify_schema.pyを含む実DB E2Eを再実行し、全件PASSの結果を報告に添付する
- [ ] feature/p1-t2-contract-ai-extraction ブランチに追加コミット・pushし、比較URLを報告に含める

# ChatGPTレビュー時の確認観点
- 追加された実PDF E2Eテストが、本当に「PDFの内容によって抽出結果が変わる」ことを証明しているか
  （例: 異なる金額を含む2種類のPDFをアップロードして、それぞれ異なる抽出結果になることを
  確認できているとより強い）
- PDFテキスト抽出に失敗した場合（スキャン画像PDF等）のエラーハンドリングが、無言のフォール
  バックになっていないか
```

---

#### 【マージ指示プロンプト P1-T2-MERGE】mainへのマージ

ChatGPT(SO)よりP1-T2-FIXが正式PASS（実PDF内容依存性をE2Eで確認済み）と判定された。

```
# 指示
feature/p1-t2-contract-ai-extraction を main へマージしてください。
SO(ChatGPT)による正式PASS判定を得ています（PDF本文の実読込、内容依存性の実DB E2E確認、
providerフィールドの実装、confidence validationの維持、AI/Human境界の維持を確認済み）。
スキャンPDF/OCR未対応はDEBT-007として、ai_suggestionsのtarget_type/target_id正式決定は
P1-T3で対応することとし、今回のマージをブロックするものではありません。
マージ後、以下を確認し報告してください。
- main上でBackend/Frontendのテストを再実行して確認
- マージコミットハッシュ
- 作業ブランチ feature/p1-t2-contract-ai-extraction の削除（マージ済み後）
```

これでP1-T2は完了。次はP1-T3（契約RBAC強制・AI提案ライフサイクル正式化）へ進む。

---

#### 【指示プロンプト P1-T3】契約RBAC強制・AI提案ライフサイクル正式化

```
# 背景・目的
P1-T1で契約の状態遷移・既存承認エンジンとの統合（承認完了→active）は既に実装済みであり、
当初計画書のP1-T3「承認ワークフロー統合」は実質的にP1-T1で先行達成されている。
そのため本タスクは、これまでのSOレビューで持ち越されてきた3つの残課題の解消に
スコープを絞る。

# 前提となる既存実装
- P0-T4: legal_admin / legal_viewer 等のRBACロール・permission定義（contract.create/view/edit/
  approve/terminate）
- P1-T1: contracts のCRUD API、状態遷移トリガー、tenant整合性トリガー
- P1-T2: PDF→AI提案フロー、ai_suggestions.provider列
- 本計画書 DEBT-005（RBAC API未強制）、DEBT-006（自動承認ルールの混在防止）

# やってはいけないこと
- 既存のTenantAuthGuardによるtenant分離チェックを、permissionチェック追加によって
  弱めたり置き換えたりしない（両方とも独立して機能する必要がある）。
- fn_prevent_self_approval() の既存ロジックを変更しない。

# 実装対象

## 1. DEBT-005: contract permissionのAPI認可強制
ContractsController の各エンドポイントに、P0-T4で定義したpermission
（contract.create/view/edit/approve/terminate）を明示的にチェックするGuard/Decoratorを追加する。
- POST /contracts → contract.create
- GET /contracts, GET /contracts/:id → contract.view
- PUT /contracts/:id → contract.edit
- POST /contracts/:id/submit-approval → contract.create または contract.edit（要判断、
  既存の承認申請権限との整合を報告に明記）
- 承認/却下（既存approval-requestsのapproveエンドポイント経由、target_type='contract'の場合）
  → contract.approve
- 解約（terminated遷移） → contract.terminate
legal_viewerでの書き込み系エンドポイント呼び出しが403で拒否されることを実DB E2Eで確認する。

## 2. ai_suggestions.target_type / target_id のライフサイクル正式化
P1-T2で議論した通り、抽出段階ではcontracts.idがまだ存在しないため、
target_type='attachment' / target_id=<attachment.id> に統一する方針を正式採用する
（監査ログのtargetTypeとも一致させる）。契約が実際に作成された後は、
ai_suggestionsとcontractsの関連を別途（例: contracts.source_suggestion_id等）記録する
設計とする。この変更に伴うマイグレーション・既存データの扱いを検討し、実装する。

## 3. DEBT-006: 自動承認ルールと通常ルールの混在防止
承認ルール（approval_rules）に対し、is_explicit_auto_approve=trueのルールが、同一ルール
セット内に1ステップ以上の通常ルールと共存できないよう、DB制約またはアプリケーション層の
バリデーションを追加する。

# 受け入れ基準（Definition of Done）
- [ ] legal_viewerロールで契約の作成・編集・承認・解約を試みると403で拒否される
- [ ] legal_admin / owner等、適切な権限を持つロールでは従来通り操作できる
- [ ] ai_suggestionsのtarget_type/target_idが監査ログと一貫した意味付けになっている
- [ ] 自動承認ルールと通常ルールの混在がDB/アプリのいずれかで防止される
- [ ] Phase 0で確立した実DB E2E検証基盤で、上記すべてを実PostgreSQL上で確認し、
      結果を報告に添付する
- [ ] feature/p1-t3-rbac-and-lifecycle ブランチにコミット・pushし、比較URLを報告に含める
      （本計画書0.4節に従う）

# ChatGPTレビュー時の確認観点
- permissionチェックの追加が、既存のP0-T1〜P1-T2で確立したRLS・SoD・tenant分離の
  いずれも弱めていないか（多層防御の1層が増えただけになっているか）
- target_type変更のマイグレーションが、既存のai_suggestionsデータを破壊していないか
```

---

#### 【フォローアップ指示プロンプト P1-T3-FIX】REQUEST CHANGES対応（同時実行耐性・tenant整合性の穴）

ChatGPT(SO)よりP1-T3が「REQUEST CHANGES」と判定されたため、以下をGeminiに指示する。DEBT-005（RBAC強制）、target_type正式化、AI provenance（source_suggestion_id）の設計方針そのものは評価されており、修正対象は以下の2点に限定される。

```
# SOレビュー結果：P1-T3 REQUEST CHANGES
main...feature/p1-t3-rbac-and-lifecycle の実差分（コミットb43b4e0）を確認した結果、
現状はマージ不可です。DEBT-005のAPI RBAC実装、target_type='attachment'への統一、
source_suggestion_idによるAI provenance追跡という設計方針自体は評価できます。
以下2点のみを修正してください。

# BLOCKER-01: DEBT-006トリガーの同時実行耐性
trg_prevent_auto_approve_mix は、同一(tenant_id, target_type)に対して自動承認ルールと
通常承認ルールが同時にINSERTされた場合、それぞれのトランザクションが相手の未commit行を
READ COMMITTED下で見えないため、両方が「反対側のルールは存在しない」と判定してしまい、
結果として混在を許してしまいます（逐次実行のテストではこの問題は表面化しません）。

## 修正方針
トリガー内で、対象となる(tenant_id, target_type)の組み合わせについて
pg_advisory_xact_lock（トランザクションスコープのadvisory lock）を取得してから
存在確認を行うようにし、同一(tenant_id, target_type)への並行INSERT/UPDATEを直列化してください。
例:
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':' || NEW.target_type, 0));
  （その後で既存の存在確認クエリを実行）
このロックはトランザクション終了時に自動解放されるため、明示的なUNLOCKは不要です。

## 追加テスト
自動承認ルールと通常ルールをほぼ同時に並行INSERTする統合テスト（2つのDB接続/トランザクションを
用いた並行実行テスト）を追加し、どちらか一方が確実に拒否されることを確認してください。
逐次実行のテストだけでは今回の指摘の解消とはみなしません。

# BLOCKER-02: source_suggestion_idのtenant整合性がDB未保証
contracts.source_suggestion_id は ai_suggestions(id) へのFKですが、参照先のtenant_idが
contracts.tenant_idと一致することはアプリケーション層のSELECTチェックでのみ担保されており、
DB制約としては保証されていません。P1-T1で attachment_id / created_by について実装した
tenant整合性トリガー（fn_validate_contract_tenant_consistency()）と同じ考え方で、
source_suggestion_idについても同様の検証をこのトリガー関数に追加してください。

## 修正方針
fn_validate_contract_tenant_consistency() に、source_suggestion_idが設定されている場合、
参照先ai_suggestionsのtenant_idがcontracts.tenant_idと一致することを検証する処理を追加する
（NULLの場合はスキップ）。不一致の場合はINSERT/UPDATEを拒否する。

## 追加テスト
Tenant Aのcontractに対し、Tenant Bのai_suggestions.idをsource_suggestion_idとして
直接INSERTしようとするとDBトリガーで拒否されることを実DB E2Eで確認してください。

# 修正不要（今回は記録のみ）
- PermissionsGuardの静的マップとDBのrole_permissionsの二重管理（RBACドリフトのリスク）は
  今回のP1-T3では修正不要です。DEBT-008として計画書側で追跡します。

# 受け入れ基準（Definition of Done）
- [ ] 自動承認ルール・通常ルールの並行INSERTテストで、確実にどちらか一方が拒否される
      （advisory lockによる直列化が機能している）
- [ ] Tenant Bのai_suggestionsを参照するsource_suggestion_idでのcontracts INSERT/UPDATEが
      DBトリガーで拒否される
- [ ] 既存の逐次実行テスト（前回追加分）に回帰がない
- [ ] 修正後、クリーンDBでverify_schema.pyを含む実DB E2Eを再実行し、並行実行テストを含めて
      全件PASSの結果を報告に添付する
- [ ] feature/p1-t3-rbac-and-lifecycle ブランチに追加コミット・pushし、比較URLを報告に含める

# ChatGPTレビュー時の確認観点
- advisory lockのキー設計（tenant_id + target_typeのhash）が、異なるtarget_type間で
  不要な直列化（ロック競合）を起こしていないか
- source_suggestion_idのtenant整合性トリガーが、NULLの場合を正しくスキップしているか
```

---

#### 【マージ指示プロンプト P1-T3-MERGE】mainへのマージ ＋ マージ後の最終E2E

ChatGPT(SO)よりP1-T3-FIXが正式PASS（並行実行耐性・source_suggestion_idのtenant整合性を実DBで確認済み）と判定された。SOの推奨に従い、マージ後のmain上でも最終E2Eを1回実行する。

```
# 指示
feature/p1-t3-rbac-and-lifecycle を main へマージしてください。
SO(ChatGPT)による正式PASS判定を得ています（DEBT-005/006の解消、source_suggestion_idの
tenant整合性、並行INSERT耐性を実DB E2E 67/67で確認済み）。
DEBT-008（RBAC静的マップとDBの二重管理）は計画書側で追跡することとし、
今回のマージをブロックするものではありません。
マージ後、以下を確認し報告してください。
- main上でクリーンDBに対しverify_schema.pyを含む実DB E2Eを再実行し、全件PASSを確認する
  （SOの推奨により、マージ前の検証だけでなくマージ後のmain自体でも最終確認を行う）
- Backend/Frontendのテストを再実行して確認
- マージコミットハッシュ
- 作業ブランチ feature/p1-t3-rbac-and-lifecycle の削除（マージ済み後）
```

これでP1-T3は完了。次はP1-T4（契約期限アラート・バッチ）へ進む。

---

#### 【指示プロンプト P1-T4】契約期限アラート・バッチ

```
# 背景・目的
契約書の満了・自動更新期限が近づいたら、テナントの担当者へ通知する機能を実装する。
1人テナント運用では、担当者が個別に契約期限を追跡し続けるのは現実的でないため、
この通知機能は「AIエージェントによる最大効率化」というプロダクトコンセプトの
重要な一部となる。

# 前提となる既存実装
- P1-T1: contracts テーブル（end_date, auto_renewal, renewal_notice_days, status等）
- 既存の audit_logs / RLS / マルチテナント設計全般

# やってはいけないこと
- バッチ処理が全テナントのデータを横断的に扱う都合上、DBの実行ユーザーでRLSを
  バイパスする（BYPASSRLS権限を使う、あるいはRLSを一時的に無効化する）ような実装をしない。
  必ずテナントごとにループし、各テナント処理の冒頭で
  SET LOCAL app.current_tenant_id = '<tenant_id>' を設定した上でクエリを実行すること
  （これがこのプロジェクトで初めての「全テナット横断バッチ」なので、RLSの原則を
  破らない実装パターンをここで確立する）。
- 通知未達（メール送信失敗等）によってバッチ全体が異常終了し、他テナントの通知処理まで
  巻き添えにする設計にしない（1テナントの失敗が他テナントに影響しないようにする）。

# 実装対象
1. notifications テーブルを新規作成する（tenant_id, type, target_type, target_id, title,
   body, status(unread/read), created_at等）。既存のattachments/approval_requests等と
   同様にRLS（ENABLE + FORCE）を適用する。
2. バッチワーカー（@nestjs/scheduleのCron、または既存の実行方式があればそれに合わせる）を実装し、
   1日1回、以下を行う。
   - 全テナントをループ
   - 各テナントについて、SET LOCAL app.current_tenant_id を設定した上で、
     status='active' の contracts のうち、end_date が
     (今日 + renewal_notice_days)以内に到達するものを抽出
   - 該当契約ごとに、まだ同じ内容の未読通知が存在しなければnotificationsへ1件作成
     （同じ契約に対する重複通知を防ぐ）
   - auto_renewal=trueの契約は「自動更新されます」、falseの契約は「満了します。更新手続きが
     必要です」等、内容を分ける
3. 通知一覧取得API（GET /notifications）と既読化API（PATCH /notifications/:id/read）を実装する。
4. フロントエンドに簡易的な通知一覧（バッジ表示程度でよい）を追加する。

# 受け入れ基準（Definition of Done）
- [ ] end_dateがrenewal_notice_days以内に迫ったactive契約に対して通知が生成される
- [ ] 同じ契約に対して重複通知が作られない
- [ ] 1テナントのバッチ処理でエラーが発生しても、他テナントの処理が継続することを確認する
- [ ] 他テナントの通知が一切見えないことをRLSで確認する
- [ ] バッチ処理がSET LOCAL app.current_tenant_idを経由せずにcontracts/notificationsへ
      アクセスしていないことをコードで確認できる（RLSバイパスの禁止）
- [ ] 実DB E2Eで、複数テナント・複数契約（通知対象/対象外が混在するデータ）を用意し、
      正しいテナントの正しい契約にのみ通知が生成されることを確認する
- [ ] feature/p1-t4-contract-expiry-alerts ブランチにコミット・pushし、比較URLを報告に含める
      （本計画書0.4節に従う）

# ChatGPTレビュー時の確認観点
- これがプロジェクト初の「全テナント横断バッチ」であるため、RLSバイパスに頼らず
  テナントごとのSET LOCALで処理する設計が本当に一貫しているか、実装の隅々まで確認してほしい
  （バッチ処理は往々にして「管理者権限で全部見えた方が楽」という誘惑に負けやすい箇所）
- 通知の重複防止ロジックが、バッチが日次で複数回実行された場合や、リトライされた場合にも
  正しく機能するか
```

---

## 3.4 決定事項: ロール・権限の粒度方針

- **方針**: 権限を細分化し、権限外の領域は閲覧も含めて不可とする（deny-by-default）。既存のRLSが「fail-closed（未設定・不一致時は0件返却）」の原則を採っているため、この方針とも整合的。
- **対応タイミング**: P0-T4（法務向けロール追加）では最小限のロール(`legal_admin`/`legal_viewer`)のみ用意し、細粒度の権限設計（契約種別ごと、金額しきい値ごと等）はPhase 1でUI/運用が固まってから着手する。基盤（`roles`/`permissions`/`role_permissions`のテーブル構造）自体は既に細分化可能な設計になっているため、後追いでの拡張コストは低いと判断。
- **P0-T4のDoDへの影響**: 「新ロールでログインしたユーザーが権限のないテーブルにアクセスできないこと」の確認は引き続き必須。今回追加するのは前提となるロール骨格のみで、権限マトリクスの最終形ではない点をレビュー時にも明記しておく。

---

## 4. 既知の技術的負債・フォローアップ事項

タスク完了時にSOが「修正不要だが記録すべき」と判定した事項を追跡する。将来の関連タスク着手時に必ず参照すること。

| ID | 発見タスク | 内容 | 重要度 | 対応予定 | ステータス |
|----|-----------|------|--------|----------|-----------|
| DEBT-001 | P0-T2 | `AttachmentsService.upload()` がファイル実体をディスクへ書き込んだ後にDB transactionを実行しており、DB rollback時に孤児ファイルが残り得る（原子性がない）。MVP・ローカルディスク保存の間は許容するが、S3等のオブジェクトストレージへ移行する際は、DB transaction・object storage・補償処理(transactional outbox等)を含めた整合性設計を正式に行う。 | MEDIUM | Phase 5（統合最適化）またはストレージ本格化タイミングで再評価 | 🔴 未対応 |
| DEBT-002 | P0-T3 | `suggested_fields.*.confidence` および `confidenceScore` に0〜1の範囲制約がTypeScript型・Zod入力・JSONB内部のいずれでも実行時に保証されていない。DB制約はJSONB内部までは及ばないため、異常値（例: 1.5, -0.3）が保存され得る。共通スキーマに`z.number().min(0).max(1)`等のruntime validationを追加する必要がある。 | MEDIUM | AIゲートウェイ正式化（複数プロバイダ対応）タイミングで対応 | 🔴 未対応 |
| DEBT-003 | P0-T3 | 契約書条項抽出（`extractContractTerms()`）は現状ルールエンジン（正規表現ベース）だが、`generateContractSuggestion()`の`model_name`デフォルト値が`claude-3-5-sonnet-20241022`になっており、実際にはLLMを呼んでいないのに監査データ上はClaudeが生成したように見える。`provider='rule_engine'`, `model_name='contract-extractor-v1'`等、実態に即した値に修正し、将来的にはAI Provider/Gateway抽象化（Claude/Gemini/OpenAI/Rule Engineを共通payloadで扱う設計）を正式化する。 | MEDIUM（会計SaaSとして監査追跡性に影響） | Phase 1でAI条項抽出を本格実装するタイミングで対応必須（それまでの暫定値として認識しておく） | 🔴 未対応（**P1-T2で必須対応**） |
| DEBT-004 | P0-T4 | 開発・レビュー環境に`psql`クライアントが存在せず、`npm run db:migrate` / `verify_schema.py`のDB接続を伴う実行（実DB E2E検証）が未実施のまま。SQLの静的な安全性（migration runnerの実行順序等）は確認済みだが、実DBに対する動作確認ができていない。CI環境またはローカル開発環境に`psql`（またはコンテナ経由のPostgreSQLクライアント）を整備し、今後のmigrationタスクで実DB E2E確認を標準化する。 | MEDIUM（開発環境整備） | Phase 1のP1-T1（contractsテーブル実装、実DB検証が必須）着手前に対応推奨 | ✅ 解消（P0-T5、実DB E2E 34/34 PASS確認済み） |
| DEBT-005 | P1-T1 | ContractsControllerのCRUD/承認申請APIが`TenantAuthGuard`は通しているが、P0-T4で整備した`contract.create/view/edit/approve/terminate`のpermission（RBAC）を明示的にチェックしていない（既存vendor-bills等と同じパターンを踏襲した結果）。`legal_viewer`が閲覧専用のはずが、現状のAPI実装だけでは書き込み系エンドポイントを呼べてしまう可能性がある。 | MEDIUM〜HIGH（権限外操作の防止に直結） | **P1-T3（契約承認ワークフロー統合）着手時に対応必須** | ✅ 解消（P1-T3、PermissionsGuard導入・Service層でも二重確認済み） |
| DEBT-006 | P1-T1-FIX | `is_explicit_auto_approve=true`の0-stepルールと、1ステップ以上の通常承認ルールが同一ルールセット内に混在していても、現状のロジックは自動承認ルールを優先して選択してしまう（この組み合わせ自体を防ぐ制約がない）。承認ルール管理API/UIを実装する際に、「0-step自動承認ルールは他のstepと同一ルールセットに共存させない」という制約を追加する必要がある。 | LOW〜MEDIUM | 承認ルール管理API/UIの実装タイミング（Phase 1後半、または P1-T3の一部として） | ✅ 解消（P1-T3-FIX、pg_advisory_xact_lockによる並行実行耐性を実DBで確認済み） |
| DEBT-007 | P1-T2 | 現在のPDFテキスト抽出は、テキストが埋め込まれたPDFのみに対応しており、スキャン画像PDF・画像のみのPDFは本文抽出不能として400エラーを返す（フォールバックでダミー処理はしない、安全側の設計）。ただし実際の契約書運用ではスキャンPDFが一定割合存在するため、将来的にはOCR経路（文字なしPDF→OCR→抽出）を追加する必要がある。 | LOW（現状はfail-closedで安全、機能制約のみ） | 契約書アップロード運用の実績を見て、スキャンPDF比率が無視できない場合に対応 | 🔴 未対応（意図的な機能制約として現状維持） |
| DEBT-008 | P1-T3 | `PermissionsGuard`がDBの`role_permissions`テーブルを直接参照せず、静的マップ（ROLE_PERMISSIONS）を独自に保持しており、DB側のRBAC定義とAPI側の権限マップが二重管理になっている。将来DBで新しいroleやpermissionを追加・変更した際に、Guard側の静的マップを更新し忘れる「RBACドリフト」のリスクがある。 | LOW〜MEDIUM（将来の変更時に権限不整合を生むリスク） | RBAC管理API/UIを作る際、またはロール定義の変更頻度が増えたタイミングでDB参照方式へ統一を検討 | 🔴 未対応 |

---

## 5. 次のアクション

1. 本計画書の内容で問題なければ、**P0-T1から順にGeminiへ指示プロンプトを渡して実装開始**。
2. Phase 0が完了し次第、Phase 1のP1-T2以降のプロンプトを実際のコード状態を踏まえてClaudeが作成する。
3. Phase 2（購買・調達）以降のタスク分解は、Phase 1完了後にあらためて計画書へ追記する。

---

## 6. 変更履歴

| バージョン | 日付 | 内容 |
|------------|------|------|
| 1.0.0 | 初版 | 全体ロードマップ策定、Phase 0/Phase 1のタスク分解と実装指示プロンプト作成 |
| 1.1.0 | ロール・権限の粒度方針（deny-by-default、細分化は後追い）を決定事項として記録 |
| 1.2.0 | 完了報告ルール（0.4節: コミット・push必須、mainへの独断マージ禁止）を追加。P0-T1のSO指摘事項に対応するフォローアップ指示プロンプト（P0-T1-FIX）を追加。P0-T2〜T4, P1-T1のDoDにコミット・push要件を追記 |
| 1.3.0 | コミット77eb503の実コードレビュー結果を反映。責務分離の懸念は解消を確認。migrationへの本番データINSERT混入という唯一の残課題に対応するP0-T1-FIX2プロンプトを追加 |
| 1.4.0 | P0-T1がSO正式PASS（コミット96ffcf4）。マージ指示プロンプト（P0-T1-MERGE）を追加し、タスク一覧にステータス列を追加してP0-T1を完了扱いに更新 |
| 1.5.0 | P0-T2がSO判定CONDITIONAL PASS（コミット6ddd3cb、追加修正不要）。「既知の技術的負債・フォローアップ事項」セクション(4節)を新設しDEBT-001（ファイル保存とDBトランザクションの非原子性）を記録。マージ指示プロンプト（P0-T2-MERGE）を追加しP0-T2を完了扱いに更新 |
| 1.6.0 | P0-T3がSO判定CONDITIONAL PASS（コミットe01384d、追加修正不要）。DEBT-002（confidence値のruntime validation未実装）、DEBT-003（model_nameが実態と乖離）を記録。P1-T2にDEBT-003対応必須の注記を追加。マージ指示プロンプト（P0-T3-MERGE）を追加しP0-T3を完了扱いに更新 |
| 1.7.0 | P0-T4がSO判定REQUEST CHANGES（ENUM追加直後の同一トランザクション使用問題、完了報告と実装の権限矛盾）。フォローアップ指示プロンプト（P0-T4-FIX）を追加し、P0-T4を「要修正・再レビュー待ち」に更新。あわせてP0-T2見出しの欠落を修正（内容自体に変更なし） |
| 1.8.0 | P0-T4-FIX（コミット1ef636e）がSO判定CONDITIONAL PASS。ENUM分割・既存ロール権限整合の2指摘は解消を確認。残る確認事項（実DB migration実行）に対応するP0-T4-VERIFYプロンプトを追加 |
| 1.9.0 | P0-T4がSO正式PASS（コミット470f2dc）。実DB E2E未実施をDEBT-004として記録。マージ指示プロンプト（P0-T4-MERGE）とPhase 0→Phase 1の引継ぎ事項サマリを追加し、**Phase 0を全タスク完了**として更新 |
| 2.0.0 | DEBT-004解消の方針決定を受け、**P0-T5（開発環境へのpsql整備＋実DB migration E2E確認）を新設**。P1-T1の依存にP0-T5を追加し、Phase 1着手前の必須タスクとして位置付け |
| 2.1.0 | P0-T5がSO判定REQUEST CHANGES（Docker fallbackがDATABASE_URLを無視し、意図しないDBへ接続するリスク）。フォローアップ指示プロンプト（P0-T5-FIX）を追加し、P0-T5を「要修正・再レビュー待ち」に更新 |
| 2.2.0 | P0-T5がSO正式PASS（Docker fallback修正確認、実DB E2E 34/34 PASS）。DEBT-004を解消済みに更新、DEBTログにステータス列を追加。マージ指示プロンプト（P0-T5-MERGE）とPhase 0完全クローズのサマリを追加。**Phase 0が全5タスク完了**。P1-T1のDoDに実DB E2E検証（Phase 0で確立した基盤を前提）を必須として追記 |
| 2.3.0 | P0-T5のmainマージ完了報告を反映（マージコミットb57968a、main上での再検証結果全PASS）。**Phase 0が正式にクローズ**。Phase 1（P1-T1）着手可能な状態に |
| 2.4.0 | P1-T1がSO判定REQUEST CHANGES（承認ルール未設定時の暗黙自動承認、tenant整合性のDB未保証）。フォローアップ指示プロンプト（P1-T1-FIX）を追加。DEBT-005（RBAC API未強制、P1-T3で対応必須）を記録。Phase 1タスク一覧にステータス列を追加しP1-T1を「要修正・再レビュー待ち」に更新 |
| 2.5.0 | P1-T1-FIX（コミット48c8f56）がSO判定CONDITIONAL PASS（マージを止める問題なしと判断）。DEBT-006（自動承認ルールと通常ルールの混在防止）を記録。マージ指示プロンプト（P1-T1-MERGE）を追加しP1-T1を完了扱いに更新。**P1-T2（契約書アップロード〜AI条項抽出フロー）の実装指示プロンプトを新規作成**。DEBT-002/DEBT-003の解消をP1-T2のDoDに組み込み |
| 2.6.0 | P1-T2がSO判定REQUEST CHANGES（重大: PDF本文が実読込されず固定テスト文章にフォールバックしていた。テスト56/56 PASSでも機能未達）。フォローアップ指示プロンプト（P1-T2-FIX）を追加。0.4節に「テストPASSは実動作の証明にならない」教訓を追記 |
| 2.7.0 | P1-T2-FIXが正式PASS（実PDF内容依存性をE2Eで確認、providerフィールド実装済み）。DEBT-007（スキャンPDF/OCR未対応、意図的な制約として現状維持）を記録。マージ指示プロンプト（P1-T2-MERGE）を追加しP1-T2を完了扱いに更新。**P1-T3のスコープを見直し**（承認ワークフロー統合はP1-T1で先行達成済みのため、DEBT-005のRBAC強制・ai_suggestionsのライフサイクル正式化・DEBT-006対応に再定義し、実装指示プロンプトを新規作成） |
| 2.8.0 | P1-T3がSO判定REQUEST CHANGES（DEBT-006トリガーの同時実行耐性の欠如、source_suggestion_idのtenant整合性がDB未保証）。フォローアップ指示プロンプト（P1-T3-FIX）を追加。DEBT-008（RBAC静的マップとDBの二重管理）を記録 |
| 2.9.0 | P1-T3-FIXが正式PASS（並行実行耐性をpg_advisory_xact_lockで実装、source_suggestion_idのtenant整合性トリガーを追加、実DB E2E 67/67）。DEBT-005/DEBT-006を解消済みに更新。マージ指示プロンプト（P1-T3-MERGE、マージ後の最終E2E含む）を追加しP1-T3を完了扱いに更新。**P1-T4（契約期限アラート・バッチ）の実装指示プロンプトを新規作成**（プロジェクト初の全テナント横断バッチとして、RLSバイパス禁止・テナントごとのSET LOCALを明示的に指示） |
| 3.0.0 | P1-T4実装完了。notificationsテーブル新設（RLS ENABLE+FORCE）、全テナント横断バッチワーカー（RLS非バイパス・テナントごとSET LOCAL・障害隔離・auto_renewal文面分岐・未読重複防止）、通知一覧/既読化API、フロントエンド通知バッジ/ドロップダウンを実装。実DB E2E全71項目完全PASS |
