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
4. push前の「報告のみ」の完了通知は受け付けない。実装が終わっていてもpushされていなければタスクは「未完了」として扱う。**すべての完了報告には、必ず`git rev-parse HEAD`で取得した正確なコミットSHAと作業ブランチ名を明記すること。** コミットSHAの記載漏れ・誤記（別タスクのSHAの流用等）は、SOがGitHub上で実装を特定できず正式レビューができない状態を生む。この問題はP0-T1、P1-T5-FIX3、P2-T3、P2-T3-FIXで繰り返し発生しているため、以後の全ての完了報告プロンプトのDoDに標準項目として含めること。
5. **テストが全件PASSしていることは、機能が実際に意図通り動作していることの証明にはならない。** 特に外部入力（PDF、ユーザー入力ファイル等）を扱うタスクでは、固定のfixtureやモックデータだけでなく、実際の入力データを使ったE2E検証をDoDに含めること（P1-T2で、テストは56/56 PASSしていたにもかかわらずPDF本文が実際には読み込まれず固定テキストで代替されていた事例、P2-T4でEXPLAIN検証が実質何でもPASSする無意味な判定になっていた事例、P3-T1で「週40時間計算関数」が実装・単体テストされていても実際の勤怠登録フローには接続されていなかった事例を教訓とする）。**「関数が存在する・単体テストがある」ことと「実際のアプリケーション経路で使われている」ことは別であり、E2Eは可能な限り実際のAPI/Serviceの呼び出し経路を通す設計にすること。**
6. **一度作成・適用済みのmigrationファイルは事後的に書き換えない（migrationはappend-onlyとする）。** スキーマ変更が必要になった場合は、既存ファイルを編集するのではなく必ず新しい番号のmigrationファイルを追加すること。`CREATE TABLE IF NOT EXISTS`等の冪等な記法は、新規DBの構築時にしか効かず、既に該当テーブルが存在する（＝そのタスクが一度でもmainへマージされた）DBには変更が反映されない。実DB E2Eが「クリーンDBに全migrationを最初から適用した場合」のみを検証しており、「既存DBへの段階的アップグレード」を検証していない場合、この問題を検出できない点にも注意する（P1-T5-FIXで、既存014マイグレーションを直接書き換えたためこの問題が発生した事例を教訓とする）。
7. **既存データに対して制約を後から追加するmigrationは、違反データを自動的に修正・削除してはならない。** 違反データを検出した場合はmigration自体をfail-closedで停止し、人間が内容を確認・修正した上で再実行する設計にすること。業務データ（金額、区分等）の意味を無断で変更する自動クレンジングは、会計・バックオフィス系システムでは特に避けること（P1-T5-FIX2で、負の金額を自動的にNULLへ、無効なcategoryを自動的にdefault値へ書き換える処理が発見された事例を教訓とする）。

---

## 1. 拡張ロードマップ全体像

実装順序は「①汎用化基盤への投資対効果」「②既存資産の再利用度」「③規制・専門性の複雑さ」の3軸で決定。複雑な人事労務を後回しにし、まず汎用ワークフローエンジンを固めてから横展開する設計。

| Phase | ドメイン | 主な機能 | 既存資産の再利用度 | 規制複雑度 | ステータス |
|-------|----------|----------|---------------------|-------------|-----------|
| **Phase 0** | 基盤汎用化 | 承認ワークフローエンジンの完全汎用化、汎用ドキュメント管理基盤 | −（投資フェーズ） | 低 | ✅ 完了（全5タスク） |
| **Phase 1** | 総務・法務 | 契約書管理、稟議申請、条項AI抽出、更新期限アラート | 高（承認・監査ログ・AI Gateway） | 中 | ✅ 完了（全6タスク） |
| **Phase 2** | 購買・調達 | 発注申請、サプライヤー管理、購買稟議 | 高（Phase0/1のワークフロー・帳票基盤） | 低〜中 | ✅ 完了（全4タスク） |
| **Phase 3** | 人事労務 | 勤怠管理、給与計算内製化、社保・年末調整 | 中（給与連携は既存、計算ロジックは新規） | 高（労働法制） | 🔵 着手中 |
| **Phase 4** | 営業事務 | 見積書、契約更新連携、案件管理 | 高（請求書発行・契約管理の延長） | 低 | 未着手 |
| **Phase 5** | 統合最適化 | 横断ダッシュボード、AIエージェントによる業務横断レコメンド | −（統合フェーズ） | 低 | 未着手 |

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
| P1-T4 | 契約期限アラート・バッチ | 満了/自動更新の一定日数前に通知を生成するバッチワーカー | P1-T1 | ✅ SO正式PASS（コミット、notification.batch_execute権限をowner限定で追加、DEBT-009を記録、mainマージ指示済み） |
| P1-T5 | 稟議申請（汎用ワークフロー起票UI） | 契約以外の一般的な稟議（購買以外の申請）もこの画面から起票できる汎用フォーム | P0-T1, P1-T1, P1-T3 | ✅ SO正式PASS（コミット60a0724、fail-closed migration・DEBT-010を記録、mainマージ指示済み） |
| P1-T6 | 契約書全文検索（pgvector活用） | 既存のjournal_entry_embeddingsと同様のパターンで契約書本文をベクトル化し類似契約検索を提供 | P1-T1, P1-T2 | ✅ SO正式PASS・mainマージ完了（マージコミット`bd697eb`、main上でE2E 97/97・Jest 102/102・typecheck/build全PASS再確認済み）— **Phase 1完了** |

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

#### 【フォローアップ指示プロンプト P1-T4-FIX】REQUEST CHANGES対応（全テナント横断バッチAPIの認可欠落）

ChatGPT(SO)よりP1-T4が「REQUEST CHANGES」と判定された。RLS非バイパス設計・DB側重複防止・
テナント単位の障害隔離は評価されており、修正対象は認可(RBAC)の1点に限定される。

**重要**: これはRLSが破られたわけではない。「RLSは正しく守られているが、そもそも
『全テナント横断のバッチ処理を誰が起動してよいか』という認可が存在しない」という、
RLSとは別レイヤーの問題である。

```
# SOレビュー結果：P1-T4 REQUEST CHANGES
main...feature/p1-t4-contract-expiry-alerts の実差分（コミット8c5365d）を確認した結果、
現状はマージ不可です。以下を修正してください。

# BLOCKER-01: run-expiry-batch APIに認可がない
POST /notifications/run-expiry-batch は @UseGuards(TenantAuthGuard) のみで、
PermissionsGuard / RequirePermissionsが設定されていません。このAPIは1テナントの
データだけでなく全有効テナントを横断して処理するため、通常のテナント内CRUD APIとは
性質が全く異なります。現状はログイン済みの一般ユーザーであれば誰でも呼び出せ、
かつレスポンスに他テナントのtenantIdを含むエラー情報が含まれてしまいます。

## 修正方針
1. 新しいpermission notification.batch_execute を定義し、P0-T4のRBAC体系に追加する
   （既存のcontract.*等と同じ形式で、role_permissionsへの割当も行う）。
   運用上は、owner等ごく限られたロールにのみ付与することを想定する
   （具体的にどのロールへ付与したか報告に明記すること）。
2. run-expiry-batch エンドポイントに @RequirePermissions('notification.batch_execute') を追加する。
3. レスポンスから他テナントのtenantIdを含む詳細エラー情報を除去する。
   バッチ実行者への応答は「成功件数」「失敗件数」程度の集計情報に留め、
   個別テナントの内部情報（tenantId等）を含めない。
   詳細なエラーはサーバーログにのみ出力する形にする。
4. notification.batch_execute権限を持たないロール（legal_viewer、accountant等）で
   このAPIを呼び出すと403になることを確認するテストを追加する。

# 修正不要（今回は記録のみ）
- notificationsに個人宛（recipient_user_id）の概念がなく、テナント内全員が共有する通知に
  なっている点は、今回のP1-T4では修正不要です。DEBT-009として計画書側で追跡します。

# 受け入れ基準（Definition of Done）
- [ ] notification.batch_execute権限を持たないユーザーがrun-expiry-batchを呼ぶと403になる
- [ ] 権限を持つユーザー（owner等）は従来通りバッチを実行できる
- [ ] レスポンスに他テナントのtenantId等、内部情報が含まれていない
- [ ] 既存のRLS非バイパス設計・テナント単位障害隔離に回帰がない
- [ ] 実DB E2Eで、権限あり/なしそれぞれのケースを確認し、結果を報告に添付する
- [ ] feature/p1-t4-contract-expiry-alerts ブランチに追加コミット・pushし、比較URLを報告に含める

# ChatGPTレビュー時の確認観点
- notification.batch_execute権限の割当ロールが、運用上妥当か（例えば全テナントのlegal_admin等、
  本来1テナント内に閉じるべきロールに誤って付与されていないか）
- エラーレスポンスの簡略化が、正当な権限者にとって障害調査に必要な情報まで削りすぎていないか
  （サーバーログ側で十分な情報が追えることを確認する）
```

---

#### 【マージ指示プロンプト P1-T4-MERGE】mainへのマージ

ChatGPT(SO)よりP1-T4-FIXが正式APPROVE（notification.batch_executeをowner限定に、cross-tenant情報のレスポンス秘匿を確認）と判定された。

```
# 指示
feature/p1-t4-contract-expiry-alerts を main へマージしてください。
SO(ChatGPT)による正式APPROVE判定を得ています（RBACによるバッチ実行制限、cross-tenant情報の
レスポンス秘匿、RLS非バイパス、tenant単位障害隔離、DB重複防止、実DB E2Eでの権限あり/なし検証を
確認済み、73/73 E2E・78 tests PASS）。
DEBT-008（RBAC静的マップとDBの二重管理）、DEBT-009（通知が個人宛でなくテナント共有）は
計画書側で追跡することとし、今回のマージをブロックするものではありません。
マージ後、以下を確認し報告してください。
- main上でBackend/Frontendのテストを再実行して確認
- マージコミットハッシュ
- 作業ブランチ feature/p1-t4-contract-expiry-alerts の削除（マージ済み後）
```

これでP1-T4は完了。次はP1-T5（稟議申請：汎用ワークフロー起票UI）へ進む。

---

#### 【指示プロンプト P1-T5】稟議申請（汎用ワークフロー起票UI）

```
# 背景・目的
これまでのPhase 1タスクはcontracts（契約書）という具体的なドメインテーブルに紐付いた
承認フローだったが、実際の総務・法務業務には「契約書のような専用テーブルを持たない、
自由記述の稟議」（備品購入の相談、社内規程の変更提案、出張申請等）も多数存在する。
本タスクでは、専用ドメインテーブルを持たない汎用的な稟議申請を、既存の承認エンジン
（approval_requests / approval_rules）にそのまま乗せられる形で実装する。

# 前提となる既存実装
- P0-T1: approval_requests / approval_rules のtarget_typeポリモーフィック設計、
  自己承認防止（fn_prevent_self_approval）
- P1-T1/P1-T3で確立した設計パターン: 明示的自動承認とルール未設定の区別、
  tenant整合性のDBトリガー保証、RBAC強制（PermissionsGuard + Service層での二重確認）
- P0-T4: RBACロール・permission体系

# やってはいけないこと
- 既存のcontract/purchase_request向け承認ロジックを変更・共有しすぎて密結合にしない。
  generalRequestsは独立したドメインテーブルとして扱う。
- P1-T1/P1-T3で学んだ教訓（承認ルール未設定時の暗黙自動承認、tenant整合性のアプリ層のみでの
  チェック、RBAC未強制）を再度繰り返さない。

# 実装対象
1. 新規マイグレーションで general_requests テーブルを作成する
   （id, tenant_id, title, description, category, amount(nullable numeric),
   attachment_id(nullable, attachmentsへのtenant整合性トリガー付きFK), status
   (draft/pending_approval/active/rejected), created_by, approved_at等）。
   RLS（ENABLE + FORCE）、tenant整合性トリガー（attachment_id/created_by、P1-T1と同じ設計）、
   active後の主要項目改変禁止トリガーを、既存パターンに倣って実装する。
2. approval_rules/approval_requestsのtarget_type CHECK制約に 'general_request' を追加する
   （P0-T1と同じ、マイグレーションはschema変更のみに純化し、実テナントへのテストデータ
   INSERTは含めない）。
3. 承認申請時、「承認ルール未設定→エラー」「明示的0-step→即active」「1ステップ以上→通常フロー」
   というP1-T1-FIXで確立したロジックをgeneral_requestにも適用する。
4. general_request.create/view/edit/approve のpermissionをRBAC体系に追加し、
   ContractsControllerと同様にContollerレベルでRequirePermissionsを設定する
   （DEBT-008は既知の問題として許容するが、少なくとも今回のControllerでは
   PermissionsGuardの設定漏れ自体を起こさないこと）。
5. フロントエンドに、タイトル・説明・カテゴリ・金額(任意)・添付ファイル(任意)を入力する
   汎用起票フォームを実装する。

# 受け入れ基準（Definition of Done）
- [ ] 汎用稟議を作成→承認申請→承認完了でactiveになる一連の動作を確認
- [ ] 承認ルール未設定のテナントで申請するとエラーになり、自動activeにならないことを確認
      （contractで実装した安全策と同じ挙動）
- [ ] 他テナントのattachment_id/created_byを指定するとDBトリガーで拒否されることを確認
- [ ] general_request.*のpermissionを持たないロールでは操作できないことを確認
- [ ] 他テナントから当該稟議が一切見えないことをRLSで確認
- [ ] Phase 0で確立した実DB E2E検証基盤で、上記すべてを実PostgreSQL上で確認し、
      結果を報告に添付する
- [ ] feature/p1-t5-general-requests ブランチにコミット・pushし、比較URLを報告に含める
      （本計画書0.4節に従う）

# ChatGPTレビュー時の確認観点
- 過去に指摘された問題（承認ルール未設定時の暗黙自動承認、tenant整合性のアプリ層のみでの
  チェック、Controller側のRBAC未強制）のいずれかが、新しいドメインで再発していないか
  重点的に確認してほしい（このプロジェクトでは同型の問題が新ドメイン追加のたびに
  再発する傾向があるため）
- general_requestsとcontractsが、承認エンジンを共有しつつも互いのテーブルを
  誤って参照するような設計になっていないか
```

---

#### 【フォローアップ指示プロンプト P1-T5-FIX】REQUEST CHANGES対応（amountの非負制約欠落）

ChatGPT(SO)よりP1-T5が「REQUEST CHANGES」と判定された。P1-T1〜P1-T3で確立した設計
（tenant整合性のDBトリガー、暗黙自動承認の防止、RBAC強制、SoD維持）は正しく横展開できて
おり、修正対象は金額制約の1点に限定される。

```
# SOレビュー結果：P1-T5 REQUEST CHANGES
main...feature/p1-t5-general-requests の実差分（コミットda4bbca5）を確認した結果、
現状はマージ不可です。以下を修正してください。

# BLOCKER-01: amountのDB非負制約が欠落している
general_requests.amount は NUMERIC(14,2) の型制約のみで、DB CHECK制約がありません。
既存のcontracts.contract_amountには CHECK (contract_amount IS NULL OR contract_amount >= 0)
が設定されているのに対し、general_requestsだけこの防御が抜けています。
API側のZodスキーマにもmin(0)がなく、負の金額（例: -100000）がAPI経由でもDB直接操作でも
登録できてしまいます。

## 修正方針
1. マイグレーションで general_requests.amount に
   CHECK (amount IS NULL OR amount >= 0) を追加する。
2. Backend Zodスキーマの amount を z.number().min(0).nullable().optional() に修正する。
3. 実DB E2Eに、amount = -1 でのDB直接INSERTが拒否されることを確認するテストを追加する。

# 推奨修正（今回まとめて対応することを推奨、必須ではない）
categoryが、API側で定義済みのenumスキーマ（generalRequestCategorySchema）を実際には
使用しておらず、任意の文字列を受け付けてしまっています。
1. create/update/listのクエリスキーマで、category: generalRequestCategorySchema.optional()
   .default('general') を実際に適用する。
2. DBにも CHECK (category IN ('general','equipment','rule_change','business_trip','other'))
   を追加する。
3. 実DB E2Eに、無効なcategory値でのDB直接INSERTが拒否されることを確認するテストを追加する。

# 修正不要（今回は記録のみ）
- PUT/DELETEが created_by（起票者本人）を確認せず、general_request.edit権限があれば
  同一テナントの誰でも他人のdraftを編集・削除できる点は、仕様として明記されていないため
  今回は修正必須にしません。DEBT-010として計画書側で記録し、仕様を正式決定するまで
  現状維持とします。

# 受け入れ基準（Definition of Done）
- [ ] amount = -1 でのDB直接INSERTがCHECK制約により拒否される
- [ ] API経由でも負の金額がバリデーションエラーになる
- [ ] （推奨対応を行った場合）無効なcategory値がDB直接INSERTでも拒否される
- [ ] 既存の正常系（正の金額、有効なcategory）に回帰がない
- [ ] 修正後、クリーンDBでverify_schema.pyを含む実DB E2Eを再実行し、追加テストを含めて
      全件PASSの結果を報告に添付する
- [ ] feature/p1-t5-general-requests ブランチに追加コミット・pushし、比較URLを報告に含める

# ChatGPTレビュー時の確認観点
- 追加したCHECK制約が、既存の正の金額データや金額未設定(NULL)のレコードに影響しないか
- categoryのCHECK制約を追加した場合、フロントエンドの選択肢と完全に一致しているか
```

---

#### 【フォローアップ指示プロンプト P1-T5-FIX2】REQUEST CHANGES対応（既存migrationの事後書き換え）

ChatGPT(SO)よりP1-T5-FIXが「REQUEST CHANGES」と判定された。amount/categoryの制約実装
そのものは適切だが、**適用方法に重大な問題**があるため修正する。本計画書0.4節に
migration不変（append-only）の原則を新設した。

```
# SOレビュー結果：P1-T5-FIX REQUEST CHANGES
コミットa0476111は、既に適用済みのsql/014_general_requests.sqlを直接書き換えて
amount/categoryのCHECK制約を追加していますが、これは本番相当のDB運用として成立しません。
014は `CREATE TABLE IF NOT EXISTS` を使っているため、既にgeneral_requestsテーブルが
存在するDB（P1-T5が一度でもmainへマージされた環境）に対してmigrationを再実行しても、
新しい制約は反映されません。今回の実DB E2E（82/82 PASS）は、クリーンDBに001から
現在の014まで最初から適用した場合の結果であり、「既存DBへの段階的アップグレード」を
証明していません。

# 修正方針
1. sql/014_general_requests.sql を、今回の変更前の内容（amount/category CHECKなし）に戻す。
2. 新規マイグレーション sql/015_general_request_constraints.sql を作成し、
   以下をALTER TABLEで追加する。
   ALTER TABLE general_requests
       ADD CONSTRAINT ck_general_requests_amount_nonnegative
       CHECK (amount IS NULL OR amount >= 0);
   ALTER TABLE general_requests
       ADD CONSTRAINT ck_general_requests_category
       CHECK (category IN ('general','equipment','rule_change','business_trip','other'));
3. 今後、他のタスクで同様の「既存テーブルへの制約追加」が必要になった場合も、
   必ずこのパターン（新規migrationでのALTER TABLE）に従うこと。

# 追加すべき検証（最重要）
「クリーンDBに全migrationを適用した場合のみ制約が効く」ことの確認では不十分です。
以下の手順で、既存DBへの段階的アップグレードが正しく機能することを実DB E2Eで証明してください。
1. クリーンなDBに対し、001から014（修正前の内容に戻したもの）までを適用する
   （＝P1-T5適用直後、FIX前の状態を再現する）。
2. この状態でamount=-1のINSERTが成功する（制約がまだない）ことを一度確認する
   （既存状態の再現が正しいことの確認）。
3. 続けて015を適用する。
4. 015適用後、amount=-1のINSERTが拒否されることを確認する。
5. 015適用後、無効なcategory値のINSERTが拒否されることを確認する。
6. 015を2回適用してもエラーにならない、またはエラーが許容範囲であることを確認する
   （ALTER TABLE ADD CONSTRAINTの冪等性、IF NOT EXISTS相当の考慮）。

# 受け入れ基準（Definition of Done）
- [ ] 014が変更前の内容に戻っている（amount/category制約を含まない）
- [ ] 015が新規作成され、ALTER TABLEでamount/category制約を追加している
- [ ] 「001〜014適用（旧状態）→ 015適用 → 制約が効く」という段階的アップグレードのE2Eが
      追加され、PASSしている
- [ ] クリーンDBに001〜015を最初から適用した場合も引き続き正しく動作する（回帰なし）
- [ ] feature/p1-t5-general-requests ブランチに追加コミット・pushし、比較URLを報告に含める

# ChatGPTレビュー時の確認観点
- 014の内容が本当に「今回の変更前」に正確に戻っているか（差分で確認）
- 015のALTER TABLEが、既存データに非負でない金額や無効なcategoryが万一含まれていた場合に
  マイグレーション自体が失敗しないか（現状のデータ内容次第でこの問題が起こり得るため、
  必要であれば事前のデータクレンジング方針も報告に含める）
```

---

#### 【フォローアップ指示プロンプト P1-T5-FIX3】REQUEST CHANGES対応（015が既存データを無断で自動クレンジングしている）

ChatGPT(SO)よりP1-T5-FIX2が「REQUEST CHANGES」と判定された。前回のBLOCKER（migration
append-only原則違反）は完全に解消されている。今回の指摘は、新設した015自体の設計に
関するものに限定される。本計画書0.4節にfail-closed migrationの原則を新設した。

```
# SOレビュー結果：P1-T5-FIX2 REQUEST CHANGES
015_general_request_constraints.sql の冒頭に、以下の自動クレンジング処理があります。
  UPDATE general_requests SET amount = NULL WHERE amount < 0;
  UPDATE general_requests SET category = 'general' WHERE category NOT IN (...);
これは制約追加前に違反データを検出して人間に知らせるのではなく、migration自身が
既存の業務データ（金額・区分）を無断で書き換えてから制約を追加する設計になっており、
会計・バックオフィス系システムとしては危険です。amount=NULLへの変更は「金額が負だった」
という情報を、category='general'への変更は「元は別の区分だった」という情報を、
それぞれ復元不可能な形で消去します。

# 修正方針
1. 015冒頭のUPDATE文（自動クレンジング処理）を削除する。
2. 代わりに、制約追加前にDO $$ ... $$ブロックで違反データの存在を検出し、
   存在すればRAISE EXCEPTIONでmigration自体を停止する（fail-closed）よう変更する。
   例:
   DO $$
   BEGIN
       IF EXISTS (SELECT 1 FROM general_requests WHERE amount < 0) THEN
           RAISE EXCEPTION 'general_requests contains negative amount values; manual remediation required';
       END IF;
       IF EXISTS (SELECT 1 FROM general_requests WHERE category NOT IN
           ('general','equipment','rule_change','business_trip','other')) THEN
           RAISE EXCEPTION 'general_requests contains invalid category values; manual remediation required';
       END IF;
   END $$;
   （categoryはNOT NULL制約があるためNULLチェックは不要、amountはNULL許容のため
   amount < 0のみで判定すれば十分。NULLはamount < 0の比較でfalseになるため
   誤って引っかからないことを確認する）
3. 既存の段階的アップグレードE2Eテストを、以下のように更新する。
   - 違反データが存在しない状態で015を適用 → 成功し、制約が追加される（従来通り）
   - 意図的に違反データ（負の金額または無効なcategory）を投入した状態で015を適用
     → migrationがエラーで停止し、データが変更されていないことを確認する新規テストケースを追加

# 受け入れ基準（Definition of Done）
- [ ] 015から自動クレンジング(UPDATE)処理が完全に削除されている
- [ ] 違反データが存在する状態で015を適用するとエラーで停止し、元データが一切変更されない
- [ ] 違反データが存在しない状態では、従来通り015が正常に適用され制約が追加される
- [ ] 015の冪等性（既存制約がある場合はスキップ）に回帰がない
- [ ] 修正後、クリーンDB・段階的アップグレード（違反データあり/なし両方）の実DB E2Eを再実行し、
      全件PASSの結果を報告に添付する
- [ ] feature/p1-t5-general-requests ブランチに追加コミット・pushし、比較URLを報告に含める

# ChatGPTレビュー時の確認観点
- RAISE EXCEPTIONによるmigration停止時、部分的にALTER TABLEが適用されて中途半端な状態に
  ならないか（DOブロックをトランザクション内の適切な位置に置けているか）
- エラーメッセージが、実際に対応する担当者（Gemini/開発者）にとって次に何をすべきか
  分かる内容になっているか
```

---

#### 【フォローアップ指示プロンプト P1-T5-FIX3-VERIFY】push状態の確認・是正（設計は承認済み）

ChatGPT(SO)より、P1-T5-FIX3の**設計自体はfail-closed原則に合致しており問題ない**と判定された。
ただし、報告内容とGitHub上の実コミット（28812ec）が一致しておらず、報告されたUPDATE削除・
RAISE EXCEPTION化がまだリモートに反映されていない状態が確認された。これは本計画書0.4節
「push前の報告のみの完了通知は受け付けない」というルールに関わる問題であるため、
実装内容の再検討ではなく、push状態の確認と是正を最優先で行う。

```
# 指示
以下を確認し、必要な対応を行ってください。設計自体は前回提示された内容（UPDATE削除、
DO $$ ... RAISE EXCEPTION ... END $$ によるfail-closed化）で問題ないため、再設計は不要です。

1. git status / git log でローカルの変更状態とコミット履歴を確認する。
   前回報告したFIX3の変更（015からのUPDATE削除、RAISE EXCEPTION追加）が
   実際にコミットされているか確認する。
2. コミットされていない場合は、コミットした上でfeature/p1-t5-general-requests ブランチへpushする。
   コミットはされているがpushされていない場合は、pushする。
3. git diff --name-only <直前のFIX2コミット>...HEAD を実行し、実際に変更されたファイルの
   一覧を報告に含める。
4. push後、GitHub上の sql/015_general_request_constraints.sql を直接確認し、
   UPDATE文が存在しないこと、RAISE EXCEPTIONによるfail-closad化が反映されていることを
   目視でも確認する。
5. 改めてクリーンDB・段階的アップグレード（違反データあり/なし）の実DB E2Eを実行し、
   結果を報告に添付する。
6. 今回のpush漏れがなぜ起きたか（コミットし忘れ、別ブランチへのpush、push自体の失敗等）を
   一言報告してください。今後の再発防止のため記録します。

# 受け入れ基準（Definition of Done）
- [ ] GitHub上のfeature/p1-t5-general-requests HEADで、015からUPDATE文が完全に削除されている
- [ ] GitHub上のfeature/p1-t5-general-requests HEADで、RAISE EXCEPTIONによるfail-closed化が
      確認できる
- [ ] 新しいコミットSHAを報告に明記する
- [ ] 実DB E2E（違反データあり/なし両方のケースを含む）の結果を報告に添付する
```

---

#### 【マージ指示プロンプト P1-T5-MERGE】mainへのマージ

ChatGPT(SO)よりP1-T5-FIX3が正式PASS（migration append-only・fail-closed原則の両方を実リポジトリで確認済み）と判定された。

```
# 指示
feature/p1-t5-general-requests を main へマージしてください。
SO(ChatGPT)による正式PASS判定を得ています（既存migrationの事後変更なし、制約追加は新規015で
fail-closedに実装、違反データがある既存DB/正常な既存DB/新規DBの3経路を実DB E2E 85/85で確認済み）。
DEBT-010（起票者本人以外もdraft稟議を編集・削除できる、仕様未確定）は計画書側で追跡することとし、
今回のマージをブロックするものではありません。
マージ後、以下を確認し報告してください。
- main上でクリーンDBに対しverify_schema.pyを含む実DB E2Eを再実行し、全件PASSを確認する
- Backend/Frontendのテストを再実行して確認
- マージコミットハッシュ
- 作業ブランチ feature/p1-t5-general-requests の削除（マージ済み後）
```

これでP1-T5は完了。次はP1-T6（契約書全文検索：pgvector活用）へ進む。**これでPhase 1の全6タスクが出揃う。**

---

#### 【指示プロンプト P1-T6】契約書全文検索（pgvector活用）

```
# 背景・目的
既存のjournal_entry_embeddings（仕訳の類似検索）と同様のパターンで、契約書本文をベクトル化し、
「似た契約を探す」「キーワードでは見つからない類似条項の契約を探す」といった検索を可能にする。
これがPhase 1の最後のタスクとなる。

# 前提となる既存実装
- P1-T2: PDFテキスト抽出（pdf-text-extractor.ts）。ただし現状、抽出したテキストは
  AI提案生成に使われた後、永続化されていない可能性が高い（要確認）。
- 既存のjournal_entry_embeddings テーブルとそのembedding生成パターン（使用モデル、
  チャンク分割方針等）
- P1-T1: contracts テーブル、tenant整合性トリガー

# やってはいけないこと
- embeddingや全文検索機能を、既存のAI提案（ai_suggestions）の隔離原則と混同しない。
  全文検索はあくまで「確定済みcontractsの本文」に対する検索機能であり、
  AI提案の生成・確定フローとは独立した機能として実装する。
- 全文検索結果のAPIが、tenant境界を越えて類似契約を返さないようにする
  （embedding検索であってもRLS/tenant_idでの絞り込みを必ず行う）。

# 実装対象
1. contracts に抽出済み本文を永続化する列（例: extracted_text TEXT）を追加するマイグレーションを
   作成する（既存014方式ではなく新規番号のmigrationとして追加すること。本計画書0.4節の
   migration不変原則に従う）。P1-T2のPDF抽出結果を、契約confirm時にcontractsへ保存するよう
   ContractsServiceを更新する。
2. contract_embeddings テーブルを新規作成する（id, tenant_id, contract_id, chunk_index,
   chunk_text, embedding vector(次元数は既存journal_entry_embeddingsに合わせる)等）。
   RLS（ENABLE + FORCE）、tenant整合性トリガー（contract_id経由でcontracts.tenant_idと
   一致することをDBで保証、P1-T1/P1-T3で確立したパターンを踏襲）を実装する。
3. 契約confirm時（またはバッチ処理として事後）に、extracted_textを適切なサイズでチャンク分割し、
   既存のembedding生成パターンを再利用してcontract_embeddingsへ保存する処理を実装する。
4. 類似契約検索API（例: GET /contracts/:id/similar、またはキーワード/自然文からの検索）を実装し、
   pgvectorのコサイン類似度等で近傍探索を行う。検索結果は必ずtenant_idで絞り込む
   （embeddingのインデックス自体がtenant境界を越えないことをRLSで保証しつつ、
   アプリケーション側でも明示的にtenant_idを条件に含める）。
5. contract.view権限がない場合はこの検索APIも利用できないようにする。

# 受け入れ基準（Definition of Done）
- [ ] 契約confirm時にPDF抽出テキストがcontracts.extracted_textへ保存される
- [ ] contract_embeddingsが生成され、他テナントのembeddingを一切含まずに類似検索が行える
- [ ] 他テナントのcontract_embeddingsが検索結果に一切混入しないことを実DB E2Eで確認する
      （tenant越境した際の挙動を明示的にテストする）
- [ ] contract.view権限がないユーザーは検索APIを利用できない
- [ ] 既存のjournal_entry_embeddingsの動作に回帰がない
- [ ] 新規migrationが本計画書0.4節の原則（append-only、fail-closedなデータ検証）に従っている
- [ ] Phase 0で確立した実DB E2E検証基盤で、上記すべてを確認し結果を報告に添付する
- [ ] feature/p1-t6-contract-fulltext-search ブランチにコミット・pushし、比較URLを報告に含める
      （本計画書0.4節に従う）

# ChatGPTレビュー時の確認観点
- embedding生成のチャンク分割・モデル選択が既存のjournal_entry_embeddingsと一貫しているか
  （車輪の再発明をしていないか）
- 類似検索APIが、RLSに加えてアプリケーション層でも明示的にtenant_idを絞り込んでいるか
  （pgvectorの近傍探索インデックスがRLSと正しく組み合わさっているかは要確認ポイント）
- extracted_textの永続化によって、契約書本文という機微情報の保存範囲が広がることについて、
  既存のattachments（ファイル実体）との重複や、アクセス制御の一貫性が保たれているか
```

---

#### 【フォローアップ指示プロンプト P1-T6-FIX】REQUEST CHANGES対応（検索対象が確定済み契約に限定されていない）

ChatGPT(SO)よりP1-T6が「REQUEST CHANGES」と判定された。DB設計・RLS・tenant整合性・RBACは
評価されており、修正対象は「検索対象を確定済み契約に限定する」という機能境界の1点に絞られる。

```
# SOレビュー結果：P1-T6 REQUEST CHANGES
searchSimilarContractsByText() / findSimilarContractsById() が、contracts.statusを
一切見ずにcontract_embeddingsのtenant_idのみで検索しているため、draft / pending_approval /
rejected の契約本文まで検索結果に含まれてしまいます。P1-T6の仕様「全文検索はあくまで
確定済みcontractsの本文に対する検索機能」という境界を満たしていません。
契約書本文は機微情報であるため、tenantを跨がなくても、社内承認前・却下済みの契約内容が
検索経由で露出するのは業務データの意味論として避けるべきです。

# 修正方針
1. 「確定済み」として検索対象に含めるステータスを明示的にコード上の定数として定義する。
   最も安全な選択は status = 'active' のみを対象とすることです。terminated（解約済み）を
   含めるかどうかは、過去の契約内容も参照したいという業務ニーズがあり得るため判断が分かれます。
   どちらを採用するか決定し、理由とともに報告に明記してください（判断に迷う場合は、
   より保守的な 'active' のみを初期実装として採用し、DEBT候補として記録する形でも構いません）。
2. searchSimilarContractsByText() と findSimilarContractsById() の両方のSQLに、
   contracts とのJOINまたはサブクエリで c.status IN (<確定済みステータス群>) の条件を追加する。
3. embedding生成タイミング（現状draft作成時・更新時に生成している）自体は今回変更不要です。
   検索クエリ側でステータスを絞り込めば機能境界は満たせます
   （ただし、生成タイミングと検索範囲がズレている設計である旨は報告に一言明記してください）。

# 追加すべき実DB E2E（必須）
以下を1テナント内に用意し、確定済みでない契約が検索結果に含まれないことを確認してください。
  tenant1
   ├─ active contract （検索結果に出る）
   ├─ draft contract （出ない）
   ├─ pending_approval contract （出ない）
   └─ rejected contract （出ない）
draft/pending/rejectedの契約本文には、他のテストデータと重複しない特徴的な文言を含め、
その文言で検索しても該当契約が結果に出てこないことを確認する形にしてください。

# 受け入れ基準（Definition of Done）
- [ ] 検索対象となる契約ステータスがコード上で明示的に定義されている（暗黙の「embeddingが
      あれば全部検索対象」になっていない）
- [ ] draft / pending_approval / rejected の契約が、特徴的な文言で検索しても結果に出てこないこと
      を実DB E2Eで確認する
- [ ] active（採用した場合はterminatedも）の契約は引き続き正しく検索結果に出る
- [ ] 既存のtenant isolation E2E（tenant1/tenant2の相互不可視性）に回帰がない
- [ ] feature/p1-t6-contract-fulltext-search ブランチに追加コミット・pushし、比較URLを報告に含める

# ChatGPTレビュー時の確認観点
- 確定済みステータスの定義が、契約のライフサイクル全体（P1-T1で定義した状態遷移）と矛盾しないか
- ステータスによる絞り込みが、SQL側だけでなくAPIレスポンスの一貫性としても機能しているか
  （一覧APIと詳細APIで挙動が食い違っていないか）
```

---

#### 【マージ指示プロンプト P1-T6-MERGE】mainへのマージ ＋ Phase 1クローズ

ChatGPT(SO)よりP1-T6-FIXが正式PASS（検索対象をactiveのみのallowlistに限定、自然文検索・ID類似検索の両経路に適用、実DB E2Eで4状態を実証）と判定された。

```
# 指示
feature/p1-t6-contract-fulltext-search を main へマージしてください。
SO(ChatGPT)による正式PASS判定を得ています（確定済み契約(active)のみを検索対象とする
allowlist方式、tenant分離の維持、実DB E2E 97/97・単体テスト102/102を確認済み）。
DEBT-011（疑似embeddingの精度限界）、DEBT-012（terminated/expired契約が検索対象外）は
計画書側で追跡することとし、今回のマージをブロックするものではありません。
マージ後、以下を確認し報告してください。
- main上でクリーンDBに対しverify_schema.pyを含む実DB E2Eを再実行し、全件PASSを確認する
- Backend/Frontendのテストを再実行して確認
- マージコミットハッシュ
- 作業ブランチ feature/p1-t6-contract-fulltext-search の削除（マージ済み後）
```

**これでPhase 1（総務・法務: 契約書管理）は全6タスク完了。**

### Phase 1クローズ時点のサマリ

| タスク | 最終判定 | 往復回数 |
|--------|----------|----------|
| P1-T1 | ✅ CONDITIONAL PASS | 2回（REQUEST CHANGES → FIX） |
| P1-T2 | ✅ PASS | 2回（REQUEST CHANGES → FIX、PDF本文未読込という重大な指摘） |
| P1-T3 | ✅ PASS | 2回（REQUEST CHANGES → FIX、並行実行耐性） |
| P1-T4 | ✅ APPROVE | 2回（REQUEST CHANGES → FIX、バッチAPIの認可欠落） |
| P1-T5 | ✅ PASS | 4回（amount制約 → migration書き換え問題 → 自動データ改変問題 → push漏れ） |
| P1-T6 | ✅ PASS | 2回（REQUEST CHANGES → FIX、検索対象の状態境界） |

### Phase 1で確立された恒久ルール（0.4節に反映済み）

1. テストPASSは機能の実動作を証明しない。外部入力を扱うタスクは実データでのE2Eを必須とする（P1-T2）。
2. migrationはappend-only。既存ファイルを事後的に書き換えない（P1-T5）。
3. 制約追加migrationは既存データを自動改変せず、fail-closedで停止する（P1-T5）。

### 未解決の技術的負債一覧（Phase 2着手前に一度棚卸しを推奨）

DEBT-001, 002, 003, 004(解消済み), 007, 008, 009, 010, 011, 012 が4節に記録されている
（DEBT-004のみ解消済み、他は継続追跡中）。特にDEBT-003（Phase 1で対応必須としていたが
実際にはP1-T2で解消済み・訂正）、DEBT-005/006（P1-T3で解消済み）は完了しているため、
4節のステータス列を参照して現在も未対応のものを優先的に確認すること。

Phase 2（購買・調達）着手にあたっては、本計画書1節のロードマップに従い、Phase 1で
確立した設計パターン（tenant整合性のDBトリガー、暗黙自動承認の防止、RBAC強制、
migration運用ルール）をそのまま踏襲する形で、Claudeが次のタスク分解を行う。

---

## 3.4 決定事項: ロール・権限の粒度方針

- **方針**: 権限を細分化し、権限外の領域は閲覧も含めて不可とする（deny-by-default）。既存のRLSが「fail-closed（未設定・不一致時は0件返却）」の原則を採っているため、この方針とも整合的。
- **対応タイミング**: P0-T4（法務向けロール追加）では最小限のロール(`legal_admin`/`legal_viewer`)のみ用意し、細粒度の権限設計（契約種別ごと、金額しきい値ごと等）はPhase 1でUI/運用が固まってから着手する。基盤（`roles`/`permissions`/`role_permissions`のテーブル構造）自体は既に細分化可能な設計になっているため、後追いでの拡張コストは低いと判断。
- **P0-T4のDoDへの影響**: 「新ロールでログインしたユーザーが権限のないテーブルにアクセスできないこと」の確認は引き続き必須。今回追加するのは前提となるロール骨格のみで、権限マトリクスの最終形ではない点をレビュー時にも明記しておく。

---

## 4. Phase 2: 購買・調達（発注申請・サプライヤー管理）

### 4.1 目的

Phase 0で`approval_rules`/`approval_requests`のtarget_typeに`purchase_request`を追加済み
（P0-T1）であり、まだ実際のドメインテーブルは存在しない。Phase 1で確立した設計パターン
（tenant整合性のDBトリガー、暗黙自動承認の防止、RBAC強制、Controller/Service二層防御、
migrationのappend-only・fail-closed運用）をそのまま踏襲し、発注申請とサプライヤー管理を
実装する。

### 4.2 タスク分解

| タスクID | タスク名 | 概要 | 依存 | ステータス |
|----------|----------|------|------|-----------|
| P2-T1 | `purchase_requests`テーブル設計・実装 | 発注申請本体（品目、数量、単価、サプライヤー、金額、納期、ステータス）、既存承認エンジン統合、RBAC強制 | P0-T1, P1-T1, P1-T3 | ✅ SO正式PASS（コミット9e4fe21、初回レビューでPASS。DEBT-013を記録、mainマージ指示済み） |
| P2-T2 | サプライヤー（取引先）マスタ管理 | サプライヤー登録・編集・検索、連絡先・支払条件等の管理、purchase_requestsとの関連付け | P0-T1, P2-T1 | ✅ SO正式PASS・mainマージ完了（マージコミット`05ffb6f`、main上でE2E 114/114・Jest 133/133・build成功を再確認済み） |
| P2-T3 | 発注〜検収〜請求の連携 | purchase_requestsが承認完了した後の発注確定、検収記録、既存vendor_bills（請求書管理）との紐付け | P2-T1, P2-T2 | ✅ SO正式PASS（コミット87fec94、DELETE WORM防御を追加解消、DEBT-014を記録、mainマージ指示済み） |
| P2-T4 | 購買ダッシュボード・レポート | テナント内の購買状況（申請中・承認済み・発注済み件数、サプライヤー別支出等）の可視化 | P2-T1, P2-T2, P2-T3 | ✅ SO正式PASS・mainマージ完了（マージコミット`b0a6756`、main上でE2E 125/125・Jest 141/141・build成功を再確認済み）— **Phase 2完了** |

P2-T2以降の詳細タスク分解・実装指示プロンプトは、P2-T1の実装結果（実際のテーブル定義・
API形状）を踏まえてClaudeが都度作成する（Phase 0/1と同じ方針）。

### 4.3 Phase 2 実装指示プロンプト（Gemini向け）

#### 【指示プロンプト P2-T1】purchase_requestsテーブル設計・実装

```
# 背景・目的
Phase 0（P0-T1）で承認エンジンのtarget_typeに'purchase_request'を追加済みだが、実際の
発注申請ドメインテーブルはまだ存在しない。Phase 1のcontracts/general_requestsで確立した
設計パターンをそのまま踏襲し、発注申請の中核テーブルとAPIを実装する。

# 前提となる既存実装（必ず先に読むこと）
- P0-T1: approval_requests/approval_rulesのtarget_type='purchase_request'（既にCHECK制約に
  含まれている）
- P1-T1: contractsのテーブル設計パターン（tenant整合性トリガー、状態遷移トリガー、
  active後の主要項目改変禁止）
- P1-T1-FIX: 「承認ルール未設定→エラー」「明示的0-step→即active」「1ステップ以上→通常フロー」
  という自動承認の安全策
- P1-T3: RBAC強制のパターン（PermissionsGuard + Controller + Service層の二重確認）
- P1-T5: general_requestsの設計（amount非負制約、category enum、fail-closedなmigration）

# やってはいけないこと
- これまでPhase 1で繰り返し指摘・修正してきた問題（暗黙自動承認、tenant整合性のアプリ層のみ
  でのチェック、RBAC未強制、amount等の数値列への非負制約忘れ、migrationの事後書き換え、
  制約追加migrationでの既存データ自動改変）のいずれも再発させないこと。
- 既存のcontracts/general_requests向けの承認・RLS実装を変更・破壊しない。

# 実装対象
1. 新規マイグレーションで purchase_requests テーブルを作成する
   （id, tenant_id, request_no, supplier_name（P2-T2でsupplier_idへ置き換え予定、
   現段階ではフリーテキストで可）, item_description, quantity, unit_price(numeric, CHECK >= 0),
   total_amount(numeric, CHECK >= 0), currency, requested_delivery_date, status
   (draft/pending_approval/active/rejected/terminated), created_by, approved_at,
   attachment_id(nullable)等）。
   RLS（ENABLE + FORCE）、tenant整合性トリガー（attachment_id/created_by、既存パターン踏襲）、
   active後の主要項目改変禁止トリガーを実装する。
2. 承認申請ロジックは、P1-T1-FIXで確立した「ルール未設定→エラー」「明示的0-step→即active」
   「1ステップ以上→通常フロー」をそのまま適用する。
3. purchase_request.create/view/edit/approve/terminate のpermissionをRBAC体系に追加し、
   Controller・Service両層でチェックする（DEBT-005/P1-T3と同じ二重防御パターン）。
4. フロントエンドに発注申請の起票・一覧・詳細画面を実装する。

# 受け入れ基準（Definition of Done）
- [ ] 発注申請を作成→承認申請→承認完了でactiveになる一連の動作を確認
- [ ] 承認ルール未設定のテナントで申請するとエラーになり、自動activeにならないことを確認
- [ ] unit_price/total_amountへの負数INSERTがDB CHECK制約で拒否される
- [ ] 他テナントのattachment_id/created_byを指定するとDBトリガーで拒否される
- [ ] purchase_request.*のpermissionを持たないロールでは操作できないことを確認
- [ ] 他テナントから当該発注申請が一切見えないことをRLSで確認
- [ ] migrationがappend-only・fail-closedの原則（本計画書0.4節）に従っている
- [ ] Phase 0で確立した実DB E2E検証基盤で、上記すべてを実PostgreSQL上で確認し、
      結果を報告に添付する
- [ ] feature/p2-t1-purchase-requests ブランチにコミット・pushし、比較URLを報告に含める
      （本計画書0.4節に従う）

# ChatGPTレビュー時の確認観点
- Phase 1で指摘・修正された問題（暗黙自動承認、tenant整合性のアプリ層依存、RBAC未強制、
  数値列の非負制約忘れ、migration事後書き換え、fail-closedでないデータ検証）のいずれかが
  再発していないか、重点的に確認してほしい
- total_amountがquantity×unit_priceと整合しているか（アプリ層での計算だけでなく、
  DB上で矛盾したデータが入り得る設計になっていないか）
```

---

#### 【マージ指示プロンプト P2-T1-MERGE】mainへのマージ

ChatGPT(SO)よりP2-T1が初回レビューで正式PASS（金額整合性・tenant整合性・状態遷移・暗黙自動承認防止・RBAC三層防御のすべてがDB最終防御まで落とし込まれていることを実コード確認済み）と判定された。

```
# 指示
feature/p2-t1-purchase-requests を main へマージしてください。
SO(ChatGPT)による正式PASS判定を得ています（total_amount = round(quantity * unit_price, 2)の
DB CHECK、tenant整合性トリガー、状態遷移・WORM、暗黙自動承認防止、RBAC三層防御(Controller/
Service/DB)、migrationのappend-only運用を実コード確認済み）。
DEBT-013（request_noの採番方式、現仕様では実害なし）は計画書側で追跡することとし、
今回のマージをブロックするものではありません。
マージ後、以下を確認し報告してください。
- main上でクリーンDBに対しverify_schema.pyを含む実DB E2Eを再実行し、全件PASSを確認する
- Backend/Frontendのテストを再実行して確認
- マージコミットハッシュ
- 作業ブランチ feature/p2-t1-purchase-requests の削除（マージ済み後）
```

これでP2-T1は完了。次はP2-T2（サプライヤー：取引先マスタ管理）へ進む。

---

#### 【指示プロンプト P2-T2】サプライヤー（取引先）マスタ管理

```
# 背景・目的
P2-T1では purchase_requests.supplier_name をフリーテキストとして実装した。本タスクでは
正式なサプライヤー（取引先）マスタを実装し、発注申請から実在するサプライヤーレコードを
選択できるようにする。これにより将来のP2-T3（発注〜検収〜請求連携）・P2-T4（購買ダッシュ
ボード）でサプライヤー単位の集計・分析が可能になる。

# 前提となる既存実装
- P2-T1: purchase_requests テーブル（現状supplier_nameはフリーテキスト）
- Phase 1で確立した設計パターン全般（tenant整合性トリガー、RLS、RBAC三層防御、
  migrationのappend-only・fail-closed運用）

# やってはいけないこと
- 既存のpurchase_requests.supplier_nameを即座に削除・necessary化しない。既存データとの
  後方互換性を保ちつつ、段階的にsupplier_idへ移行できる設計にする（supplier_idを追加し、
  supplier_nameは当面フリーテキストのフォールバックとして残す、等の移行方針を報告に明記する）。
- Phase 1/P2-T1で確立した設計原則（tenant整合性のDB保証、RBAC三層防御、migration運用ルール）
  のいずれも省略しない。

# 実装対象
1. 新規マイグレーションで suppliers テーブルを作成する
   （id, tenant_id, name, contact_name, contact_email, contact_phone, payment_terms,
   status(active/inactive), created_by等）。RLS（ENABLE + FORCE）、tenant整合性トリガー
   （created_by）を実装する。
2. purchase_requests に supplier_id（nullable, suppliers(id)への参照）を追加する新規migration
   を作成し、tenant整合性トリガー（supplier_idが設定されている場合、参照先suppliers.tenant_id
   がpurchase_requests.tenant_idと一致すること）を、既存のfn_validate_purchase_request_tenant
   _consistency()相当の関数に追加する。
3. supplier.create/view/edit のpermissionをRBAC体系に追加し、Controller・Service両層で
   チェックする。
4. サプライヤーの登録・編集・一覧・検索APIとフロントエンド画面を実装する。
5. 発注申請の起票画面で、既存のフリーテキスト入力に加えて登録済みサプライヤーからの選択も
   できるようにする（supplier_idが選択された場合はsupplier_nameを自動補完する等、UI上の
   整合性を保つ）。

# 受け入れ基準（Definition of Done）
- [ ] サプライヤーを登録・編集・検索できる
- [ ] 他テナントのサプライヤーが一切見えないことをRLSで確認
- [ ] 他テナントのsupplier_idを指定したpurchase_requestsのINSERT/UPDATEがDBトリガーで拒否される
- [ ] supplier.*のpermissionを持たないロールでは操作できないことを確認
- [ ] 既存のsupplier_nameフリーテキストのpurchase_requestsに回帰がない（後方互換性の確認）
- [ ] migrationがappend-only・fail-closedの原則（本計画書0.4節）に従っている
- [ ] Phase 0で確立した実DB E2E検証基盤で、上記すべてを実PostgreSQL上で確認し、
      結果を報告に添付する
- [ ] feature/p2-t2-suppliers ブランチにコミット・pushし、比較URLを報告に含める
      （本計画書0.4節に従う）

# ChatGPTレビュー時の確認観点
- supplier_idとsupplier_nameの併存が、データの二重管理・不整合（例: supplier_idはAだが
  supplier_nameは別のサプライヤー名になっている）を生まないか
- P2-T1で確立したtenant整合性トリガーのパターンが、供給元テーブルが増えても一貫して
  適用されているか
```

---

#### 【フォローアップ指示プロンプト P2-T2-FIX】REQUEST CHANGES対応（supplier名変更時の不整合・DBエラーの握り潰し）

ChatGPT(SO)よりP2-T2が「REQUEST CHANGES」と判定された。suppliers/purchase_requestsの
DB設計、tenant整合性、RBAC、後方互換性は評価されており、修正対象は以下2点に限定される。

```
# SOレビュー結果：P2-T2 REQUEST CHANGES
main...feature/p2-t2-suppliers の実差分（コミット0fb1951）を確認した結果、現状はマージ不可
です。以下を修正してください。なお、完了報告のコミットSHAが実際のHEADと異なっていました
（報告: 9e4fe21 は実際にはP2-T1のコミット）。今後の報告では必ず`git rev-parse HEAD`等で
実際のコミットSHAを確認してから記載してください。

# BLOCKER-01: supplier.name変更が既存purchase_requestとの整合性を壊す
purchase_requests側でsupplier_idとsupplier_nameの整合性はINSERT/UPDATE時にチェックされて
いますが、suppliers.name自体は制限なく変更できます。そのため、あるsupplierを参照する
purchase_requestが既に存在する状態でsuppliers.nameを変更すると、
「purchase_requests.supplier_name（発注申請当時の名称）」と「suppliers.name（マスタの現在名）」
に不整合が生じます。過去の確定データ（発注申請時点の取引先名）を後からのマスタ変更で
書き換えるべきではありません。

## 修正方針
suppliersテーブルへのUPDATE（name列の変更）に対し、DBトリガーで以下を検証する。
  - 変更対象のsupplier.idを参照するpurchase_requestsが1件でも存在する場合、
    name列の変更を拒否する（他の列、例えばcontact情報等の変更は許可して構わない）。
  - 参照するpurchase_requestsが存在しない場合は、name変更を許可する。
これにより、「未参照のsupplierは名前変更可能」「参照済みのsupplierは名前変更不可」という
安全な境界を設ける。

## 追加テスト
1. supplier作成
2. そのsupplier_idを参照するpurchase_request作成
3. supplier.nameの変更を試行 → DBトリガーで拒否されることを確認
4. suppliers.nameとpurchase_requests.supplier_nameの両方が変更前の値のまま維持されていることを確認
5. （比較のため）未参照のsupplierであれば名前変更が成功することも確認

# BLOCKER-02: hasSupplierIdColumn()がDBエラーを「列が存在しない」に変換している
purchase-requests.service.ts の hasSupplierIdColumn() は、pg_attributeへの問い合わせが
何らかの理由で失敗した場合（DB接続障害、権限エラー、想定外のSQLエラー等）も含めて
catch { return false; } としており、これらすべてを「P2-T1時代のスキーマ（supplier_id列が
存在しない）」と誤認してしまいます。これはインフラ障害を握り潰さず伝播させるという
このプロジェクトの原則に反します。

## 修正方針
catchブロックで無条件にfalseを返すのをやめ、pg_attributeへの問い合わせ自体は例外を
そのまま伝播させる。「列が存在しない」という判定は、クエリが正常に実行された結果
（該当行が0件）としてのみ行う。

# 受け入れ基準（Definition of Done）
- [ ] 参照済みsupplierのname変更がDBトリガーで拒否される
- [ ] 未参照のsupplierはname変更を含め通常通り更新できる
- [ ] hasSupplierIdColumn()が、DB問い合わせ失敗時に例外を伝播させ、falseに変換しない
- [ ] 既存のE2E（RBAC、tenant整合性、supplier_id/name不一致等）に回帰がない
- [ ] 完了報告に実際のコミットSHA（`git rev-parse HEAD`の結果）を正確に記載する
- [ ] Phase 0で確立した実DB E2E検証基盤で、上記すべてを実PostgreSQL上で確認し、
      結果を報告に添付する
- [ ] feature/p2-t2-suppliers ブランチに追加コミット・pushし、比較URLを報告に含める

# ChatGPTレビュー時の確認観点
- suppliers.nameの変更禁止トリガーが、他の列（contact情報等）の更新まで巻き添えにして
  拒否していないか（name列の変更のみをピンポイントで検知しているか）
- hasSupplierIdColumn()の修正後、正常系（列が存在する/しないの両方の正常なケース）の
  判定ロジックに回帰がないか
```

---

#### 【フォローアップ指示プロンプト P2-T2-FIX2】REQUEST CHANGES対応（supplier名変更の同時実行race condition）

ChatGPT(SO)よりP2-T2-FIXが「REQUEST CHANGES」と判定された。前回の2つのBLOCKER
（supplier名変更の逐次防御、DBエラーの握り潰し）はいずれも正しく解消されている。
今回の指摘は、その防御が並行実行下では破れるという、P1-T3のDEBT-006と同型の問題である。

```
# SOレビュー結果：P2-T2-FIX REQUEST CHANGES
main...feature/p2-t2-suppliers の実差分（コミット40698a3）を確認した結果、現状はマージ不可
です。前回追加したsuppliers.name変更禁止トリガーは、purchase_requests側のsupplier参照
チェックと相互にロックしていないため、以下の競合が成立します。
  Transaction A: suppliers.name変更（purchase_requestsにS1の参照がないことを確認 → OK）
  Transaction B: 同時にsupplier_id=S1のpurchase_request作成
    （Aの変更が未commitのため、Bはsuppliers.nameの変更前の値を見て整合すると判定 → OK）
  A commit, B commit
  → 結果: suppliers.nameは変更後、purchase_requests.supplier_nameは変更前の値のまま
    という、まさに防止しようとしていた不整合が成立する
これはP1-T3のDEBT-006（自動承認ルールの混在防止）で発生したものと同型の並行実行問題です。

# 修正方針
suppliers.nameの変更トリガーと、purchase_requestsへのsupplier_id設定（INSERT/UPDATE）の
両方で、同一のsupplier_idをキーとしたtransaction advisory lockを取得し、直列化してください。
例:
  PERFORM pg_advisory_xact_lock(hashtextextended('supplier:' || <supplier_id>::text, 0));
を、
  1. suppliers.nameの変更前チェック（既存の参照確認トリガー内）
  2. purchase_requestsへのsupplier_id設定時のsupplier名整合性チェック（既存トリガー内）
の両方の冒頭で実行し、同じsupplier_idに対する処理を直列化する。
このロックはトランザクション終了時に自動解放されるため、明示的なUNLOCKは不要です。

# 追加すべき実DB E2E（必須）
2つのDB接続/トランザクションを用いた並行実行テストを追加し、以下を確認してください。
  Transaction A: 既存supplierのname変更
  Transaction B: 同じsupplierを参照するpurchase_request作成
を同時に実行し、両方がcommitされた後で、suppliers.nameとpurchase_requests.supplier_nameの
間に不整合が生じていないこと（片方が拒否される、または両方が同じ最終状態に収束すること）を
確認する。逐次実行のテストだけでは今回の指摘の解消とはみなしません。

# 修正不要（今回は対応済みとして扱う）
- 前回のBLOCKER-01（supplier.name変更の逐次防御）、BLOCKER-02（DBエラーの握り潰し）は
  今回のレビューで解消済みと判定されています。再度手を入れる必要はありません。

# 受け入れ基準（Definition of Done）
- [ ] supplier.name変更とpurchase_request作成の並行実行テストで、最終的にsuppliers.nameと
      purchase_requests.supplier_nameの不整合が発生しないことを確認する
- [ ] advisory lockの導入によって、既存の逐次実行テスト（前回追加分）に回帰がない
- [ ] advisory lockのキー設計が、異なるsupplier_id間で不要な直列化を起こしていない
- [ ] 修正後、クリーンDBでverify_schema.pyを含む実DB E2Eを再実行し、並行実行テストを含めて
      全件PASSの結果を添付する
- [ ] 完了報告に実際のコミットSHA（git rev-parse HEAD）を正確に記載する
- [ ] feature/p2-t2-suppliers ブランチに追加コミット・pushし、比較URLを報告に含める

# ChatGPTレビュー時の確認観点
- advisory lockのキーがP1-T3のDEBT-006対応（tenant_id + target_type）と衝突しない、
  独立したキー空間になっているか（'supplier:'のようなプレフィックスで区別されているか）
- purchase_requests側のロック取得位置が、既存のtenant整合性トリガーの実行順序と
  矛盾しないか（デッドロックの可能性がないか）
```

---

#### 【マージ指示プロンプト P2-T2-MERGE】mainへのマージ

ChatGPT(SO)よりP2-T2-FIX2が正式PASS（3つのBLOCKER全解消、並行実行の両方向を実DBで確認済み）と判定された。

```
# 指示
feature/p2-t2-suppliers を main へマージしてください。
SO(ChatGPT)による正式PASS判定を得ています（参照済みsupplier名変更の逐次防御、DBエラーの
握り潰し除去、advisory xact lockによる同時実行race conditionの解消の3点すべてを実DBで
確認済み、Schema E2E 114/114・Jest 133/133）。
マージ後、以下を確認し報告してください。
- main上でクリーンDBに対しverify_schema.pyを含む実DB E2Eを再実行し、全件PASSを確認する
- Backend/Frontendのテストを再実行して確認
- マージコミットハッシュ
- 作業ブランチ feature/p2-t2-suppliers の削除（マージ済み後）
```

これでP2-T2は完了。次はP2-T3（発注〜検収〜請求の連携）へ進む。

---

#### 【指示プロンプト P2-T3】発注〜検収〜請求の連携

```
# 背景・目的
P2-T1でpurchase_requestsの承認（active化）まで、P2-T2でサプライヤーマスタとの正式な
紐付けまで実装した。本タスクでは、activeになった発注申請に対する「検収（納品物の受領記録）」
と、既存の経理会計基盤にある請求書管理（vendor_bills）との紐付けを実装し、
発注から支払いまでの一連の業務フローを完成させる。

# 前提となる既存実装
- P2-T1: purchase_requests（active後は主要項目改変禁止のWORM）
- P2-T2: suppliers、advisory lockによる同時実行対策のパターン
- 既存の経理会計基盤: vendor_bills（請求書管理。詳細はdocs/03_database_design.mdを参照）
- Phase 1/Phase 2で確立した設計パターン全般（tenant整合性トリガー、RLS、RBAC三層防御、
  migrationのappend-only・fail-closed運用）

# やってはいけないこと
- vendor_billsの既存スキーマ・既存の経理処理ロジック（仕訳連携等）を変更・破壊しない。
  purchase_requestsとの紐付けは、既存vendor_billsに新しい参照列を追加する形で行い、
  vendor_bills側の確定済み処理ロジックには手を入れない。
- purchase_requestsがactive化した後の主要項目（金額・数量等）の改変禁止（WORM）を、
  検収記録の追加によって迂回できる設計にしない。

# 実装対象
1. 新規マイグレーションで purchase_receipts テーブル（検収記録）を作成する
   （id, tenant_id, purchase_request_id, received_quantity, received_date, notes,
   received_by, created_at等）。RLS（ENABLE + FORCE）、tenant整合性トリガー
   （purchase_request_id経由でpurchase_requests.tenant_idと一致することをDB保証、
   received_by経由でのユーザーtenant整合性も同様に保証）を実装する。
   検収は複数回に分けて行われ得る（部分納品）ことを考慮し、1つのpurchase_requestに対して
   複数のpurchase_receiptsレコードを許容する設計とする。
2. vendor_bills に purchase_request_id（nullable, purchase_requests(id)への参照）を追加する
   新規migrationを作成し、tenant整合性トリガーを追加する（既存vendor_billsのtenant整合性
   検証パターンがあればそれに倣う、なければP2-T1/P2-T2と同じパターンで新規実装）。
3. purchase_request.receive（検収記録の権限）、purchase_request.link_bill（請求書紐付けの権限）
   のpermissionをRBAC体系に追加し、Controller・Service両層でチェックする。
4. purchase_requestの詳細画面に、検収記録の追加・一覧表示、紐付けられたvendor_billsへの
   リンク表示を実装する。

# 受け入れ基準（Definition of Done）
- [ ] activeな発注申請に対して検収記録を追加できる（部分納品による複数回の検収を含む）
- [ ] draft/pending_approval状態の発注申請には検収記録を追加できない
      （状態遷移の一貫性を維持する）
- [ ] 他テナントのpurchase_request_id/received_byを指定した場合にDBトリガーで拒否される
- [ ] vendor_billsとpurchase_requestsの紐付けが、他テナントのレコードを跨いで
      成立しないことをDBトリガーで確認する
- [ ] permissionを持たないロールでは検収記録・請求書紐付けができないことを確認
- [ ] 既存のvendor_bills関連機能（仕訳連携等）に回帰がない
- [ ] migrationがappend-only・fail-closedの原則（本計画書0.4節）に従っている
- [ ] Phase 0で確立した実DB E2E検証基盤で、上記すべてを実PostgreSQL上で確認し、
      結果を報告に添付する
- [ ] feature/p2-t3-purchase-receipts-billing ブランチにコミット・pushし、比較URLを
      報告に含める（本計画書0.4節に従う）

# ChatGPTレビュー時の確認観点
- 部分納品（複数回の検収）が、発注数量の合計を超えて記録されることを防ぐ制約があるか
  （なければDEBT候補として記録することを推奨）
- vendor_billsという確定済み会計処理の中核テーブルに新しい参照列を追加することで、
  既存の仕訳連携・決算処理等に意図しない影響が出ていないか、特に慎重に確認してほしい
- Phase 1/Phase 2で繰り返し指摘された問題（暗黙自動承認、tenant整合性のアプリ層依存、
  RBAC未強制、同時実行race condition、migration事後書き換え）のいずれかが
  再発していないか
```

---

#### 【フォローアップ指示プロンプト P2-T3-VERIFY】push状態の確認（SOはコミットSHAが確認できるまでレビュー不可）

ChatGPT(SO)より、完了報告に対応する実装コミットがGitHub main（f014b9a時点）上でまだ
確認できないため、実コード確認を伴うレビューが実施できない状態にあると指摘された。
これは本計画書0.4節「push前の報告のみの完了通知は受け付けない」というルールに関わる。

```
# 指示
以下を確認し、必要な対応を行ってください。

1. git status / git log で、P2-T3の実装（019_purchase_receipts_and_billing.sql、
   backend/frontend実装、E2Eテスト等）が実際にローカルでコミットされているか確認する。
2. コミットされていない場合はコミットし、feature/p2-t3-purchase-receipts-billing ブランチへ
   pushする。コミット済みだがpushされていない場合はpushする。
3. push後、GitHub上で該当ブランチのHEADが今回報告した実装内容と一致していることを
   自分でも確認する。
4. 新しいコミットSHA（git rev-parse HEAD）と、main...<ブランチ名>の比較URLを報告に含める。
5. 今回のpush漏れがなぜ起きたか一言報告してください（再発防止のため記録します）。

SOはコミットSHAを受け取り次第、main...HEADの実差分を確認して正式なレビュー
（PASS/CONDITIONAL PASS/REQUEST CHANGES）を行います。
```

---

#### 【フォローアップ指示プロンプト P2-T3-FIX】REQUEST CHANGES対応（purchase_receiptsのDELETE WORMが未防御）

ChatGPT(SO)よりP2-T3が「REQUEST CHANGES」と判定された。部分納品の数量超過防御・
concurrency race対策・tenant整合性・RBAC・vendor_bills連携は評価されており、
修正対象はDELETEに対するWORM防御の欠落1点に限定される。

```
# SOレビュー結果：P2-T3 REQUEST CHANGES
main...feature/p2-t3-purchase-receipts-billing の実差分（コミットc5bc30a）を確認した結果、
現状はマージ不可です。purchase_receiptsは「追記専用（append-only）」という仕様であるにも
かかわらず、UPDATEに対するWORMトリガーはあるものの、DELETEに対する防御が存在しません。
さらにapp_runtimeロールにDELETE権限そのものが付与されているため、APIにDELETE
エンドポイントが存在しないことに頼るだけの状態になっています。APIレベルで防いでいるだけ
ではDBを最終防衛線とする原則を満たしません。

# 修正方針
1. purchase_receiptsへのDELETEを拒否するBEFORE DELETEトリガーを追加する。
   （UPDATEトリガーと同様のパターンで、RAISE EXCEPTION ... USING ERRCODE = '23514'とする）
2. 可能であれば、app_runtimeロールに対するDELETE権限自体をREVOKEする
   （GRANT SELECT, INSERT, UPDATE ON purchase_receipts TO app_runtime; のようにDELETEを
   含めない形に修正する）。トリガーとGRANT制限の両方を防御層として持たせる。
3. 既存のmigrationを書き換えるのではなく、新規migrationとして今回の修正を追加する
   （本計画書0.4節のappend-only原則に従う）。

# 追加すべき実DB E2E（必須）
purchase_receiptsに対して以下を実PostgreSQLで確認してください。
  1. INSERT成功
  2. UPDATE試行 → 23514で拒否（既存確認分の維持）
  3. DELETE試行 → 23514で拒否（新規追加）
  4. 上記の操作後もレコードが変更されずに残存していることを確認

# あわせて確認してほしいこと（今回のブロッカーではないが、報告に含めること）
hasPurchaseReceiptsTable() / hasVendorBillPurchaseRequestId() について、P2-T2の
hasSupplierIdColumn()で問題になった「DBエラーをcatchでfalseに変換する」という広すぎる
catch句が存在しないか確認してください。存在する場合は同じ方針（列/テーブルの非存在は
正常なクエリ結果として判定し、クエリ自体の失敗は例外として伝播させる）で修正してください。

# 修正不要（今回は記録のみ）
- purchase_requestsがactiveからterminatedへ遷移した後もvendor_bills.purchase_request_idの
  リンクが自動解除されない点は、今回のDoD範囲外です。DEBT-014として計画書側で追跡します。

# 受け入れ基準（Definition of Done）
- [ ] purchase_receiptsへのDELETEがDBトリガーで拒否される
- [ ] app_runtimeのDELETE権限が削除されている（可能な場合）
- [ ] 既存のUPDATE拒否・数量超過防御・tenant整合性等のE2Eに回帰がない
- [ ] hasPurchaseReceiptsTable() / hasVendorBillPurchaseRequestId() のDBエラー処理を確認し、
      広すぎるcatchがあれば修正する（なければその旨を報告に明記する）
- [ ] クリーンDBで001〜019（および今回の追加migration）を再適用し、全件PASSを確認する
- [ ] feature/p2-t3-purchase-receipts-billing ブランチに追加コミット・pushし、比較URLを
      報告に含める（本計画書0.4節に従う）

# ChatGPTレビュー時の確認観点
- DELETEトリガーの追加によって、既存の正常なINSERT/UPDATEフローに意図しない副作用が
  出ていないか
- app_runtimeのDELETE権限REVOKEが、他の正当な運用上のDELETE操作（もしあれば）を
  阻害していないか
```

---

#### 【フォローアップ指示プロンプト P2-T3-FIX-VERIFY】コミットSHA・ブランチ情報の報告（設計内容は妥当と評価済み）

ChatGPT(SO)より、P2-T3-FIXの**修正内容（DELETEトリガー追加、REVOKE DELETE、append-only
migrationとしての020追加、E2E内容）は前回BLOCKERを正しく解消する方向として妥当**と評価
された。ただし、完了報告にFIX後の正確なコミットSHA・ブランチ情報が含まれておらず、
GitHub上で実装現物を特定できないため、正式なレビューが行えない状態にある。
この問題はP0-T1、P1-T5-FIX3、P2-T3、そして今回のP2-T3-FIXで繰り返し発生しているため、
本計画書0.4節のルールを強化した（すべての完了報告にコミットSHA・ブランチ名を必須記載）。

```
# 指示
今回の完了報告には、修正内容の説明はありましたが、以下の情報が不足していました。
今後の全ての完了報告では、これらを省略せず必ず含めてください。

1. git rev-parse HEAD の実行結果（正確なコミットSHA）
2. 作業ブランチ名
3. git ls-remote origin <ブランチ名> の実行結果（ローカルとリモートのSHAが一致しているか
   の確認）
4. main...<ブランチ名> の比較URL
   （例: https://github.com/somurye/fullstack-ai-accounting/compare/main...<ブランチ名>）

上記4点を今すぐ確認し、報告してください。もしまだpushされていない変更がある場合は、
先にコミット・pushを完了させてから報告してください。

# 受け入れ基準（Definition of Done）
- [ ] git rev-parse HEADの結果が報告に明記されている
- [ ] git ls-remoteの結果、ローカルとリモートのSHAが一致している
- [ ] main...ブランチ名の比較URLが報告に含まれている
- [ ] 前回報告した修正内容（DELETEトリガー、REVOKE DELETE、E2E）が、そのSHA時点で
      実際にコミットされていることをGemini自身も再確認する
```

---

#### 【マージ指示プロンプト P2-T3-MERGE】mainへのマージ

ChatGPT(SO)よりP2-T3-FIXが正式PASS（purchase_receiptsのDELETE WORM防御を追加、既存機能への回帰なし、実DB E2E 124/124）と判定された。

```
# 指示
feature/p2-t3-purchase-receipts-billing を main へマージしてください。
SO(ChatGPT)による正式PASS判定を得ています（020マイグレーションによるDELETE WORM防御の
追加、app_runtimeからのDELETE権限REVOKE、既存のUPDATE WORM・数量超過防御・tenant整合性・
RBAC・vendor_bills連携に回帰がないことを実DB E2E 124/124・Jest 137/137で確認済み）。
DEBT-014（terminated後のvendor_billsリンク未解除）は計画書側で追跡することとし、
今回のマージをブロックするものではありません。
マージ後、以下を確認し報告してください（本計画書0.4節に従い、コミットSHA・ブランチ名を
必ず明記すること）。
- main上でクリーンDBに対しverify_schema.pyを含む実DB E2Eを再実行し、全件PASSを確認する
- Backend/Frontendのテストを再実行して確認
- マージコミットハッシュ（git rev-parse HEAD）
- 作業ブランチ feature/p2-t3-purchase-receipts-billing の削除（マージ済み後）
```

これでP2-T3は完了。次はP2-T4（購買ダッシュボード・レポート）へ進む。**これでPhase 2の全4タスクが出揃う。**

---

#### 【指示プロンプト P2-T4】購買ダッシュボード・レポート

```
# 背景・目的
P2-T1〜T3で発注申請・サプライヤー・検収・請求連携が揃った。本タスクでは、テナント内の
購買状況を可視化するダッシュボードを実装し、Phase 2を締めくくる。これはこれまでと異なり
読み取り専用（集計・表示のみ）の機能であり、新しい書き込み系のリスクは少ないが、
集計クエリがtenant境界を越えないことは引き続き最重要の確認事項となる。

# 前提となる既存実装
- P2-T1: purchase_requests（ステータス別件数、金額集計の対象）
- P2-T2: suppliers（サプライヤー別集計の対象）
- P2-T3: purchase_receipts, vendor_bills連携（発注〜検収〜請求の進捗状況）
- Phase 0/1/2で確立したRLS・RBACパターン全般

# やってはいけないこと
- 集計クエリを実装する際、パフォーマンス上の理由でRLSを迂回する特別なDB接続や
  BYPASSRLS権限を使わない。P1-T4（全テナント横断バッチ）で確立した「RLSバイパスに
  頼らずテナントごとに処理する」原則は、今回は単一テナント内の集計なので該当しないが、
  念のためRLSが常に有効な接続で集計することを徹底する。
- 集計結果に他テナントのデータが混入するような、JOIN条件のtenant_id漏れを起こさない。

# 実装対象
1. ダッシュボードAPI（例: GET /purchase-dashboard/summary）を実装し、以下を返す。
   - ステータス別件数（draft/pending_approval/active/rejected/terminated）
   - サプライヤー別の発注金額合計（上位N件）
   - 今月/今期の発注金額合計
   - 検収待ち（activeだが未検収）の発注件数
2. purchase_request.view権限を持つユーザーのみアクセス可能にする（Controller/Service両層）。
3. フロントエンドにダッシュボード画面（KPIカード、簡易グラフ、サプライヤー別ランキング等）を
   実装する。
4. 集計クエリは既存のRLSに依存しつつ、アプリケーション層でも明示的にtenant_idを
   条件に含める（P1-T6の類似検索APIで確立した二重防御パターンを踏襲する）。

# 受け入れ基準（Definition of Done）
- [ ] ダッシュボードAPIが正しい集計結果を返す
- [ ] 他テナントのデータが集計結果に一切混入しないことを実DB E2Eで確認する
      （2テナントにそれぞれ発注データを用意し、互いの集計に影響しないことを確認）
- [ ] purchase_request.view権限がないユーザーはダッシュボードにアクセスできない
- [ ] 大量データでの集計クエリのパフォーマンスに明らかな問題がないか簡易的に確認する
      （インデックスが必要な場合は追加する）
- [ ] Phase 0で確立した実DB E2E検証基盤で、上記すべてを確認し結果を報告に添付する
- [ ] feature/p2-t4-purchase-dashboard ブランチにコミット・pushし、比較URLを報告に含める
      （本計画書0.4節に従う。コミットSHA・ブランチ名を必ず明記すること）

# ChatGPTレビュー時の確認観点
- 集計クエリのJOIN/WHERE条件すべてにtenant_idが明示的に含まれているか（1箇所でも
  漏れがあれば他テナントのデータが混入し得る）
- 読み取り専用機能であっても、RBAC（purchase_request.view）のチェックが省略されていないか
```

---

#### 【フォローアップ指示プロンプト P2-T4-FIX】REQUEST CHANGES対応（月次推移未検証・EXPLAIN検証が実質無意味）

ChatGPT(SO)よりP2-T4が「REQUEST CHANGES」と判定された。RLS/RBAC/tenant分離/集計ロジック
（ステータス集計、supplier ranking、検収待ち、今月/今期）は評価されており、修正対象は
検証（テスト）の不足に限定される。**これはP1-T2で学んだ「テストPASSは実動作の証明に
ならない」（本計画書0.4節ルール5）が今回も当てはまるケースである。**

```
# SOレビュー結果：P2-T4 REQUEST CHANGES
main...feature/p2-t4-purchase-dashboard の実差分（コミットa651c28）を確認した結果、
現状はマージ不可です。実装ロジック自体に重大な欠陥はありませんが、以下2点の検証が
不足しています。

# BLOCKER-01: 月次推移（monthly_trends）がE2Eで一度も値照合されていない
aggregateMonthlyTrends()は実装されていますが、E2Eではsummary.monthly_trendsの内容を
一度もassertしていません。「実装されている」ことと「正しく集計されている」ことは別です。

## 修正方針
6ヶ月分にわたる異なる月のpurchase_requestsテストデータ（active/非active混在）を用意し、
summary.monthly_trendsの各月について、month/active_amount/total_amount/request_countの
期待値と実際の値を照合するE2Eアサーションを追加してください。

# BLOCKER-02: EXPLAIN検証が実質的に何でもPASSする無意味な判定になっている
現在のE2Eは、実行計画の文字列に'Index Scan'、'Bitmap'、'Seq Scan'のいずれかが含まれていれば
PASSとしています。PostgreSQLの通常のSELECTは高確率でこのいずれかに該当するため、
これは実質的に「常にPASSする」検証であり、「大量データでの集計クエリのパフォーマンスに
明らかな問題がないか確認する」というP2-T4のDoDを何も証明していません。
また、コード内のコメント（「インデックススキャンが使われているか確認」）と実際の
判定ロジックも一致していません。

## 修正方針
以下のいずれかの方法で、意味のある検証に置き換えてください。
  A案: EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) を使い、実行時間・実際のスキャン行数等を
       取得し、ログまたはアサーションの根拠として報告に含める。
  B案: 十分なテストデータ量を用意した上で、既存インデックス（ix_purchase_requests_tenant_
       status等）が実際に利用されていることを確認する。
「小規模テストDBではSeq Scanが選択されること自体は問題ではない」ため、
「Seq ScanでなければFAIL」のような逆方向の誤った基準にもしないでください。
重要なのは、今の判定が何も証明していない状態を解消することです。

# 修正不要（今回は記録のみ）
- fiscal_yearsの非暦年ケース（4月始まり等）でのE2E検証が手薄な点は、今回のブロッカーには
  しません。DEBT-015として計画書側で追跡します。

# 受け入れ基準（Definition of Done）
- [ ] monthly_trendsの6ヶ月分について、月ごとの期待値とE2Eでの実測値が一致することを確認する
- [ ] EXPLAIN検証が、実際にパフォーマンス上意味のある情報（実行時間、スキャン方式の実測等）を
      確認する内容に置き換わっている
- [ ] 既存の正常系（RLS、RBAC、tenant isolation、status集計、supplier ranking、検収待ち、
      今月/今期集計）のE2Eに回帰がない
- [ ] 完了報告に正確なコミットSHA（git rev-parse HEAD）・ブランチ名・main...ブランチの比較URLを
      明記する（本計画書0.4節ルール4に従う）
- [ ] feature/p2-t4-purchase-dashboard ブランチに追加コミット・pushし、比較URLを報告に含める

# ChatGPTレビュー時の確認観点
- 追加されたmonthly_trendsのアサーションが、実際に6ヶ月分の異なる値を区別して検証しているか
  （全月が同じ値になるようなテストデータで「たまたま一致した」ことになっていないか）
- EXPLAIN検証の修正が、今後同様の「実質何もチェックしていないテスト」を生まない形になっているか
```

---

#### 【マージ指示プロンプト P2-T4-MERGE】mainへのマージ ＋ Phase 2クローズ

ChatGPT(SO)よりP2-T4-FIXが正式PASS（月次推移の実値照合、EXPLAIN ANALYZEによる意味のあるパフォーマンス検証、tenant isolationの意図的な混入テストを確認済み）と判定された。

```
# 指示
feature/p2-t4-purchase-dashboard を main へマージしてください。
SO(ChatGPT)による正式PASS判定を得ています（monthly_trendsの6ヶ月分実値照合、
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)による実測、enable_seqscan=offでのindex適合性確認、
Tenant A/Bへの意図的な特徴的データ投入によるisolation確認を実施済み）。
DEBT-015（fiscal_yearsの非暦年ケース検証不足）は計画書側で追跡することとし、
今回のマージをブロックするものではありません。
マージ後、以下を確認し報告してください（本計画書0.4節に従い、コミットSHA・ブランチ名を
必ず明記すること）。
- main上でクリーンDBに対しverify_schema.pyを含む実DB E2Eを再実行し、全件PASSを確認する
- Backend/Frontendのテストを再実行して確認
- マージコミットハッシュ（git rev-parse HEAD）
- 作業ブランチ feature/p2-t4-purchase-dashboard の削除（マージ済み後）
```

**これでPhase 2（購買・調達）は全4タスク完了。**

### Phase 2クローズ時点のサマリ

| タスク | 最終判定 | 往復回数 |
|--------|----------|----------|
| P2-T1 | ✅ PASS | 1回（初回レビューでPASS） |
| P2-T2 | ✅ PASS | 3回（参照済み名称変更 → 逐次防御 → 並行実行race condition） |
| P2-T3 | ✅ PASS | 3回（push漏れ → DELETE WORM欠落 → SHA報告漏れ） |
| P2-T4 | ✅ PASS | 1回（月次推移未検証＋EXPLAIN検証の形骸化） |

### Phase 2で確立・強化された恒久ルール

1. 0.4節ルール4を強化：全ての完了報告にコミットSHA・ブランチ名の明記を必須化
   （P0-T1, P1-T5-FIX3, P2-T3, P2-T3-FIXでの同種の問題を受けて）。
2. 0.4節ルール5「テストPASSは実動作の証明にならない」が、P2-T4のEXPLAIN検証形骸化で
   再確認された（P1-T2に続き2件目の実例）。

### 未解決の技術的負債一覧（Phase 3着手前に一度棚卸しを推奨）

DEBT-001, 002, 007, 008, 009, 010, 011, 012, 013, 014, 015 が5節に記録されている
（DEBT-003〜006は解消済み）。Phase 3（人事労務）は労働法制の複雑さがこれまでのPhaseより
高いため、着手前にDEBT-001（ファイル保存の非原子性）のような基盤寄りの負債を
再評価しておくことを推奨する。

---

## 5. Phase 3: 人事労務（勤怠管理・給与計算・社保）

### 5.1 目的

勤怠管理・給与計算内製化・社会保険/年末調整を実装する。Phase 0〜2と同じ設計パターン
（tenant整合性のDBトリガー、暗黙自動承認の防止、RBAC三層防御、migrationのappend-only・
fail-closed運用）を踏襲しつつ、本Phaseは他のPhaseと質的に異なるリスクを伴う。

### 5.2 本Phase特有の設計原則（最重要・全タスク共通）

人事労務、特に給与計算・社会保険・税務は、計算ミスがそのまま従業員への支払い誤りや
法令違反に直結する領域である。これまでのPhaseで培った「DBトリガーでの防御」「実DB E2E
検証」だけでは、**計算結果が法令上正しいこと**までは保証できない。そのため、以下を
全タスク共通の設計原則とする。

1. **保険料率・税率はコードやmigrationにハードコードしない。** 健康保険料率、厚生年金保険料率、
   雇用保険料率、所得税の源泉徴収税額表、住民税率等は、都道府県・年度によって変動し、
   毎年改定される。これらは「有効期間（effective_from/effective_to）付きのマスタデータ」
   として保持し、テナント管理者（または将来のマスタ更新機能）が更新できる設計にする。
   ハードコードすると、翌年度の税制改正のたびにアプリケーションのコード変更・再デプロイが
   必要になり、改定漏れによる計算誤りのリスクが高まる。
2. **給与計算・社保計算は「AI/ルールエンジンによる提案 → 人間の確認・承認 → 確定」という
   既存のAI提案パターンをそのまま踏襲する。** 自動計算された給与額を直ちに確定・支給せず、
   必ず担当者（1人テナントであれば本人）が計算根拠（適用した料率・控除項目）を確認した
   上で確定操作を行うワークフローとする。これはPhase 1のcontracts/ai_suggestionsで確立した
   「AI提案 → 人間承認 → Core API → DB制約」の構造を、法令計算の文脈に適用したものである。
3. **本計画書（Claude）およびGemini/ChatGPTによる実装・レビューは、法令準拠を保証するもの
   ではない。** 計算ロジック（特に社会保険料率表、所得税額表、年末調整の計算式）を実装する
   際は、実際の運用開始前に社会保険労務士・税理士等の専門家によるレビューを受けることを
   強く推奨する。本計画書のSOレビュー（ChatGPT）はDB設計・tenant分離・セキュリティ・
   同時実行安全性等の技術的正しさを検証するものであり、法令計算式そのものの正しさを
   検証する立場にはない。
4. **計算過程の監査可能性を最優先する。** 「なぜこの金額になったか」を後から追跡できるよう、
   適用した料率・控除項目・計算式のバージョンを、計算結果と一緒に記録する（既存の
   audit_logsパターンを踏襲）。

### 5.3 タスク分解

| タスクID | タスク名 | 概要 | 依存 | ステータス |
|----------|----------|------|------|-----------|
| P3-T1 | 従業員マスタ・勤怠管理 | 従業員情報、打刻（出勤・退勤・休憩）、労働時間集計（所定内・時間外・深夜・休日労働の区分） | P0-T1, P0-T4 | ✅ SO正式PASS（コミット35185ba、5回の往復を経てロック取得順序の統一・週40時間境界の並行E2Eを確認、mainマージ指示済み） |
| P3-T2 | 保険料率・税率マスタ管理 | 健康保険・厚生年金・雇用保険の料率、所得税源泉徴収税額表、住民税率を有効期間付きで管理する基盤（5.2節の原則①に対応） | P0-T1 | ✅ SO正式PASS（適用開始後のレコードをDBトリガーでfail-closedに変更禁止、JST基準・法改正close+INSERT運用を確認、mainマージ指示済み） |
| P3-T3 | 給与計算エンジン | 勤怠実績・基本給・手当・控除から給与を計算し、AI提案パターンで人間確認を経て確定する（5.2節の原則②に対応） | P3-T1, P3-T2 | ⚠️ SO判定REQUEST CHANGES（コミットb2beb30、approval_requestsの偽造INSERTは解消したが、pending→approvedへの直接UPDATE経路がDB最終防御になっていない。承認エンジンのapprove操作の正当性検証自体をDBに持たせる必要あり。修正指示済み・再レビュー待ち） |
| P3-T4 | 給与明細発行・年末調整 | 給与明細のPDF発行、年末調整の計算・書類生成 | P3-T3 | 未着手 |

P3-T2以降の詳細タスク分解・実装指示プロンプトは、P3-T1の実装結果を踏まえてClaudeが
都度作成する（Phase 0/1/2と同じ方針）。

### 5.4 Phase 3 実装指示プロンプト（Gemini向け）

#### 【指示プロンプト P3-T1】従業員マスタ・勤怠管理

```
# 背景・目的
人事労務Phaseの最初のタスクとして、従業員マスタと勤怠（打刻・労働時間集計）を実装する。
本タスクは給与計算そのものを含まず、法令計算の正しさに関するリスクが相対的に低い部分から
着手する。ただし、労働時間の区分（所定内/時間外/深夜/休日）は後続の給与計算で使われる
重要な基礎データになるため、区分ロジックは正確に実装する必要がある。

# 前提となる既存実装
- P0-T4: RBACロール・permission体系（employeeロールが既存roles一覧に存在することを確認）
- Phase 0/1/2で確立した設計パターン全般（tenant整合性トリガー、RLS、RBAC三層防御、
  migrationのappend-only・fail-closed運用）

# やってはいけないこと
- 給与計算そのものをこのタスクに含めない（P3-T3で別途実装する）。
- 保険料率・税率のようなハードコードしてはいけない値を、このタスクでも埋め込まない
  （本タスクでは労働時間の集計のみを扱うため該当箇所は少ないはずだが、時間外労働の
  割増率（例: 25%, 35%, 50%）についても、将来の法改正に備えてマスタ化を検討し、
  難しい場合は少なくとも定数として一箇所に集約し、ハードコードの散在を避ける）。
- Phase 0〜2で繰り返し指摘・修正された問題（暗黙自動承認、tenant整合性のアプリ層依存、
  RBAC未強制、migration事後書き換え、fail-closedでないデータ検証、DBエラーの握り潰し、
  同時実行race condition、実質何も検証しないテスト）のいずれも再発させないこと。

# 実装対象
1. 新規マイグレーションで employees テーブルを作成する
   （id, tenant_id, user_id（既存usersテーブルへの参照、nullable可、アカウントを
   持たない従業員も想定）, employee_no, name, hire_date, employment_type
   (full_time/part_time/contract等), status(active/inactive)等）。
   RLS（ENABLE + FORCE）、tenant整合性トリガーを実装する。
2. attendance_records テーブルを作成する
   （id, tenant_id, employee_id, work_date, clock_in, clock_out, break_minutes,
   regular_hours, overtime_hours, late_night_hours, holiday_hours等）。
   RLS、tenant整合性トリガー（employee_id経由）を実装する。
3. 労働時間区分ロジックを実装する（例: 1日8時間・週40時間を超える部分を時間外、
   22時〜5時を深夜、法定休日労働を休日労働として区分する）。この計算ロジックは
   将来の変更に備えて、区分の閾値（8時間、22時〜5時等）を定数として一箇所に集約する。
4. employee.create/view/edit、attendance.create/view/edit のpermissionをRBAC体系に
   追加し、Controller・Service両層でチェックする。
5. 従業員登録・勤怠打刻・勤怠一覧のAPIとフロントエンド画面を実装する。

# 受け入れ基準（Definition of Done）
- [ ] 従業員を登録・編集・検索できる
- [ ] 打刻（出勤・退勤・休憩）を記録し、労働時間が正しく区分（所定内/時間外/深夜/休日）される
- [ ] 他テナントの従業員・勤怠データが一切見えないことをRLSで確認
- [ ] permissionを持たないロールでは操作できないことを確認
- [ ] 労働時間区分の境界値（例: ちょうど8時間、22時ちょうど）でのテストケースを含める
- [ ] migrationがappend-only・fail-closedの原則（本計画書0.4節）に従っている
- [ ] Phase 0で確立した実DB E2E検証基盤で、上記すべてを実PostgreSQL上で確認し、
      結果を報告に添付する
- [ ] 完了報告に正確なコミットSHA（git rev-parse HEAD）・ブランチ名・main...ブランチの
      比較URLを明記する（本計画書0.4節ルール4に従う）
- [ ] feature/p3-t1-employees-attendance ブランチにコミット・pushし、比較URLを報告に
      含める（本計画書0.4節に従う）

# ChatGPTレビュー時の確認観点
- 労働時間区分ロジックの境界値（8時間ちょうど、22時ちょうど等）が期待通りに動作するか
- Phase 0〜2で繰り返し指摘された問題のいずれかが再発していないか
- 時間外割増率等の定数が、将来の法改正時に変更しやすい場所に集約されているか
  （ハードコードが複数箇所に散在していないか）
```

---

#### 【フォローアップ指示プロンプト P3-T1-FIX】REQUEST CHANGES対応（週40時間計算の未接続・object-level authorization欠如）

ChatGPT(SO)よりP3-T1が「REQUEST CHANGES」と判定された。DB設計・RLS・tenant整合性・
重複打刻防止・日次労働時間計算（8時間/22時境界/法定休日）は評価されており、修正対象は
以下2点のBLOCKERに限定される。

```
# SOレビュー結果：P3-T1 REQUEST CHANGES
main...feature/p3-t1-employees-attendance の実差分（コミットe1537ec）を確認した結果、
現状はマージ不可です。

# BLOCKER-01: 週40時間計算が実際の勤怠登録フローに接続されていない
calculateWeeklyWorkHours()は実装され、単体テストも充実していますが、
AttendanceService.clock() / createRecord()はこの関数を呼び出しておらず、
日単位の計算結果（regular_hours/overtime_hours等）のみを保存しています。
そのため、週40時間を超えた労働の時間外判定が、実際のユーザー操作（打刻・勤怠登録）の
結果としては一切反映されません。「関数が存在し単体テストがある」ことと「実際のアプリ
ケーション経路で使われている」ことは別問題です（本計画書0.4節ルール5を参照）。

## 修正方針
週40時間超過分をいつ・どこで確定するかの設計判断が必要です。以下いずれかの方針を
採用し、理由とともに報告してください。
  a. 打刻・勤怠登録の都度、対象週の勤怠レコードを再取得してcalculateWeeklyWorkHours()を
     実行し、週次超過分を該当レコードのovertime_hours等に反映・保存する。
  b. 日次計算はそのまま保存しつつ、週次集計は別途「週次サマリAPI」を設け、
     一覧・給与計算（P3-T3）で利用する際にそのAPI経由で週40時間超過を都度計算する。
どちらの方針でも構いませんが、少なくとも「ユーザーが実際に勤怠を6日分登録した結果として、
週40時間超過分がAPIレスポンスまたはDB保存値として確認できる」状態にしてください。

## 追加すべき実DB E2E（必須）
Calculatorを直接呼ぶテストではなく、AttendanceService（またはAPI）を通した実運用経路で、
6日分の勤怠を実際に登録し、その結果として週40時間超過分が正しく反映されることを確認する
テストを追加してください。

# BLOCKER-02: employeeロールに本人限定のobject-level authorizationがない
list() / getById() / clock() / createRecord() / updateRecord()のいずれも、tenant_idの
確認はありますが、「操作しようとしているemployee_idが、リクエストしたユーザー自身の
employee_idと一致するか」という確認がありません。そのため、employeeロールで
attendance.*権限を持つユーザーが、同一テナント内の他の従業員の勤怠を閲覧・打刻・
編集できてしまいます。これはtenant isolationとは別のobject-level authorizationの問題です。

## 修正方針
上記5つのメソッドすべてに、以下のいずれかのロジックを追加してください。
  - リクエストユーザーがemployeeロールのみを持つ場合、employee_idはリクエストユーザー
    自身に紐づくものに強制的に限定する（他のemployee_idを指定された場合は403）。
  - owner/accounting_manager等、複数従業員の勤怠を扱う権限を持つロールについては、
    従来通りテナント内の任意のemployee_idを扱えるようにする（全体管理者としての用途）。
ロールごとにアクセス範囲が異なる設計にする場合は、その境界を明示的にコードで表現し、
コメントで意図を残してください。

## 追加すべき実DB E2E（必須)
Employee Aのユーザーが、Employee Bのemployee_idを指定してlist/getById/clock/
createRecord/updateRecordを呼び出すと拒否される（403等）ことを確認するテストを、
5メソッドそれぞれについて追加してください。

# 修正不要（今回は記録のみ）
- DEBT-016（break_minutesの拘束時間超過検証なし）、DEBT-017（既存レコードへの
  clock-in更新で監査ログが記録されない分岐）は、今回のブロッカーにはしません。
  計画書側で追跡します。

# 受け入れ基準（Definition of Done）
- [ ] 週40時間超過が、実際のAttendanceService/APIを通した勤怠登録の結果として
      確認できる（Calculator単体呼び出しのテストだけでは不可）
- [ ] employeeロールのユーザーが、他のemployee_idを指定した操作（5メソッド全て）を
      試みると拒否される
- [ ] owner等の管理者ロールは従来通りテナント内の任意の従業員を扱える
- [ ] 既存の日次計算・RLS・tenant整合性・重複打刻防止のE2Eに回帰がない
- [ ] 完了報告に正確なコミットSHA（git rev-parse HEAD）・ブランチ名を明記する
      （本計画書0.4節ルール4に従う）
- [ ] feature/p3-t1-employees-attendance ブランチに追加コミット・pushし、比較URLを
      報告に含める

# ChatGPTレビュー時の確認観点
- 週40時間超過の反映タイミング（打刻の都度 vs 週次集計API）が、P3-T3の給与計算での
  利用方法と矛盾しないか
- object-level authorizationの実装が、owner等の管理者ロールの正当な操作まで
  誤って制限していないか
```

---

#### 【フォローアップ指示プロンプト P3-T1-FIX2】REQUEST CHANGES対応（週次再計算の競合・未退勤修正時の再計算漏れ・RBAC不一致）

ChatGPT(SO)よりP3-T1-FIXが「REQUEST CHANGES」と判定された。前回2つのBLOCKER
（週40時間計算の未接続、object-level authorization欠如）はいずれも正しく解消されている。
今回の指摘は、「週40時間超過をDB確定値として保存する」という設計を採用したことで
新たに顕在化した週次データ整合性の問題である。

```
# SOレビュー結果：P3-T1-FIX REQUEST CHANGES
main...feature/p3-t1-employees-attendance の実差分（コミット0a04626）を確認した結果、
現状はマージ不可です。前回の2つのBLOCKERは解消されていますが、以下2点の新規BLOCKERと
1点の要確認事項があります。

# BLOCKER-01: 週次再計算の同時実行競合
recalculateWeeklyWorkHours()は対象週の「既存レコード」をFOR UPDATEでロックしていますが、
「まだ存在しない別日のレコードが同時に追加されるケース」を直列化できません。同じ従業員の
同じ週について、異なる曜日の勤怠がほぼ同時に登録されると、互いの未commitの行が見えないため、
週40時間超過の判定が漏れる可能性があります（これはP1-T3のDEBT-006、P2-T2のFIX2で
対応した並行実行race conditionと同型の問題です）。

## 修正方針
P2-T2で確立したpg_advisory_xact_lockのパターンを踏襲し、「tenant_id + employee_id + 週の
開始日」をキーとしたtransaction advisory lockを、勤怠の作成・更新・週次再計算の冒頭で
取得してください。これにより同一従業員・同一週への並行変更を直列化します。

## 追加すべき実DB E2E（必須）
同一従業員・同一週の異なる曜日について、2つのDB接続/トランザクションで同時に勤怠を
登録し、最終的な週次集計（regular_hours/overtime_hours）が正しい値に収束することを
確認してください。

# BLOCKER-02: 未退勤状態への修正時に週次再計算が行われない
updateRecord()が「clockInかつclockOutが両方存在する場合のみ」recalculateWeeklyWorkHours()
を呼んでいるため、既に退勤済みだった勤怠のclock_outをNULLに戻す（未退勤状態に戻す）
修正を行った場合、影響を受ける週の他の日のovertime_hours等が古い値のまま残ります。
これは後続の給与計算（P3-T3）に古い時間外データが渡るリスクがあります。

## 修正方針
「clockInとclockOutが両方揃った場合のみ再計算」ではなく、「対象employee/work_dateの
勤怠レコードに変更が加えられたら、常にその週を再計算する」という設計に変更してください。
clock_outがNULLになった当日自体の時間は0として扱い、その上で週の他の日を含めて
再集計してください。

## 追加すべき実DB E2E（必須）
6日分の勤怠を登録して週40時間超過が発生する状態を作った後、そのうち1日をclock_out=NULLに
戻す更新を行い、残りの日のovertime_hours等が正しく再集計されることを確認してください。

# 要確認事項: RBACロール定義とisManager()の実装不一致
完了報告では「owner, payroll_admin, accounting_managerはテナント管理者ロール」として
いますが、実際のrole_permissionsではaccounting_manager/approverにemployee.create/edit,
attendance.create/editが付与されておらず、isManager()には含まれているのにpermissionが
不足しているため実質的に管理者操作ができません。以下のどちらかに揃えてください。
  (a) accounting_manager/approverにも管理者相当のattendance.create/edit等を正式に付与する
  (b) isManager()からaccounting_manager/approverを除外し、これらのロールは
      employee.view/attendance.viewの閲覧専用として明確化する
どちらを採用するか判断し、SQLのrole_permissionsとisManager()の実装、および完了報告の
記述を一致させてください。

# 受け入れ基準（Definition of Done）
- [ ] 同一従業員・同一週への並行勤怠登録が、advisory lockにより直列化され、
      最終的な週次集計が正しい値に収束することを実DB E2Eで確認する
- [ ] clock_outをNULLに戻す更新後も、対象週の他の日の時間外集計が正しく再計算される
- [ ] role_permissionsとisManager()の実装、完了報告の記述が一致している
- [ ] 前回のBLOCKER-01/02（週次計算の実運用接続、object-level authorization）に回帰がない
- [ ] 完了報告に正確なコミットSHA（git rev-parse HEAD）・ブランチ名を明記する
      （本計画書0.4節ルール4に従う）
- [ ] feature/p3-t1-employees-attendance ブランチに追加コミット・pushし、比較URLを
      報告に含める

# ChatGPTレビュー時の確認観点
- advisory lockのキー（tenant_id + employee_id + 週開始日）が、他タスクで既に使われている
  lockキー空間（supplier:等）と衝突しない設計になっているか
- 「常に週を再計算する」という変更が、パフォーマンス上明らかな悪化（不要な再計算の多発）を
  招いていないか
```

---

#### 【フォローアップ指示プロンプト P3-T1-FIX3】REQUEST CHANGES対応（updateRecord()のロック取得順序によるデッドロックリスク）

ChatGPT(SO)よりP3-T1-FIX2が「REQUEST CHANGES」と判定された。前回の3点
（週次再計算のrace condition、未退勤化時の再計算漏れ、RBACロール不一致）はすべて
正しく解消されている。今回の指摘は、修正時に新たに生まれたロック取得順序の不整合1点。

```
# SOレビュー結果：P3-T1-FIX2 REQUEST CHANGES
main...feature/p3-t1-employees-attendance の実差分（コミット805297a）を確認した結果、
現状はマージ不可です。

# BLOCKER: updateRecord()とcreateRecord()でadvisory lockの取得順序が逆になっている
createRecord()は「① advisory lock取得 → ② INSERT等 → ③ 週次再計算」の順序ですが、
updateRecord()は「① SELECT...FOR UPDATE → ② advisory lock取得 → ③ UPDATE → ④ 週次再計算」
の順序になっています。同じ週について、Transaction Aがupdaterecord()で既存レコードの
行ロックを保持しながらadvisory lock待ちになり、同時にTransaction Bがcreatorecord()で
advisory lockを保持しながら（週次再計算経由で）Aが保持する行のロック待ちになると、
循環待ち（デッドロック）が成立し得ます。

# 修正方針
updateRecord()のロック取得順序を、createRecord()と統一してください。
  ① 対象employee_id/work_dateを確認（クエリ自体は必要）
  ② advisory lock取得（tenant_id + employee_id + 週開始日）
  ③ SELECT ... FOR UPDATE
  ④ UPDATE
  ⑤ 週次再計算
「advisory lockを先に取得してから行ロックを取る」という順序を、勤怠の作成・更新・
週次再計算の全操作で統一してください。

# 追加すべき実DB E2E（必須、2種類）
1. 同一従業員・同一週について、既存レコードのupdateRecord()と、別日の新規createRecord()を
   同時実行し、デッドロックが発生せず両方が正常に完了し、最終的な週次合計が正しいことを
   確認する。
2. より強い証拠として、既存で月〜金の40時間が既に登録された状態から、土曜8時間・日曜8時間を
   同時に（2つの並行トランザクションで）登録し、最終的にregular=40h、overtime=16hに
   正しく収束することを確認する（前回のケース9「月火の同時登録」よりも週40時間境界を
   直接検証する内容にする）。

# 修正不要（今回は記録のみ）
- DEBT-013（break_minutesの拘束時間超過検証なし。既存DEBT-016と重複するため統合して
  記録する）、DEBT-014（既存clock-in更新時の監査ログ欠落。既存DEBT-017と同一）は
  今回のブロッカーにしません。

# 受け入れ基準（Definition of Done）
- [ ] updateRecord()のadvisory lock取得が、SELECT...FOR UPDATEより先に行われるよう
      修正されている
- [ ] updateRecord()とcreateRecord()の並行実行でデッドロックが発生しないことを実DB E2Eで確認
- [ ] 週40時間境界をまたぐ並行登録（月〜金40h + 土日を並行登録）で、最終的な週次集計が
      正しい値に収束することを実DB E2Eで確認
- [ ] 前回までに解消済みのBLOCKER（週次計算の実運用接続、object-level authorization、
      未退勤化時の再計算、RBAC整合性）に回帰がない
- [ ] 完了報告に正確なコミットSHA（git rev-parse HEAD）・ブランチ名を明記する
      （本計画書0.4節ルール4に従う）
- [ ] feature/p3-t1-employees-attendance ブランチに追加コミット・pushし、比較URLを
      報告に含める

# ChatGPTレビュー時の確認観点
- ロック取得順序の統一が、clock()・recalculateWeeklyWorkHours()を含む全操作で
  一貫しているか（updateRecord/createRecordだけの部分修正になっていないか）
- 週40時間境界の並行E2Eが、本当に境界（39h→40h→41h相当）を跨ぐデータで構成されているか
```

---

#### 【マージ指示プロンプト P3-T1-MERGE】mainへのマージ

ChatGPT(SO)よりP3-T1-FIX3が正式PASS（ロック取得順序の統一によりデッドロックの原因そのものを是正、週40時間境界を跨ぐ並行登録の収束を実DBで確認）と判定された。

```
# 指示
feature/p3-t1-employees-attendance を main へマージしてください。
SO(ChatGPT)による正式PASS判定を得ています（advisory lock→行ロックの順序を全操作で統一し
デッドロックの原因を設計から是正、update+create並行E2E、週40時間境界を跨ぐ並行登録の
収束確認、RBAC整合性、tenant isolationを確認済み）。
DEBT-016（break_minutesの拘束時間超過検証なし）、DEBT-017（clock-in更新時の監査ログ欠落）は
計画書側で追跡することとし、今回のマージをブロックするものではありません。
マージ後、以下を確認し報告してください（本計画書0.4節に従い、コミットSHA・ブランチ名を
必ず明記すること）。
- main上でクリーンDBに対しverify_schema.pyを含む実DB E2Eを再実行し、全件PASSを確認する
- Backend/Frontendのテストを再実行して確認
- マージコミットハッシュ（git rev-parse HEAD）
- 作業ブランチ feature/p3-t1-employees-attendance の削除（マージ済み後）
```

これでP3-T1は完了。次はP3-T2（保険料率・税率マスタ管理）へ進む。

---

#### 【指示プロンプト P3-T2】保険料率・税率マスタ管理

```
# 背景・目的
5.2節の設計原則①に基づき、健康保険・厚生年金・雇用保険の料率、所得税源泉徴収税額表を
「有効期間付きのマスタデータ」として管理する基盤を実装する。これらの値は都道府県・年度に
よって変動し、法改正のたびに更新が必要になるため、コードやmigrationにハードコードせず、
管理画面から更新できる構造にする。本タスクはP3-T3（給与計算エンジン）の前提となる。

# 前提となる既存実装
- Phase 0〜2、P3-T1で確立した設計パターン全般（tenant整合性トリガー、RLS、RBAC三層防御、
  migrationのappend-only・fail-closed運用、並行実行対策としてのadvisory lock）
- 本計画書5.2節の設計原則（保険料率・税率のマスタ化、監査可能性）

# やってはいけないこと
- 保険料率・税率の具体的な数値をmigrationやコードにデフォルト値として埋め込まない
  （テストデータとしてサンプル値を入れるのは可だが、本番運用でそれをそのまま正しい値として
  扱わせない旨をREADME等に明記する）。
- 同一テナント・同一rate_typeについて、有効期間が重複する複数のレコードを許容しない
  （ある時点でどの料率が適用されるかが一意に定まらない状態を防ぐ）。
- 給与計算ロジックそのものをこのタスクに含めない（P3-T3で実装する）。

# 実装対象
1. 新規マイグレーションで insurance_rate_tables テーブルを作成する
   （id, tenant_id, rate_type(health_insurance/care_insurance/pension/employment_insurance),
   prefecture(nullable), rate_employee(numeric, 0〜1の割合), rate_employer(numeric, 0〜1),
   effective_from(date), effective_to(nullable date), created_by等）。
   RLS（ENABLE + FORCE）、tenant整合性トリガー（created_by）を実装する。
   同一tenant_id・rate_type・prefectureの組み合わせで有効期間が重複しないよう、
   PostgreSQLのEXCLUDE制約（btree_gist拡張 + daterangeを利用）等、DBレベルで
   重複を防止する仕組みを実装する。
2. income_tax_withholding_brackets テーブルを作成する（源泉徴収税額表の簡易実装。
   id, tenant_id, effective_from, effective_to, income_min, income_max,
   dependents_count, tax_amount等）。同様にRLS・tenant整合性・重複期間の防止を実装する。
3. rate_master.create/view/edit のpermissionをRBAC体系に追加し、Controller・Service
   両層でチェックする（owner/payroll_adminなど、P3-T1で整理した管理者ロールに付与する）。
4. マスタの登録・編集・一覧・有効な料率の取得（指定日時点で有効なレコードを返す）APIと
   フロントエンド画面を実装する。
5. README等に、初期データはサンプル値であり本番運用前に正しい最新の料率・税額表へ
   更新する必要がある旨を明記する。

# 受け入れ基準（Definition of Done）
- [ ] 保険料率・税額表を有効期間付きで登録・編集できる
- [ ] 同一tenant・rate_type（・prefecture）で有効期間が重複するレコードを登録しようとすると
      DB制約で拒否される
- [ ] 指定日時点で有効な料率を正しく取得できる（複数の期間が登録されている場合の境界値を含む）
- [ ] 他テナントの料率マスタが一切見えないことをRLSで確認
- [ ] rate_master.*のpermissionを持たないロールでは操作できないことを確認
- [ ] migrationがappend-only・fail-closedの原則（本計画書0.4節）に従っている
- [ ] Phase 0で確立した実DB E2E検証基盤で、上記すべてを実PostgreSQL上で確認し、
      結果を報告に添付する
- [ ] 完了報告に正確なコミットSHA（git rev-parse HEAD）・ブランチ名を明記する
      （本計画書0.4節ルール4に従う）
- [ ] feature/p3-t2-insurance-tax-rates ブランチにコミット・pushし、比較URLを報告に
      含める（本計画書0.4節に従う）

# ChatGPTレビュー時の確認観点
- 有効期間の重複防止がEXCLUDE制約等でDBレベルに実装されているか（アプリ層のみのチェックに
  なっていないか、P3-T1までで繰り返し指摘されたパターンの再発がないか）
- 「指定日時点で有効な料率」の取得ロジックが、effective_toがNULL（現在も有効）のケースを
  正しく扱っているか
- 5.2節の原則（ハードコード禁止）が実際に守られているか、テストデータと本番運用の
  区別が明確にドキュメント化されているか
```

---

#### 【フォローアップ指示プロンプト P3-T2-FIX】REQUEST CHANGES対応（過去マスタが通常UPDATEで書き換え可能）

ChatGPT(SO)よりP3-T2が「REQUEST CHANGES」と判定された。DB設計・RLS・RBAC・EXCLUDE制約・
tenant整合性は評価されており、修正対象は「過去データ上書き禁止」という運用原則がDB/APIで
強制されていない点に限定される。

```
# SOレビュー結果：P3-T2 REQUEST CHANGES
main...feature/p3-t2-insurance-tax-rates の実差分を確認した結果、現状はマージ不可です。
READMEでは「法改正時の追記型運用（過去データ上書き禁止）」を明文化していますが、
updateInsuranceRate() / updateTaxBracket() は既存レコードのrate_employee, rate_employer,
tax_amount, income_min/max, effective_from/toといった業務値を通常のUPDATEで変更できます。
有効期間付きの法令マスタにおいて、過去の給与計算に使用され得るマスタ値が後から変更可能だと
履歴の再現性が失われます（P3-T3の給与計算が、後から書き換えられた料率を参照してしまう
リスクにも直結します）。

# 修正方針（B案寄りを推奨）
1. 「一度登録したマスタの業務値（rate_employee, rate_employer, tax_amount,
   income_min/max, effective_from, effective_to）は、適用開始日（effective_from）が
   到来した後は変更できない」というルールをDBトリガーでfail-closedに実装する。
   具体的には、UPDATE時にOLD.effective_from <= CURRENT_DATEの場合、上記の列が
   変更されていればRAISE EXCEPTIONで拒否する。
2. effective_fromがまだ到来していない（未来適用予定の）レコードについては、
   入力ミス訂正のニーズを考慮し、引き続きUPDATEを許可してよい。
3. 法改正等で新しい料率を適用する場合は、既存レコードのeffective_toを設定した上で
   新規レコードをINSERTする運用とする（この「終了日を設定して新規追加」という
   操作フロー自体はAPIとして用意して構わない）。
4. contact情報等、業務値に該当しない列（もしあれば）の変更まで一律禁止にする必要はない。
   ただし本テーブルの列はほぼ全てが業務値であるため、実質的には
   「適用開始後はほぼ全ての編集を禁止する」という結果になる想定で構わない。

# 追加すべき実DB E2E（必須）
保険料率・税額表それぞれについて、以下を確認してください。
  1. 過去（effective_from <= 今日）のレコードに対し、rate_employee/tax_amount等の
     業務値変更を試みると拒否される
  2. 過去のレコードに対し、effective_from/effective_toの変更を試みると拒否される
  3. 拒否後もDB上の元データが完全に不変であることを確認する
  4. 未来（effective_from > 今日）のレコードは引き続き編集できることを確認する

# 軽微な修正（あわせて対応）
完了報告で「一括取込時に詳細なbefore/after情報を監査記録」としていますが、実装の
bulk auditは件数（count）のみを記録しています。実装を件数記録のままにするなら、
完了報告の表現を「一括登録件数を監査記録する」に修正してください。

# 受け入れ基準（Definition of Done）
- [ ] 適用開始日が到来した保険料率・税額表レコードの業務値・有効期間変更がDBトリガーで拒否される
- [ ] 未来適用予定のレコードは引き続き編集できる
- [ ] 法改正時の「終了日設定＋新規INSERT」という運用フローが機能する
- [ ] 完了報告の記述と実装（bulk audit）が一致している
- [ ] 既存のEXCLUDE制約・RLS・RBAC・tenant整合性のE2Eに回帰がない
- [ ] 完了報告に正確なコミットSHA・ブランチ名を明記する（本計画書0.4節ルール4に従う）
- [ ] feature/p3-t2-insurance-tax-rates ブランチに追加コミット・pushし、比較URLを
      報告に含める

# ChatGPTレビュー時の確認観点
- 「適用開始日が到来したか」の判定にCURRENT_DATEを使う際、タイムゾーンの扱いが
  一貫しているか（P3-T1の日次計算で扱ったタイムゾーンの考慮と矛盾しないか）
- 「終了日設定＋新規INSERT」の運用フローが、EXCLUDE制約と整合しているか
  （終了日設定と新規INSERTが同一トランザクションで行われないと、一時的に
  重複または空白期間が生じ得ないか）
```

---

#### 【マージ指示プロンプト P3-T2-MERGE】mainへのマージ

ChatGPT(SO)よりP3-T2-FIXが正式PASS（適用開始後のレコード変更をDBトリガーでfail-closedに禁止、JST基準の判定、法改正時のclose+新規INSERT運用を確認）と判定された。

```
# 指示
feature/p3-t2-insurance-tax-rates を main へマージしてください。
SO(ChatGPT)による正式PASS判定を得ています（023マイグレーションによる過去マスタ不変性の
DB強制、未来レコードの訂正可能性、法改正時のclose+新規INSERT運用、JST基準の適用開始判定、
API側のわかりやすいエラーメッセージ変換を確認済み、実DB E2E 139/139）。
マージ後、以下を確認し報告してください（本計画書0.4節に従い、コミットSHA・ブランチ名を
必ず明記すること）。
- main上でクリーンDBに対しverify_schema.pyを含む実DB E2Eを再実行し、全件PASSを確認する
- Backend/Frontendのテストを再実行して確認
- マージコミットハッシュ（git rev-parse HEAD）
- 作業ブランチ feature/p3-t2-insurance-tax-rates の削除（マージ済み後）
```

これでP3-T2は完了。次はP3-T3（給与計算エンジン）へ進む。

---

#### 【指示プロンプト P3-T3】給与計算エンジン

```
# 背景・目的
P3-T1（勤怠実績）とP3-T2（保険料率・税率マスタ）が揃った。本タスクでは、これらを
組み合わせて給与を計算するエンジンを実装する。5.2節の設計原則②に従い、計算結果を
直ちに確定・支給せず、「ルールエンジンによる提案 → 人間の確認 → 既存承認エンジンでの
承認 → 確定（WORM）」という、Phase 1のcontracts/ai_suggestionsで確立したパターンを
給与計算に適用する。

# 前提となる既存実装
- P3-T1: employees, attendance_records（規定内/時間外/深夜/休日労働時間、週40時間集計済み）
- P3-T2: insurance_rate_tables, income_tax_withholding_brackets（有効期間付き、
  適用済みレコードは不変）
- P0-T1: approval_requests/approval_rulesの汎用承認エンジン（target_typeポリモーフィック設計）
- P1-T1-FIX: 承認ルール未設定時のエラー、明示的0-step自動承認のみ許可するロジック
- Phase 0〜3で確立した設計パターン全般（tenant整合性トリガー、RLS、RBAC三層防御、
  migrationのappend-only・fail-closed運用、並行実行対策としてのadvisory lock）

# やってはいけないこと
- 給与計算結果を、人間の確認・承認プロセスを経ずに直接確定・支給済み扱いにしない。
  AI/ルールエンジンの計算結果はあくまで提案であり、確定はCore API（人間の確認後の
  確定操作）のみが行う。
- 給与計算に使用した保険料率・税額表のレコードを、IDで明示的に参照・記録せず、
  計算時点の値をコピーするだけにしない（後から「どの料率を根拠にこの金額になったか」を
  追跡できなくする）。両方を満たす、すなわち計算時の値をスナップショットとして保存しつつ、
  参照元のマスタレコードIDも記録する設計とする。
- 確定済み（confirmed/paid等）の給与記録の金額・計算根拠を通常のUPDATEで変更可能にしない
  （P3-T2で確立した「適用済みマスタは不変」という原則を、確定済み給与記録にも適用する）。

# 実装対象
1. 新規マイグレーションで payroll_periods テーブル（給与計算対象期間、tenant_id,
   period_start, period_end, status）を作成する。
2. payroll_calculations テーブル（給与計算結果、tenant_id, payroll_period_id, employee_id,
   base_salary, regular_pay, overtime_pay, deductions（health/care/pension/employment
   各保険料、所得税、住民税）, net_pay, applied_rate_ids（参照した料率マスタのID群、
   JSON配列またはリレーションテーブル）, status(draft/pending_approval/active/rejected),
   created_by, approved_at等）を作成する。RLS、tenant整合性トリガー（employee_id,
   attendance参照, rate参照）、状態遷移トリガー、active後の金額・計算根拠の改変禁止
   （P3-T2で確立したfail-closedパターンを踏襲）を実装する。同一tenant・employee・
   期間の重複計算を防ぐUNIQUE制約を設ける。
3. 給与計算ロジック（ルールエンジン）を実装する。対象期間のattendance_recordsを集計し、
   employees.base_salary（本タスクで従業員給与情報の保持方法を確定する。P3-T2と同様に
   有効期間付きで従業員報酬の履歴を管理する設計を推奨するが、スコープが大きくなる場合は
   最小限の実装とし、DEBTとして記録して構わない）、insurance_rate_tables、
   income_tax_withholding_bracketsを参照して控除額を算出する。
4. 承認フローは既存のapproval_requests（target_type='payroll'）を再利用する。
   P1-T1-FIXで確立した「承認ルール未設定→エラー」「明示的0-step→即active」を
   そのまま適用する。承認完了時にpayroll_calculations.statusをactiveにする。
5. payroll.create/view/approve のpermissionをRBAC体系に追加し、Controller・Service
   両層でチェックする。特にemployee自身が自分の給与計算を確定できてしまわないよう
   （給与計算の実行権限は経理・給与担当者に限定する）注意する。
6. 給与計算実行・確認画面・確定操作のAPIとフロントエンド画面を実装する。

# 受け入れ基準（Definition of Done）
- [ ] 対象期間の勤怠実績・料率マスタから給与計算の提案が生成される
- [ ] 計算結果には適用した料率マスタのIDが記録され、後から計算根拠を追跡できる
- [ ] 給与計算結果は人間の確認・承認（既存承認エンジン）を経てからactiveになる
- [ ] 承認ルール未設定のテナントで承認申請するとエラーになり、自動activeにならない
- [ ] active後の金額・計算根拠がDBトリガーで変更不可になる
- [ ] 同一employee・同一期間の重複計算がDB制約で防止される
- [ ] employee自身が自分（または他人）の給与計算を実行・確定できないことを確認する
- [ ] 他テナントの給与計算データが一切見えないことをRLSで確認
- [ ] Phase 0〜2で繰り返し指摘された問題（暗黙自動承認、tenant整合性のアプリ層依存、
      RBAC未強制、同時実行race condition、migration事後書き換え、実質何も検証しない
      テスト）のいずれも再発していないことを確認する
- [ ] 完了報告に正確なコミットSHA・ブランチ名を明記する（本計画書0.4節ルール4に従う）
- [ ] feature/p3-t3-payroll-engine ブランチにコミット・pushし、比較URLを報告に含める
      （本計画書0.4節に従う）

# ChatGPTレビュー時の確認観点
- 給与計算の確定境界（AI提案→人間承認→確定）が、Phase 1のcontracts/ai_suggestionsと
  同じ厳格さで守られているか
- applied_rate_idsが実際に正しい料率マスタレコードを指しているか、tenant境界を
  越えて他テナントの料率を参照してしまっていないか
- 従業員報酬情報（base_salary等）の履歴管理方針が、P3-T2の不変性原則と矛盾しないか
  （矛盾する場合はDEBTとして明記されているか）
```

---

#### 【フォローアップ指示プロンプト P3-T3-FIX】REQUEST CHANGES対応（確定境界がDB最終防御になっていない）

ChatGPT(SO)よりP3-T3が「REQUEST CHANGES」と判定された。計算エンジン・料率マスタ参照・
tenant整合性・RBAC・active後WORMは高く評価されており、修正対象は「確定境界（誰が
activeにできるか）」がDB最終防御になっていない1点に限定される。

```
# SOレビュー結果：P3-T3 REQUEST CHANGES
main...feature/p3-t3-payroll-engine の実差分（コミット6651915）を確認した結果、
現状はマージ不可です。

# BLOCKER: draft/rejected/pending_approval → active の直接UPDATEをDBが防いでいない
現在のWORMトリガーは「OLD.status = 'active'のレコードへのUPDATE/DELETE」のみを拒否します。
しかし「statusをactiveに変更する操作そのもの」は、正規の承認エンジン
（ApprovalRequestsService.finalizeApproval()）経由でも、DB直接操作でも、区別なく
成功してしまいます。これは「防御①: 確定前（誰がactiveにできるか）」が欠けている状態で、
「防御②: 確定後（activeを変更できない）」しか実装されていません。
本プロジェクトの設計原則である「ルール計算 → draft → 人間確認 → 既存承認エンジン →
active」という確定境界を、DB最終防御として成立させる必要があります。

# 修正方針（A案を推奨）
このプロジェクトで既に確立している「SET LOCAL app.current_tenant_id」という
セッションローカル変数によるコンテキスト伝達パターンを応用します。
1. ApprovalRequestsService.finalizeApproval()内で、payroll_calculationsのstatusを
   activeへ更新する直前に、同一トランザクション内で
   SET LOCAL app.approval_context = 'true'; を実行する。
2. payroll_calculationsのUPDATEトリガーに、NEW.status = 'active' AND
   OLD.status IN ('draft', 'pending_approval', 'rejected') という遷移が発生する場合、
   current_setting('app.approval_context', true) = 'true' でなければ
   RAISE EXCEPTIONで拒否するロジックを追加する。
3. これにより、正規の承認エンジンを経由しないUPDATE（アプリの別コード、DB直接操作を含む）
   では、draft等からactiveへの遷移が一切成立しなくなる。

# 代替方針（B案、A案が困難な場合）
statusを直接UPDATEできる権限をapp_runtimeから制限し、専用のSECURITY DEFINER関数
（承認エンジンのみが呼び出す）経由でのみactiveへの遷移を許可する設計でも構いません。
どちらの方針を採用したか、理由とともに報告に明記してください。

# 追加すべき実DB E2E（必須、SOが指定した5+2ケース）
1. draft → active への直接UPDATE試行 → 拒否され、statusはdraftのまま
2. rejected → active への直接UPDATE試行 → 拒否
3. pending_approval → active への直接UPDATE試行 → 拒否
4. 正規の多段階承認エンジンを通した確定 → active成功
5. 明示的0-step自動承認を通した確定 → active成功
6. active後の通常UPDATE試行 → 拒否（既存確認分の維持）
7. active後のDELETE試行 → 拒否（既存確認分の維持）

# 受け入れ基準（Definition of Done）
- [ ] 正規の承認エンジンを経由しないUPDATEでは、draft/rejected/pending_approvalから
      activeへの遷移が一切成立しない
- [ ] 正規の承認エンジン（多段階承認・明示的0-step自動承認の両方）経由では、
      従来通りactiveへの遷移が成立する
- [ ] 上記7ケースすべてを実DB E2Eで確認する
- [ ] 既存のtenant整合性・RBAC・計算根拠追跡（applied_rate_ids）・給与プロファイル
      重複防止等に回帰がない
- [ ] 完了報告に正確なコミットSHA・ブランチ名を明記する（本計画書0.4節ルール4に従う）
- [ ] feature/p3-t3-payroll-engine ブランチに追加コミット・pushし、比較URLを報告に
      含める

# 重要な注記（今回のレビューコメントより）
今回実装された給与計算ロジック（基礎時給=base_salary/160、時間外1.25倍、深夜0.25倍、
休日1.35倍等）は、実際の日本の給与計算制度を完全に再現したものではなく、本計画書が
定義した簡略モデルとして扱ってください。「法令準拠済み」と断定せず、5.2節の原則③
（専門家レビューの推奨）を維持したまま進めてください。

# ChatGPTレビュー時の確認観点
- app.approval_context（またはB案の代替機構）が、他のトランザクションへ意図せず
  漏れ伝播しないか（トランザクションスコープのSET LOCALであることを確認）
- 明示的0-step自動承認の経路でも、同じapproval_contextの設定を通ってからactiveに
  なっているか（承認エンジンの2つの経路（多段階/0-step）で確定境界の実装に
  抜け漏れがないか）
```

---

#### 【フォローアップ指示プロンプト P3-T3-FIX2】REQUEST CHANGES対応（approval_contextフラグがapp_runtime自身で偽装可能）

ChatGPT(SO)よりP3-T3-FIXが「REQUEST CHANGES」と判定された。draft/pending_approval/
rejectedからの直接UPDATE拒否・active後WORM・自己承認防止・tenant整合性は評価されているが、
確定境界そのものの防御方式に本質的な弱点があるため、方式そのものを変更する。

```
# SOレビュー結果：P3-T3-FIX REQUEST CHANGES
main...feature/p3-t3-payroll-engine の実差分を確認した結果、現状はマージ不可です。
前回追加したapp.approval_contextによる確定境界は、「承認エンジンを経由したか」ではなく
「誰かがapp.approval_context='true'をSET LOCALしたか」しか検証していません。
app_runtimeロールでSQLを実行できる主体（アプリの別コード、DB直接操作）なら誰でも
SET LOCAL app.approval_context = 'true'; を自分で実行してからUPDATEできるため、
承認エンジンの迂回を防げていません。さらに同一トランザクション内で一度trueにすると、
別の給与計算レコードのactive化までスコープ外で許可されてしまう粗さもあります。

# 修正方針（B案を採用: 承認リクエストの実在をDBで直接検証する）
セッション変数による「自己申告フラグ」方式をやめ、payroll_calculationsをactiveへ
更新する際、DBトリガー内で「対応するapproval_requestsが実際に承認完了状態で
存在するか」を直接検証する方式に変更してください。

具体的には、payroll_calculationsのUPDATEトリガーで、NEW.status='active' かつ
OLD.status IN ('draft','pending_approval','rejected') の場合、以下を検証する。
  EXISTS (
    SELECT 1 FROM approval_requests
    WHERE target_type = 'payroll'
      AND target_id = NEW.id
      AND tenant_id = NEW.tenant_id
      AND status = '<既存のapproval_requestsで使われている承認完了ステータス
                     （approved等、既存のcontract/general_request実装で使われている
                     値と同じものを使用すること）>'
  )
条件を満たさない場合はRAISE EXCEPTIONで拒否する。

このアプローチが優れている理由は、approval_requestsという既存の中核テーブル自体が
既に自己承認防止（fn_prevent_self_approval）・RBAC・tenant整合性等の強固な不変条件を
持つ「正規の承認処理の記録」であるため、そこに実際の承認完了レコードが存在すること自体を
確定の必要条件にできる点です。session変数のような「誰でも設定できる自己申告」に
依存しなくなります。

app.approval_contextによるSET LOCAL方式は完全に撤去してください。

# 修正不要（今回は撤去のみ）
- 前回追加したdraft/pending_approval/rejected → activeの直接UPDATE拒否のトリガー自体は
  残しつつ、その中の判定条件を「approval_context」から「approval_requestsの実在確認」に
  差し替える形にしてください。

# 追加すべき実DB E2E（必須）
1. 対応するapproval_requestsが存在しない状態でstatus='active'への直接UPDATEを試みる
   → 拒否
2. 「偽装」ケース: 承認サービスを一切呼ばず、approval_requestsへ直接
   status='approved'相当の行をINSERTしてからpayroll_calculationsをactiveにしようとする
   → この操作自体がapproval_requests側の既存の不変条件（RBAC、tenant整合性、
   自己承認防止等）によってどこまで防がれるか、または防がれない場合はその境界を
   報告に明記する（DB直接操作を行う主体を完全に信頼しない前提での限界は許容するが、
   少なくともapp_runtime経由の正規APIからはこの偽装ができないことを示す）
3. 正規の多段階承認・明示的0-step自動承認、それぞれで従来通りactiveへの遷移が成功する
4. 前回のケース（active後UPDATE/DELETE拒否等）に回帰がない

# 受け入れ基準（Definition of Done）
- [ ] app.approval_contextによるSET LOCAL方式が完全に撤去されている
- [ ] approval_requestsの実在確認による確定境界がDBトリガーに実装されている
- [ ] 対応するapproval_requestsが存在しない状態でのactive化がDBで拒否される
- [ ] 正規の承認エンジン（多段階・0-step）経由では従来通りactiveへの遷移が成功する
- [ ] 既存のtenant整合性・RBAC・計算根拠追跡・active後WORMに回帰がない
- [ ] 完了報告に正確なコミットSHA・ブランチ名を明記する（本計画書0.4節ルール4に従う）
- [ ] feature/p3-t3-payroll-engine ブランチに追加コミット・pushし、比較URLを報告に
      含める

# ChatGPTレビュー時の確認観点
- approval_requestsの「承認完了」を示すstatus値が、既存のcontracts/general_requestsの
  実装と一貫した値になっているか
- target_id/tenant_idの一致確認が、他テナントのapproval_requestsを参照させる経路を
  作っていないか
```

---

#### 【フォローアップ指示プロンプト P3-T3-FIX3】REQUEST CHANGES対応（approval_requests自体への偽造INSERTで確定境界を突破できる）

ChatGPT(SO)よりP3-T3-FIX2が「REQUEST CHANGES」と判定された。今回の指摘は
**payroll固有の問題ではなく、P0-T1で構築した承認エンジン（approval_requests）そのものの
書き込みモデルに関わる問題**である。したがって修正はpayroll側だけでなく
approval_requestsテーブル自体に対して行う。

```
# SOレビュー結果：P3-T3-FIX2 REQUEST CHANGES
main...feature/p3-t3-payroll-engine の実差分（コミットfb41d47）を確認した結果、
現状はマージ不可です。今回の給与側トリガーは「対応するapproval_requestsのapprovedレコードが
存在するか」を検証していますが、そのapproval_requests自体に、承認エンジンの正規フロー
（submit → assign → approve）を一切経由せず、
  INSERT INTO approval_requests (tenant_id, target_type, target_id, submitted_by,
    total_steps, current_step, status) VALUES (..., 1, 1, 'approved');
のような単発INSERTでstatus='approved'の行を最初から作ることを妨げる仕組みが
DBに存在しません。これは「承認済みという事実」ではなく「approvedという値が入った行の
存在」を信頼している状態であり、今回の給与トリガーの防御をすり抜けられます。

# 修正方針（approval_requests自体への恒久的な強化。全domain（contract/general_request/
purchase_request/payroll）に効果がある）
1. approval_requestsに、BEFORE INSERTトリガーを追加し、新規INSERT時のstatusが
   常に「未承認の初期状態」（例: 'pending_approval'、または既存の実装で使われている
   初期状態の値）でなければRAISE EXCEPTIONで拒否するようにする。
   これにより、status='approved'のレコードをいきなりINSERTで作ることが不可能になる。
2. 明示的0-step自動承認（is_explicit_auto_approve=trueのルール）についても、
   「INSERTの時点でstatus='approved'」ではなく、「INSERTでは初期状態を作り、
   直後に既存のUPDATE経路（fn_prevent_self_approval等の検証を経る）でapprovedへ
   遷移させる」という、通常の承認と同じ2段階の経路に統一する
   （既存のP1-T1-FIXで確立した0-step自動承認のロジックを、この新しい制約に
   適合するよう調整する）。
3. pending_approval → approved のUPDATE遷移についても、既存のfn_prevent_self_approval
   に加えて、承認者として正当に割り当てられているか（approver_user_id /
   approver_role_id経由）をDBトリガーでも検証できるか確認する。もしこの検証が
   現状Service層（assertAssignedApprover()）のみで行われている場合、その旨を
   DEBTとして明記し、今回のタスクの必須修正範囲には含めない
   （承認者割当のDB検証は、承認エンジン全体の改修が必要になり得るため、
   payroll確定境界というスコープを超える可能性がある）。

# 追加すべき実DB E2E（必須、SOが指摘した攻撃シナリオそのもの）
1. 承認エンジンを一切呼ばず、approval_requestsへ直接
   status='approved'のレコードを新規INSERTしようとする → DBで拒否される
   （同一テナント・正しいtarget_id・正しいtarget_typeを使った、今回のSOの指摘通りの
   偽造シナリオを再現すること）
2. 上記が拒否された結果、対応するpayroll_calculationsもactiveにならないことを確認する
3. 正規の多段階承認・明示的0-step自動承認、それぞれで従来通りapproved/active化が成功する
4. 前回までに解消済みのケース（app.approval_context撤去後の直接UPDATE拒否等）に回帰がない

# 受け入れ基準（Definition of Done）
- [ ] approval_requestsへのINSERT時、status='approved'を直接指定することがDBトリガーで
      拒否される
- [ ] 0-step自動承認が、INSERT→UPDATE遷移の2段階経路に統一されている
- [ ] 偽造INSERTシナリオ（SOが提示した攻撃例そのもの）が実DB E2Eで拒否されることを確認する
- [ ] 正規の承認フロー（多段階・0-step）に回帰がない
- [ ] 承認者割当のDB検証が未実装の場合はDEBTとして明記する（今回の必須修正範囲外）
- [ ] 完了報告に正確なコミットSHA・ブランチ名を明記する（本計画書0.4節ルール4に従う）
- [ ] feature/p3-t3-payroll-engine ブランチに追加コミット・pushし、比較URLを報告に
      含める

# 重要な注記
今回の修正はapproval_requestsテーブル自体への変更のため、contracts/general_requests/
purchase_requestsの既存承認フローすべてに影響します。修正後は、これら既存ドメインの
承認関連E2E（P1-T1、P1-T3、P1-T5、P2-T1等で追加したもの）にも回帰がないことを
必ず確認してください。

# ChatGPTレビュー時の確認観点
- 今回の修正が、contracts/general_requests/purchase_requestsの既存承認フローの
  回帰テストで確認されているか（payroll側のE2Eだけで完結していないか）
- 「INSERT時は必ずpending_approval」という制約が、既存の実装のどこかで
  status='approved'を直接INSERTしている箇所（もしあれば）を見落としていないか
```

---

#### 【フォローアップ指示プロンプト P3-T3-FIX4】REQUEST CHANGES対応（pending→approvedの直接UPDATEがDB最終防御になっていない）

ChatGPT(SO)よりP3-T3-FIX3が「REQUEST CHANGES」と判定された。approved単発INSERTの偽造は
解消されたが、次の防御層（pending→approvedへの直接UPDATE）が未実装のため、依然として
承認エンジンを経由しない確定が可能。今回の修正で、単なる状態フラグの検証ではなく
「承認が正当に行われたことの根拠」自体をDBが検証する設計に到達させる。

```
# SOレビュー結果：P3-T3-FIX3 REQUEST CHANGES
main...feature/p3-t3-payroll-engine の実差分（コミットb2beb30）を確認した結果、
現状はマージ不可です。approval_requestsへの「approved単発INSERT」はDBで拒否できるように
なりましたが、「pending でINSERT → 直接UPDATE status='approved'」という2段階の偽造は
依然として可能です。これは、statusという単なる値の遷移だけを見ている限り、
本質的に解決できない問題です（値そのものは誰でも書き換えられるため）。

# 根本的な修正方針
「statusがapprovedになっているか」ではなく、「その承認が正当な根拠（実際に承認権限を
持つユーザーによる、正しいステップの承認アクション）に基づいているか」をDBが直接
検証する設計に変更してください。具体的には、fn_prevent_self_approval()と同様の
考え方で、以下をBEFORE UPDATEトリガー（pending → approvedへの遷移時）に追加する。

1. **ステップ完了の検証**: NEW.current_step >= NEW.total_steps であること
   （承認ステップが最後まで進んでいない状態でapprovedにできないようにする）。
2. **承認履歴の実在確認**: 最終ステップに対応するapproval_historyのレコードが
   実際に存在すること。このapproval_historyレコードのapprover_user_idについて、
   以下をDBトリガー内のSQLで直接検証する（Service層のassertAssignedApprover()に
   相当するロジックをDBトリガーへ移植する）。
   - user_roles / role_permissions をJOINし、approver_user_idが対象target_typeの
     承認権限（例: payroll.approve）を実際に保持していること
   - approver_user_id が approval_requests.submitted_by と異なること
     （既存のfn_prevent_self_approval()のロジックと重複してもよいので、
     この経路でも確実に検証されるようにする）
3. **approval_historyへのINSERT自体の保護**: 上記2の検証が機能するためには、
   approval_history側にも「実際に権限を持つユーザーの行動としてしか承認履歴を
   作れない」という保証が必要です。approval_historyへのINSERT時にも、
   approver_user_idの権限保有をDBトリガーで検証するようにしてください
   （まだ実装されていない場合は追加する）。

この設計により、攻撃者が「pending → approved」を直接UPDATEしようとしても、
対応する正当な承認履歴（実際に権限を持つユーザーによる、自己承認でない承認アクション）が
存在しない限り、DBトリガーが拒否します。単なる状態フラグの偽装では突破できなくなります。

# 追加すべき実DB E2E（必須、SOが今回指摘した攻撃シナリオ）
1. approval_requestsをpendingでINSERT → 対応するapproval_historyを一切作らずに
   直接status='approved'へUPDATE → DBで拒否される
2. 正当な承認権限を持たないユーザーのapprover_user_idでapproval_historyを
   偽造INSERTしてから、approval_requestsをapprovedへUPDATE → DBで拒否される
   （実装した場合）
3. 正規の多段階承認・明示的0-step自動承認、それぞれで従来通りapproved/active化が成功する
4. 前回までに解消済みのケース（approved単発INSERT拒否等）に回帰がない
5. 既存のcontracts/general_requests/purchase_requestsの承認フローE2Eに回帰がない

# 受け入れ基準（Definition of Done）
- [ ] pending→approvedへの直接UPDATEが、正当な承認履歴の裏付けなしには成功しないことを
      実DB E2Eで確認する
- [ ] 正規の承認フロー（多段階・0-step）に回帰がない
- [ ] 既存4ドメイン（contract/general_request/purchase_request/payroll）の承認E2Eに
      回帰がない
- [ ] 完了報告に正確なコミットSHA・ブランチ名を明記する（本計画書0.4節ルール4に従う）
- [ ] feature/p3-t3-payroll-engine ブランチに追加コミット・pushし、比較URLを報告に
      含める

# 重要な注記（スコープについて）
今回の修正は承認エンジン全体（approval_requests / approval_history）の中核ロジックに
及ぶため、実装が想定より大規模になる場合は、遠慮なくその旨を報告してください。
その場合、Claudeが計画書側でこのタスクを独立したサブタスクとして切り出す判断を
行います。

# ChatGPTレビュー時の確認観点
- 承認履歴の実在確認ロジックが、既存のfn_prevent_self_approval()と重複しつつも
  矛盾しない形で共存しているか
- 「権限保有の検証」がuser_roles/role_permissionsという実データに基づいており、
  session変数のような自己申告要素に依存していないか
```

---

## 6. 既知の技術的負債・フォローアップ事項

タスク完了時にSOが「修正不要だが記録すべき」と判定した事項を追跡する。将来の関連タスク着手時に必ず参照すること。

| ID | 発見タスク | 内容 | 重要度 | 対応予定 | ステータス |
|----|-----------|------|--------|----------|-----------|
| DEBT-001 | P0-T2 | `AttachmentsService.upload()` がファイル実体をディスクへ書き込んだ後にDB transactionを実行しており、DB rollback時に孤児ファイルが残り得る（原子性がない）。MVP・ローカルディスク保存の間は許容するが、S3等のオブジェクトストレージへ移行する際は、DB transaction・object storage・補償処理(transactional outbox等)を含めた整合性設計を正式に行う。 | MEDIUM | Phase 5（統合最適化）またはストレージ本格化タイミングで再評価 | 🔴 未対応 |
| DEBT-002 | P0-T3 | `suggested_fields.*.confidence` および `confidenceScore` に0〜1の範囲制約がTypeScript型・Zod入力・JSONB内部のいずれでも実行時に保証されていない。DB制約はJSONB内部までは及ばないため、異常値（例: 1.5, -0.3）が保存され得る。共通スキーマに`z.number().min(0).max(1)`等のruntime validationを追加する必要がある。 | MEDIUM | AIゲートウェイ正式化（複数プロバイダ対応）タイミングで対応 | 🔴 未対応 |
| DEBT-003 | P0-T3 | 契約書条項抽出（`extractContractTerms()`）は現状ルールエンジン（正規表現ベース）だが、`generateContractSuggestion()`の`model_name`デフォルト値が`claude-3-5-sonnet-20241022`になっており、実際にはLLMを呼んでいないのに監査データ上はClaudeが生成したように見える。`provider='rule_engine'`, `model_name='contract-extractor-v1'`等、実態に即した値に修正し、将来的にはAI Provider/Gateway抽象化（Claude/Gemini/OpenAI/Rule Engineを共通payloadで扱う設計）を正式化する。 | MEDIUM（会計SaaSとして監査追跡性に影響） | Phase 1でAI条項抽出を本格実装するタイミングで対応必須（それまでの暫定値として認識しておく） | ✅ 解消（P1-T2-FIX、model_name='contract-extractor-v1'・provider='rule_engine'として実装済み） |
| DEBT-004 | P0-T4 | 開発・レビュー環境に`psql`クライアントが存在せず、`npm run db:migrate` / `verify_schema.py`のDB接続を伴う実行（実DB E2E検証）が未実施のまま。SQLの静的な安全性（migration runnerの実行順序等）は確認済みだが、実DBに対する動作確認ができていない。CI環境またはローカル開発環境に`psql`（またはコンテナ経由のPostgreSQLクライアント）を整備し、今後のmigrationタスクで実DB E2E確認を標準化する。 | MEDIUM（開発環境整備） | Phase 1のP1-T1（contractsテーブル実装、実DB検証が必須）着手前に対応推奨 | ✅ 解消（P0-T5、実DB E2E 34/34 PASS確認済み） |
| DEBT-005 | P1-T1 | ContractsControllerのCRUD/承認申請APIが`TenantAuthGuard`は通しているが、P0-T4で整備した`contract.create/view/edit/approve/terminate`のpermission（RBAC）を明示的にチェックしていない（既存vendor-bills等と同じパターンを踏襲した結果）。`legal_viewer`が閲覧専用のはずが、現状のAPI実装だけでは書き込み系エンドポイントを呼べてしまう可能性がある。 | MEDIUM〜HIGH（権限外操作の防止に直結） | **P1-T3（契約承認ワークフロー統合）着手時に対応必須** | ✅ 解消（P1-T3、PermissionsGuard導入・Service層でも二重確認済み） |
| DEBT-006 | P1-T1-FIX | `is_explicit_auto_approve=true`の0-stepルールと、1ステップ以上の通常承認ルールが同一ルールセット内に混在していても、現状のロジックは自動承認ルールを優先して選択してしまう（この組み合わせ自体を防ぐ制約がない）。承認ルール管理API/UIを実装する際に、「0-step自動承認ルールは他のstepと同一ルールセットに共存させない」という制約を追加する必要がある。 | LOW〜MEDIUM | 承認ルール管理API/UIの実装タイミング（Phase 1後半、または P1-T3の一部として） | ✅ 解消（P1-T3-FIX、pg_advisory_xact_lockによる並行実行耐性を実DBで確認済み） |
| DEBT-007 | P1-T2 | 現在のPDFテキスト抽出は、テキストが埋め込まれたPDFのみに対応しており、スキャン画像PDF・画像のみのPDFは本文抽出不能として400エラーを返す（フォールバックでダミー処理はしない、安全側の設計）。ただし実際の契約書運用ではスキャンPDFが一定割合存在するため、将来的にはOCR経路（文字なしPDF→OCR→抽出）を追加する必要がある。 | LOW（現状はfail-closedで安全、機能制約のみ） | 契約書アップロード運用の実績を見て、スキャンPDF比率が無視できない場合に対応 | 🔴 未対応（意図的な機能制約として現状維持） |
| DEBT-008 | P1-T3 | `PermissionsGuard`がDBの`role_permissions`テーブルを直接参照せず、静的マップ（ROLE_PERMISSIONS）を独自に保持しており、DB側のRBAC定義とAPI側の権限マップが二重管理になっている。将来DBで新しいroleやpermissionを追加・変更した際に、Guard側の静的マップを更新し忘れる「RBACドリフト」のリスクがある。 | LOW〜MEDIUM（将来の変更時に権限不整合を生むリスク） | RBAC管理API/UIを作る際、またはロール定義の変更頻度が増えたタイミングでDB参照方式へ統一を検討 | 🔴 未対応 |
| DEBT-009 | P1-T4 | notificationsテーブルにuser_id/recipient_idが存在せず、契約期限通知は「テナント内の全ユーザーが共有する通知」として実装されている（個人宛ではない）。そのため、あるユーザーが既読にすると同じテナントの他ユーザーからも既読として見える。MVPとしてテナント共通通知に割り切るのは許容範囲だが、将来「契約担当者・承認者・経理・法務」等への個別通知が必要になった場合は、recipient_user_id列の追加とAPIの見直しが必要。 | LOW（MVPとしては仕様として許容） | 個人宛通知の必要性が具体化したタイミングで対応（Phase 1後半〜Phase 2以降） | 🔴 未対応（仕様として現状維持） |
| DEBT-010 | P1-T5 | `general_requests`のPUT/DELETEが`general_request.edit`権限のみで判定されており、`created_by`（起票者本人）かどうかを確認していない。そのため同一テナント内のemployee同士が互いの下書き稟議を編集・削除できてしまう。「テナント内で共同編集可能」なのか「起票者本人のみ編集可能」なのかの仕様が明文化されていない。 | LOW〜MEDIUM（仕様次第でセキュリティ上の意味合いが変わる） | 稟議機能の実運用が始まる前、または利用者からのフィードバックがあったタイミングで仕様を正式決定 | 🔴 未対応（仕様確認待ち） |
| DEBT-011 | P1-T6 | 契約書全文検索のembeddingは、外部embedding APIを呼ばず文字n-gramのハッシュによる疑似embedding（`pseudo-char-ngram-hash-v1`）で生成されている。MVPとしては許容範囲（model_nameも実態を正しく表しており、DEBT-003のような虚偽表示問題は回避できている）が、実運用での検索精度は限定的。将来的には実際のembeddingモデル（OpenAI/Anthropic/オープンソース等）への切り替えを検討する必要がある。 | LOW（検索精度の課題、セキュリティ上の問題ではない） | 契約書全文検索の実運用フィードバックを見て、精度不足が問題になった場合に対応 | 🔴 未対応（意図的なMVP実装として現状維持） |
| DEBT-012 | P1-T6-FIX | 契約書全文検索の対象は`status='active'`のみに限定されており、`terminated`（解約済み）・`expired`（満了）の過去契約は検索対象に含まれない。「過去契約も参照したい」という業務ニーズが将来生じた場合、`include_inactive`のような明示的なオプションを別タスクとして設計する必要がある。 | LOW（意図的な保守的設計、機能制約） | 過去契約検索の必要性が具体化したタイミングで別タスクとして対応 | 🔴 未対応（意図的な機能制約として現状維持） |
| DEBT-013 | P2-T1 | `purchase_requests.request_no`の採番が「現存レコード数（COUNT）+1」方式になっており、advisory lockにより同時実行時の重複は防げるものの、厳密な連番カウンタではない。draftレコードが物理削除可能な設計と組み合わさると、削除されたレコードの番号が将来別の申請で再利用され得る。監査要件が厳格化した場合は、専用sequence/counterテーブル方式への変更を検討する。 | LOW（現仕様の範囲では実害なし） | 監査要件強化、またはrequest_noの一意性・不再利用が業務上必須になったタイミングで対応 | 🔴 未対応 |
| DEBT-014 | P2-T3 | `purchase_requests`がactiveから`terminated`へ遷移した後も、`vendor_bills.purchase_request_id`によるリンクが自動解除されずに残る。発注取消後も請求書との紐付けが残存し得るため、発注終了・取消と請求書のライフサイクルの関係を厳密に扱う必要が生じた場合は、リンク解除ロジックまたは`terminated`への遷移自体の制限（未精算の紐付けがある場合の遷移拒否等）を別途検討する。 | LOW〜MEDIUM（今回のDoD範囲外、将来の業務要件次第） | 発注取消と請求書処理の関係が業務上重要になったタイミングで別タスクとして対応 | 🔴 未対応 |
| DEBT-015 | P2-T4 | 購買ダッシュボードの今期集計は`fiscal_years`テーブルの年度設定に追従する設計だが、実DB E2Eでは単純な暦年（2026-01-01〜2026-12-31）のケースしか検証されていない。非暦年の会計年度（例: 4月始まり）や年度またぎのケースでの動作は未確認。 | LOW（現状の実装ロジック自体は妥当と評価されている） | 非暦年の会計年度を持つテナントでの利用実績が出たタイミングで追加検証 | 🔴 未対応 |
| DEBT-016 | P3-T1 | 勤怠登録時に`break_minutes`（休憩時間）が実際の拘束時間（clock_out - clock_in）を超えないことのバリデーションがAPI/DBいずれにもない。例えば1時間の勤務に対して2時間の休憩を登録できてしまう（計算結果は0時間になるため実害は限定的だが、データとしては不整合）。 | LOW（計算結果への実害は限定的） | 勤怠データの品質チェック機能を追加するタイミングで対応 | 🔴 未対応 |
| DEBT-017 | P3-T1 | 新規clock-in（新規勤怠レコード作成）では監査ログが記録されるが、既存の未退勤レコードへのclock-in更新では監査ログが記録されない分岐がある。勤怠は労務監査の対象になり得るため、将来的にはすべての変更経路で一貫して監査ログを記録するよう統一する必要がある。 | LOW〜MEDIUM（労務監査の観点で改善余地） | 監査ログの網羅性を見直すタイミングで対応 | 🔴 未対応 |

---

## 7. 次のアクション

1. 【P3-T1】のプロンプトをGeminiに渡し、Phase 3（人事労務）を開始する。
2. P3-T1完了後、実際のテーブル定義・API形状を踏まえてP3-T2以降のタスク分解・実装指示
   プロンプトをClaudeが作成する（Phase 0/1/2と同じ方針）。
3. P3-T2（保険料率・税率マスタ）着手前に、5.2節の設計原則（マスタ化・AI提案パターン・
   専門家レビューの推奨）を再確認する。
4. 未解決DEBT（6節）は都度解消の方針。

---

## 8. 変更履歴

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
| 3.0.0 | P1-T4がSO判定REQUEST CHANGES（全テナント横断バッチAPIに認可がなく、ログイン済みなら誰でも実行可能。他テナント情報がエラーレスポンスに露出）。フォローアップ指示プロンプト（P1-T4-FIX、notification.batch_execute権限の新設）を追加。DEBT-009（通知が個人宛でなくテナント共有）を記録 |
| 3.1.0 | P1-T4-FIXが正式APPROVE（notification.batch_executeをowner限定に設定、cross-tenant情報のレスポンス秘匿を確認、実DB E2E 73/73）。マージ指示プロンプト（P1-T4-MERGE）を追加しP1-T4を完了扱いに更新。**P1-T5（稟議申請：汎用ワークフロー起票UI）の実装指示プロンプトを新規作成**。過去に繰り返し指摘された問題（暗黙自動承認・tenant整合性のアプリ層依存・RBAC未強制）を新ドメインで再発させないことをレビュー観点として明記 |
| 3.2.0 | P1-T5がSO判定REQUEST CHANGES（general_requests.amountに非負DB制約が欠落。category制約も推奨事項として指摘）。フォローアップ指示プロンプト（P1-T5-FIX）を追加。DEBT-010（起票者本人以外もdraft稟議を編集・削除できる、仕様未確定）を記録 |
| 3.3.0 | P1-T5-FIXがSO判定REQUEST CHANGES（重大: 既存migration 014を事後的に書き換えたため、適用済みDBには制約が反映されない）。フォローアップ指示プロンプト（P1-T5-FIX2、新規migration 015への切替＋既存DB段階的アップグレードのE2E追加）を追加。**0.4節にmigration不変（append-only）の原則を新設** |
| 3.4.0 | P1-T5-FIX2がSO判定REQUEST CHANGES（migration append-only原則は解消済みだが、015が既存データを無断でUPDATE/自動クレンジングしていた）。フォローアップ指示プロンプト（P1-T5-FIX3、fail-closedなDO $$ EXCEPTIONブロックへの置き換え）を追加。**0.4節に「制約追加migrationは既存データを自動改変せずfail-closedで停止する」原則を新設** |
| 3.5.0 | P1-T5-FIX3がSO判定REQUEST CHANGES（設計自体は承認、ただし報告内容とGitHub実コミットが不一致。push漏れ）。フォローアップ指示プロンプト（P1-T5-FIX3-VERIFY）を追加し、push状態の確認・是正を指示（0.4節の既存ルールの再徹底） |
| 3.6.0 | P1-T5-FIX3が正式PASS（GitHub実体とも一致、既存データ自動改変の完全撤廃、fail-closed migrationを85/85で確認）。マージ指示プロンプト（P1-T5-MERGE）を追加しP1-T5を完了扱いに更新。**P1-T6（契約書全文検索：pgvector活用）の実装指示プロンプトを新規作成**。これでPhase 1の全6タスクの指示プロンプトが出揃った |
| 3.7.0 | P1-T6がSO判定REQUEST CHANGES（DB/RLS/tenant整合性/RBACは良好だが、検索対象がdraft/pending/rejectedの契約まで含んでしまい「確定済み契約のみ検索」という仕様境界に違反）。フォローアップ指示プロンプト（P1-T6-FIX、検索対象ステータスの明示的な絞り込み）を追加。DEBT-011（疑似embeddingの精度限界、MVPとして意図的に許容）を記録 |
| 4.0.0 | P1-T6-FIXが正式PASS（検索対象をactiveのみのallowlistに限定、自然文検索・ID類似検索の両方に適用、実DB E2E 97/97）。DEBT-012（terminated/expired契約が検索対象外）を記録。マージ指示プロンプト（P1-T6-MERGE）とPhase 1クローズのサマリ（往復回数、確立された恒久ルール、DEBT棚卸し）を追加。**Phase 1（総務・法務）が全6タスク完了** |
| 4.1.0 | P1-T6-MERGE完了報告を反映（マージコミットbd697eb、main上での再検証結果全PASS）。DEBT-003のステータスを解消済みに修正（P1-T2-FIXで実際には対応済みだった）。ロードマップ表(1節)にステータス列を追加しPhase 0/1を完了に更新。**Phase 2（購買・調達）のセクションを新設**し、タスク分解（P2-T1〜T4）とP2-T1（purchase_requestsテーブル設計・実装）の実装指示プロンプトを追加。以降のセクション番号を1つずつ繰り下げ |
| 4.2.0 | P2-T1が初回レビューでSO正式PASS（金額整合性・tenant整合性・状態遷移・暗黙自動承認防止・RBAC三層防御をすべてDB最終防御まで確認）。DEBT-013（request_noの採番方式）を記録。マージ指示プロンプト（P2-T1-MERGE）を追加しP2-T1を完了扱いに更新。**P2-T2（サプライヤー：取引先マスタ管理）の実装指示プロンプトを新規作成** |
| 4.3.0 | P2-T2がSO判定REQUEST CHANGES（参照済みsupplier.name変更で既存purchase_requestとの不整合が生じる経路が未防御、DBエラーをfalseに握り潰すcatchあり、完了報告のコミットSHA誤り）。フォローアップ指示プロンプト（P2-T2-FIX）を追加 |
| 4.4.0 | P2-T2-FIXがSO判定REQUEST CHANGES（前回2 BLOCKERは解消。ただしsupplier.name変更とpurchase_request作成の同時実行にrace conditionが残る、P1-T3のDEBT-006と同型の問題）。フォローアップ指示プロンプト（P2-T2-FIX2、pg_advisory_xact_lockによる直列化）を追加 |
| 4.5.0 | P2-T2-FIX2が正式PASS（3つのBLOCKER全解消、並行実行の両方向を実DBで確認、Schema E2E 114/114・Jest 133/133）。マージ指示プロンプト（P2-T2-MERGE）を追加しP2-T2を完了扱いに更新。**P2-T3（発注〜検収〜請求の連携）の実装指示プロンプトを新規作成** |
| 4.6.0 | P2-T2-MERGE完了報告を反映（マージコミット05ffb6f、main上での再検証結果全PASS）。P2-T2が正式クローズ |
| 4.7.0 | P2-T3について、完了報告に対応する実装コミットがGitHub main上でまだ確認できず、SOがレビュー保留（レビュー待ち⏸️）。フォローアップ指示プロンプト（P2-T3-VERIFY）を追加し、push状態の確認・是正を指示（0.4節の既存ルールの再徹底、P1-T5-FIX3-VERIFYと同型の対応） |
| 4.8.0 | P2-T3がSO判定REQUEST CHANGES（purchase_receiptsがUPDATEはWORM防御されているがDELETEはトリガー・権限とも未防御。数量超過防御・concurrency race対策・tenant整合性・RBACは良好）。フォローアップ指示プロンプト（P2-T3-FIX、DELETEトリガー追加＋権限REVOKE）を追加。DEBT-014（terminated後のvendor_billsリンク未解除）を記録 |
| 4.9.0 | P2-T3-FIXについて、修正設計自体は妥当と評価されたが、完了報告にコミットSHA・ブランチ情報が欠落し実装を特定できずレビュー保留。この問題が複数回（P0-T1, P1-T5-FIX3, P2-T3, P2-T3-FIX）発生したことを受け、**0.4節ルール4を強化し「全ての完了報告にコミットSHA・ブランチ名の明記を必須」と明文化**。フォローアップ指示プロンプト（P2-T3-FIX-VERIFY）を追加 |
| 5.0.0 | P2-T3-FIXが正式PASS（DELETE WORM防御の追加を確認、実DB E2E 124/124・Jest 137/137）。マージ指示プロンプト（P2-T3-MERGE）を追加しP2-T3を完了扱いに更新。**P2-T4（購買ダッシュボード・レポート）の実装指示プロンプトを新規作成**。これでPhase 2の全4タスクの指示プロンプトが出揃った |
| 5.1.0 | P2-T4がSO判定REQUEST CHANGES（RLS/RBAC/集計ロジックは良好だが、月次推移がE2Eで未検証、EXPLAIN検証が実質何でもPASSする無意味な判定になっていた。0.4節ルール5「テストPASSは実動作の証明にならない」の再演）。フォローアップ指示プロンプト（P2-T4-FIX）を追加。DEBT-015（fiscal_yearsの非暦年ケース検証不足）を記録 |
| 5.2.0 | P2-T4-FIXが正式PASS（monthly_trendsの6ヶ月分実値照合、EXPLAIN ANALYZEによる意味のあるパフォーマンス検証を確認）。マージ指示プロンプト（P2-T4-MERGE）とPhase 2クローズのサマリ（往復回数、確立・強化された恒久ルール、DEBT棚卸し）を追加。**Phase 2（購買・調達）が全4タスク完了**。ロードマップ表(1節)のPhase 2を完了に更新 |
| 5.3.0 | P2-T4-MERGE完了報告を反映（マージコミットb0a6756、main上でE2E 125/125・Jest 141/141・build成功を再確認）。Phase 2が正式クローズ |
| 6.0.0 | **Phase 3（人事労務）のセクションを新設**。給与計算・社保を含めて一気に計画する方針を確認。5.2節に本Phase特有の設計原則（保険料率・税率のマスタ化、AI提案+人間承認パターンの適用、専門家レビューの推奨、監査可能性）を明記。タスク分解（P3-T1〜T4）とP3-T1（従業員マスタ・勤怠管理）の実装指示プロンプトを追加。ロードマップ表のPhase 3を着手中に更新。以降のセクション番号を1つずつ繰り下げ |
| 6.1.0 | P3-T1がSO判定REQUEST CHANGES（週40時間計算関数は実装・単体テストされているが実際の勤怠登録フローに未接続、employeeロールに本人限定のobject-level authorizationがなく他人の勤怠を操作可能）。フォローアップ指示プロンプト（P3-T1-FIX）を追加。DEBT-016（break_minutesの拘束時間超過検証なし）、DEBT-017（clock-in更新時の監査ログ欠落）を記録。0.4節ルール5に3件目の実例（P3-T1）を追記し「関数の存在≠実運用経路での動作」という教訓を明文化 |
| 6.2.0 | P3-T1-FIXがSO判定REQUEST CHANGES（前回2 BLOCKERは解消。週次再計算の同時実行競合、未退勤への修正時の週次再計算漏れ、RBACロール定義とisManager()の不一致が新規判明）。フォローアップ指示プロンプト（P3-T1-FIX2、advisory lockによる週次直列化＋常時週次再計算＋RBAC定義の統一）を追加 |
| 6.3.0 | P3-T1-FIX2がSO判定REQUEST CHANGES（前回3点は解消。updateRecord()とcreateRecord()でadvisory lock取得順序が逆になっておりデッドロックの可能性）。フォローアップ指示プロンプト（P3-T1-FIX3、ロック取得順序の統一＋週40時間境界を跨ぐ並行E2Eの追加）を追加 |
| 6.4.0 | P3-T1-FIX3が正式PASS（5回の往復を経て、ロック取得順序の統一によりデッドロックの原因そのものを是正、週40時間境界を跨ぐ並行登録の収束を実DBで確認）。マージ指示プロンプト（P3-T1-MERGE）を追加しP3-T1を完了扱いに更新。**P3-T2（保険料率・税率マスタ管理）の実装指示プロンプトを新規作成**（EXCLUDE制約による有効期間重複防止、5.2節原則のハードコード禁止を明記） |
| 6.5.0 | P3-T2がSO判定REQUEST CHANGES（DB/RLS/RBAC/EXCLUDE制約は良好だが、過去・適用済みマスタが通常UPDATEで書き換え可能で「追記型・過去データ上書き禁止」の運用原則に反する）。フォローアップ指示プロンプト（P3-T2-FIX、適用開始後のレコードをDBトリガーでfail-closedに変更禁止）を追加 |
| 6.6.0 | P3-T2-FIXが正式PASS（適用開始後のレコード変更をDBトリガーでfail-closedに禁止、JST基準・法改正close+INSERT運用、実DB E2E 139/139）。マージ指示プロンプト（P3-T2-MERGE）を追加しP3-T2を完了扱いに更新。**P3-T3（給与計算エンジン）の実装指示プロンプトを新規作成**（既存承認エンジンの再利用、AI提案+人間承認パターンの適用、料率マスタIDによる計算根拠の追跡可能性を明記） |
| 6.7.0 | P3-T3がSO判定REQUEST CHANGES（重大: 確定境界（draft/rejected/pending_approval→activeの直接UPDATE）がDB最終防御になっておらず、承認エンジンを経由しない確定が可能だった。計算エンジン・料率参照・tenant整合性・RBACは良好）。フォローアップ指示プロンプト（P3-T3-FIX、SET LOCALによるコンテキスト伝達パターンを応用したDB確定境界の実装）を追加 |
| 6.8.0 | P3-T3-FIXがSO判定REQUEST CHANGES（app.approval_contextがapp_runtime自身で自由に設定できる自己申告フラグに過ぎず、承認エンジンの迂回を防げていなかった）。フォローアップ指示プロンプト（P3-T3-FIX2、session変数方式を撤去しapproval_requestsの実在確認による確定境界へ変更）を追加 |
| 6.9.0 | P3-T3-FIX2がSO判定REQUEST CHANGES（重大: approval_requestsへ直接status='approved'を偽造INSERTすれば確定境界を突破できる。これはpayroll固有ではなくP0-T1承認エンジン全体に関わる問題と判明）。フォローアップ指示プロンプト（P3-T3-FIX3、approval_requestsへのINSERT時statusを常にpending_approvalに強制するDBトリガーの追加）を追加。承認者割当のDB検証が未実装の場合はDEBTとして許容する方針を明記 |
| 7.0.0 | P3-T3-FIX3がSO判定REQUEST CHANGES（approved単発INSERTの偽造は解消したが、pending→approvedへの直接UPDATE経路が依然DB最終防御になっていない）。フォローアップ指示プロンプト（P3-T3-FIX4、承認履歴の実在・権限保有をDBトリガーで検証する根本設計への変更）を追加。実装規模が想定を超える場合は独立サブタスクへ切り出す方針を明記 |
