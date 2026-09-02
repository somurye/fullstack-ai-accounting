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
| P0-T2 | `attachments`テーブルの汎用化確認・拡張 | 現状レシート/請求書向け前提の列（`counterparty_name`等）が契約書にも自然にフィットするか検証し、必要なら`document_category`列を追加 | なし | 着手待ち |
| P0-T3 | AIゲートウェイの汎用提案インターフェース定義 | OCR/科目提案に限定されている現行の提案スキーマを、「文書種別によらず`suggested_fields: JSON`を返す」形に一般化 | なし | 未着手 |
| P0-T4 | ロール／権限マスタへの新ロール追加 | `viewer_legal`等、総務・法務向けロールをRBACに追加（既存`viewer_external`と同パターン） | なし | 未着手 |

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

| タスクID | タスク名 | 概要 | 依存 |
|----------|----------|------|------|
| P1-T1 | `contracts`テーブル設計・実装 | 契約書メタデータ本体（相手先、種別、金額、期間、自動更新有無、ステータス） | P0-T1, P0-T2 |
| P1-T2 | 契約書アップロード〜AI条項抽出フロー | PDFアップロード→AIゲートウェイでの条項抽出提案→人間確認画面 | P0-T3, P1-T1 |
| P1-T3 | 契約承認ワークフロー統合 | `approval_requests`(target_type='contract')と`contracts`の連携、承認完了で`status`を`active`へ | P0-T1, P1-T1 |
| P1-T4 | 契約期限アラート・バッチ | 満了/自動更新の一定日数前に通知を生成するバッチワーカー | P1-T1 |
| P1-T5 | 稟議申請（汎用ワークフロー起票UI） | 契約以外の一般的な稟議（购買以外の申請）もこの画面から起票できる汎用フォーム | P0-T1 |
| P1-T6 | 契約書全文検索（pgvector活用） | 既存のjournal_entry_embeddingsと同様のパターンで契約書本文をベクトル化し類似契約検索を提供 | P1-T1 |

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

## 3.4 決定事項: ロール・権限の粒度方針

- **方針**: 権限を細分化し、権限外の領域は閲覧も含めて不可とする（deny-by-default）。既存のRLSが「fail-closed（未設定・不一致時は0件返却）」の原則を採っているため、この方針とも整合的。
- **対応タイミング**: P0-T4（法務向けロール追加）では最小限のロール(`legal_admin`/`legal_viewer`)のみ用意し、細粒度の権限設計（契約種別ごと、金額しきい値ごと等）はPhase 1でUI/運用が固まってから着手する。基盤（`roles`/`permissions`/`role_permissions`のテーブル構造）自体は既に細分化可能な設計になっているため、後追いでの拡張コストは低いと判断。
- **P0-T4のDoDへの影響**: 「新ロールでログインしたユーザーが権限のないテーブルにアクセスできないこと」の確認は引き続き必須。今回追加するのは前提となるロール骨格のみで、権限マトリクスの最終形ではない点をレビュー時にも明記しておく。

---

## 4. 次のアクション

1. 本計画書の内容で問題なければ、**P0-T1から順にGeminiへ指示プロンプトを渡して実装開始**。
2. Phase 0が完了し次第、Phase 1のP1-T2以降のプロンプトを実際のコード状態を踏まえてClaudeが作成する。
3. Phase 2（購買・調達）以降のタスク分解は、Phase 1完了後にあらためて計画書へ追記する。

---

## 5. 変更履歴

| バージョン | 日付 | 内容 |
|------------|------|------|
| 1.0.0 | 初版 | 全体ロードマップ策定、Phase 0/Phase 1のタスク分解と実装指示プロンプト作成 |
| 1.1.0 | ロール・権限の粒度方針（deny-by-default、細分化は後追い）を決定事項として記録 |
| 1.2.0 | 完了報告ルール（0.4節: コミット・push必須、mainへの独断マージ禁止）を追加。P0-T1のSO指摘事項に対応するフォローアップ指示プロンプト（P0-T1-FIX）を追加。P0-T2〜T4, P1-T1のDoDにコミット・push要件を追記 |
| 1.3.0 | コミット77eb503の実コードレビュー結果を反映。責務分離の懸念は解消を確認。migrationへの本番データINSERT混入という唯一の残課題に対応するP0-T1-FIX2プロンプトを追加 |
| 1.4.0 | P0-T1がSO正式PASS（コミット96ffcf4）。マージ指示プロンプト（P0-T1-MERGE）を追加し、タスク一覧にステータス列を追加してP0-T1を完了扱いに更新 |
