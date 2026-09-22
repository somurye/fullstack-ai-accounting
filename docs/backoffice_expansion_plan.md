# keiri-kaikei 全社バックオフィス統合SaaS 拡張計画書

- 文書番号: PLAN-01
- バージョン: 7.19.3
- 対象リポジトリ: `fullstack-ai-accounting`（経理・会計基盤）
- 関連文書: `docs/01_requirements.md`, `docs/02_architecture.md`, `docs/03_database_design.md`

---

## エグゼクティブサマリー（現在地）

**本ロードマップ（Phase 0〜Phase 5）の全タスクが完了した。** 本文書は3500行を超える
規模になっており、詳細な経緯は10節の変更履歴・各Phaseの実装指示プロンプト（レビュー
往復の全記録）に譲る。ここでは全体の現在地だけを示す。

### 進捗

| Phase | ドメイン | 状態 | タスク数 | 往復の目安 |
|-------|----------|------|---------|-----------|
| Phase 0 | 基盤汎用化 | ✅ 完了 | 5/5 | 平均1〜2回 |
| Phase 1 | 総務・法務（契約書管理） | ✅ 完了 | 6/6 | 平均2〜3回、最大4回（P1-T5） |
| Phase 2 | 購買・調達 | ✅ 完了 | 4/4 | 平均2回、最大3回（P2-T2/P2-T3） |
| Phase 3 | 人事労務 | ✅ 完了 | 4/4 | 平均2〜3回、最大6回（P3-T3） |
| Phase 4 | 営業事務 | ✅ 完了 | 4/4 | 平均2〜3回、最大5回（P4-T1） |
| Phase 5 | 統合最適化 | ✅ 完了 | 4/4 | 平均2回、最大2回（P5-T1/P5-T2/P5-T4） |

### 直近のアクション

- P5-T4のmainマージ完了報告を受領。**P5-T1〜T4すべてのマージコミットSHA
  （`28c4f75`・`0da4b87`・`c63382f`・`8d15cca`）をmainのコミット履歴で確認**し、
  main上でclean DB 001〜035・実DB E2E 93/93・schema verifier 209/209・Backend Jest
  30 suites/261 tests・Frontend buildをすべて確認済み。**これによりPhase 5（統合
  最適化）が全4タスク完了し、ロードマップ全体（Phase 0〜Phase 5）が完了した。**
- Phase 5クローズのサマリ（往復回数、確立された恒久ルール）とプロジェクト全体の総括を
  7節に追加した。ロードマップ表・タスク表を全Phase完了に更新した。
- DEBT-001, 008, 010を8節の内容通りに整理（DEBT-008・010は解消、DEBT-001は部分解消・
  残存リスクを受容）。DEBT-002, 007, 009, 011〜018, 021は、GeminiのP5-T4完了報告で
  「対応しない・受容済み境界」と判定された結論のみを反映した（Gemini報告内の個別の
  理由付け文章は、一部の項目でDEBT番号と記述内容の対応関係が判然としない箇所があった
  ため、既存の詳細記述はそのまま保持し、結論のみを反映した。詳細な理由の紐付けが
  必要になった場合は、次にGeminiとやり取りする機会に再確認するとよい）。
- **次のアクション（9節）**: 本プロジェクトの計画上のタスクはすべて完了した。追加の
  機能開発は、新たな要望が生じた際に本文書に新しいPhase・タスクとして追記する形で
  再開できる。

### このプロジェクトを通じて確立された恒久ルール（詳細は0.4〜0.5節）

1. push前の報告は完了とみなさない。全ての完了報告にコミットSHA・ブランチ名を必須記載する
   （P0-T1, P1-T5-FIX3, P2-T3, P2-T3-FIXで繰り返し発生した問題への対応）。
2. テストPASSは実動作の証明にならない。特に「関数は実装・単体テストされているが実際の
   運用経路に接続されていない」というパターンが3回発生した（P1-T2のPDF抽出、P2-T4の
   EXPLAIN検証、P3-T1の週40時間計算）。
3. migrationはappend-only。既存ファイルを事後的に書き換えない（P1-T5）。
4. 制約を追加するmigrationは、既存データを自動改変せずfail-closedで停止する（P1-T5）。
5. 「DBを最終防御とする」原則には、単一の共有DBロール（app_runtime）という構造上の
   限界がある。DB資格情報自体を奪取した攻撃者による本人性偽装までは防御対象外とし、
   正規API経路での認証済みセッションからのID強制導出で担保する（P3-T3、0.5節）。
6. 双方向リンク（例: 見積↔invoice）は、両端をDBトリガーで対称に不変化する。片側だけの
   WORM保護は不十分（P4-T1）。
7. リンクの正当性はtenant一致だけでは不十分で、参照先の構造的関係（quote_no・version・
   deal_id等）までDBトリガーで検証する（P4-T1, P4-T3）。
8. 実DB E2Eで「RLSを最終防御として検証した」と言うには、`postgres`superuser接続では
   RLSが常にバイパスされるため、`app_runtime`ロール・`app.current_tenant_id`設定を
   経由した検証が必須（P4-T4）。
9. 「解消した」という完了報告の表現は、実装内容の正確な言い換えでなければならない。
   補償処理による緩和を「完全解消」と表現しない、検証スクリプトによる検知を「自動検知
   （CI常時実行）」と過大に表現しない等、実装の水準と表現の水準を一致させる（P5-T4）。

### 技術的負債（DEBT）の状況

DEBT-001〜DEBT-022のうち、解消済みは DEBT-003, 004, 005, 006, 008, 010, 020, 022
（8件）。DEBT-001は部分解消（補償処理、残存リスクを受容）。DEBT-002, 007, 009,
011〜018, 021（12件）はP5-T4のトリアージにより「対応しない・受容済み境界」に整理
された。DEBT-019は「DEBTというより設計上の恒久的な境界の記録」として区別している。
現時点で未対応の実装課題はなく、残るDEBTはすべて意図的な設計判断として記録されている
（8節）。

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

### 0.5 「DBを最終防御とする」原則の限界（受容する境界）

P3-T3の承認境界レビュー（FIX1〜FIX4）を通じて、「DBを最終防御とする」という原則にも
実務上の限界があることが判明した。以下を本プロジェクト全体の共通認識として明記する。

- DBトリガーが検証できるのは、DBに格納された事実（tenant_id、権限保有の有無、自己承認でない
  こと、ワークフローの完了状態等）に基づく**構造的な業務ルール違反**であり、「今この
  SQL文を実行している主体が、本当に主張通りの人物か」という**認証・本人性そのもの**は
  検証できない。これは、アプリケーション全体が単一の共有DBロール（app_runtime）で
  DB操作を行うという、本プロジェクトのアーキテクチャ上の構造的な限界である。
- 具体的には、「approval_history.approver_idに実在する権限保有者のIDを指定すれば、
  実際の操作主体が誰であってもDBトリガーは通過する」という残存リスクがある
  （P3-T3-FIX4のSOレビューで指摘）。この種の"なりすまし"を完全に防ぐには、DB接続自体を
  ユーザー単位で分離する、署名付きトークンをDBが直接検証する等の大規模なアーキテクチャ
  変更が必要になり、本プロジェクトの現在のスコープを超える。
- **したがって、本プロジェクトが提供するDB最終防御は「正規のAPI・Service層を経由した
  操作である限り、tenant境界・自己承認・権限保有・ワークフロー完了等の構造的な業務ルールを
  確実に守る」という範囲までとする。** app_runtimeの認証情報そのものを奪取した攻撃者による
  生SQL実行までは防御の対象外とし、これは他の多くのシステムにおいても一般的に「アプリケーション
  の認証情報が漏洩した場合の被害範囲」として受容される種類のリスクである。
- 各タスクの実装確認では、この境界を踏まえ、**「正規のAPI経路からは、この種のなりすましを
  行う入力（他人のuser_idを承認者として指定する等）が構造的に不可能であること」**
  （例: approver_idはリクエストボディの値ではなく、認証済みセッションから常にサーバー側で
  導出する設計になっているか）を確認することを、DB直接攻撃の完全な封殺の代わりとする。

---

## 1. 拡張ロードマップ全体像

実装順序は「①汎用化基盤への投資対効果」「②既存資産の再利用度」「③規制・専門性の複雑さ」の3軸で決定。複雑な人事労務を後回しにし、まず汎用ワークフローエンジンを固めてから横展開する設計。

| Phase | ドメイン | 主な機能 | 既存資産の再利用度 | 規制複雑度 | ステータス |
|-------|----------|----------|---------------------|-------------|-----------|
| **Phase 0** | 基盤汎用化 | 承認ワークフローエンジンの完全汎用化、汎用ドキュメント管理基盤 | −（投資フェーズ） | 低 | ✅ 完了（全5タスク） |
| **Phase 1** | 総務・法務 | 契約書管理、稟議申請、条項AI抽出、更新期限アラート | 高（承認・監査ログ・AI Gateway） | 中 | ✅ 完了（全6タスク） |
| **Phase 2** | 購買・調達 | 発注申請、サプライヤー管理、購買稟議 | 高（Phase0/1のワークフロー・帳票基盤） | 低〜中 | ✅ 完了（全4タスク） |
| **Phase 3** | 人事労務 | 勤怠管理、給与計算内製化、社保・年末調整 | 中（給与連携は既存、計算ロジックは新規） | 高（労働法制） | ✅ 完了（全4タスク） |
| **Phase 4** | 営業事務 | 見積書、契約更新連携、案件管理 | 高（請求書発行・契約管理の延長） | 低 | ✅ 完了（全4タスク） |
| **Phase 5** | 統合最適化 | 横断ダッシュボード、AIエージェントによる業務横断レコメンド | −（統合フェーズ） | 低 | ✅ 完了（全4タスク） |

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
| P3-T3 | 給与計算エンジン | 勤怠実績・基本給・手当・控除から給与を計算し、AI提案パターンで人間確認を経て確定する（5.2節の原則②に対応） | P3-T1, P3-T2 | ✅ SO正式PASS・mainマージ完了（マージコミット`a285721`、6回の往復を経て確定境界をDB最終防御＋API認証境界の二層構造で完成。Jest 183/183・型チェック・build全PASS再確認済み。**要フォローアップ**: マージ時Docker停止のため`verify_schema.py`実DB E2Eのmain上での再実行が未実施） |
| P3-T4 | 給与明細発行・年末調整 | 給与明細のPDF発行、年末調整の計算・書類生成 | P3-T3 | ✅ SO正式PASS・mainマージ完了（マージコミット`6be18a3`、実DB E2E 154/154・P3-T4専用40/40 PASS、Jest 201/201、001〜025クリーンDB再構築確認済み）— **Phase 3完了** |

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

#### 【フォローアップ指示プロンプト P3-T3-FIX5】境界確認（DB最終防御の限界を受容し、API経路での防御を最終確認）

ChatGPT(SO)よりP3-T3-FIX4について、「権限を持つ別ユーザーへのなりすまし」が残存リスクとして
指摘された。Claudeとしての判断: これはDBトリガーだけでは原理的に閉じきれない
（app_runtime生SQL実行者の本人性はDBが検証できる範囲を超える）問題であり、本計画書0.5節に
「DBを最終防御とする原則の限界」として明文化した。今回はDB側のさらなる修正ではなく、
**API経路からはこのなりすましが構造的に不可能であることの確認**を行う。

```
# 指示
以下を確認し、報告してください。DB側のさらなる修正は不要です。

1. 承認処理（approval_history.approver_idを決定する箇所）のController/Serviceの
   実装を確認し、approver_idがリクエストボディやクエリパラメータ等、クライアントが
   自由に指定できる値から取られていないこと、常に認証済みセッション（JWT等の
   認証情報からServiceが導出したユーザーID）から設定されていることを確認する。
   もしリクエストボディ等からapprover_idを受け取れる経路が存在する場合、それは
   API経由でのなりすましを許してしまうため、その経路を修正する（認証済みユーザーIDを
   強制的に使うようにする）。
2. 上記を確認するテスト（E2Eまたは統合テスト）を追加する。例えば、承認APIのリクエストに
   approver_id等のフィールドを含めて別ユーザーを指定しようとしても無視され、
   常に実際の認証済みユーザーのIDが使われることを確認する。
3. 本計画書0.5節の内容を踏まえ、「app_runtimeの認証情報自体を奪取した攻撃者による
   生SQL実行までは防御対象外とする」という境界を、README等のセキュリティに関する
   ドキュメントに一言記載する。

# 受け入れ基準（Definition of Done）
- [ ] 承認API（および同様の構造を持つ既存のcontract/general_request/purchase_request
      承認API）で、approver_idが常にサーバー側の認証済みセッションから導出されており、
      クライアント入力で上書きできないことを確認する
- [ ] 上記を確認するテストを追加する
- [ ] DB最終防御の境界に関する一文をREADME等に記載する
- [ ] 完了報告に正確なコミットSHA・ブランチ名を明記する（本計画書0.4節ルール4に従う）
- [ ] feature/p3-t3-payroll-engine ブランチに追加コミット・pushし、比較URLを報告に
      含める

# SOへの申し送り
Claudeとしての判断で、「権限保持者IDへのなりすまし」は本計画書0.5節に定義した
受容境界（DBの正規API経由での防御は完全、生SQL実行者の本人性検証はスコープ外）に
該当すると判断しました。今回のFIX5では、この境界がAPI経路において実際に成立している
こと（クライアントがapprover_idを操作できないこと）の確認のみを行っています。
この判断自体の妥当性について、最終確認をお願いします。
```

---

#### 【マージ指示プロンプト P3-T3-MERGE】mainへのマージ

ChatGPT(SO)よりP3-T3-FIX5が正式PASS（共通承認API・経費精算専用API双方で、承認者IDが認証済みセッションからのみ導出されることを確認、DB資格情報奪取時の受容境界をREADMEに文書化）と判定された。

```
# 指示
feature/p3-t3-payroll-engine を main へマージしてください。
SO(ChatGPT)による正式PASS判定を得ています。P3-T3は以下6回の往復を経て、給与確定境界を
「DB最終防御（tenant整合性・状態遷移・承認履歴実在・権限保有・自己承認防止）」＋
「API認証境界（承認者IDは常に認証済みセッションから強制導出）」という二層構造で
完成させました。
- FIX: 週40時間計算の未接続・object-level authorization欠如の解消
- FIX2/3: 週次再計算の並行実行・ロック順序の是正
- FIX4/5: 確定境界（承認済みという事実の偽装防止）をDB最終防御＋API認証境界で完成
DEBT-018（承認者「割当」の厳密なDB検証は未実装、権限保有チェックに留まる）、
DEBT-019（app_runtime資格情報奪取時の本人性偽装は受容境界として文書化済み）は
計画書側で追跡することとし、今回のマージをブロックするものではありません。
マージ後、以下を確認し報告してください（本計画書0.4節に従い、コミットSHA・ブランチ名を
必ず明記すること）。
- main上でクリーンDBに対しverify_schema.pyを含む実DB E2Eを再実行し、全件PASSを確認する
- Backend/Frontendのテストを再実行して確認
- マージコミットハッシュ（git rev-parse HEAD）
- 作業ブランチ feature/p3-t3-payroll-engine の削除（マージ済み後）
```

これでP3-T3は完了。Phase 3の残りはP3-T4（給与明細発行・年末調整）のみ。

---

#### 【フォローアップ指示プロンプト DEBT-020-VERIFY】mainブランチでの実DB E2E再実行（Docker復旧後）

```
# 指示
以下を確認・実行してください。

1. Docker Desktopが起動していることを確認する（`docker info`等）。
2. mainブランチが最新であることを確認する（`git status`, `git pull origin main`）。
3. クリーンDB環境で実DB E2Eを実行する。
   .\.venv\Scripts\python.exe scripts/verify_schema.py --use-docker
4. 001から最新migrationまでの全件PASSを確認し、件数（例: n/n PASS）を報告する。
5. Docker起動自体に失敗する場合は、エラーメッセージをそのまま報告してください
   （環境側の問題か、コード側の問題かを切り分けるため）。

この確認が完了すれば、DEBT-020はクローズとして扱います。
```

---

#### 【指示プロンプト P3-T4】給与明細発行・年末調整

```
# 背景・目的
Phase 3の最終タスク。P3-T3で確定（active）した給与計算結果から給与明細を発行し、
年末調整（源泉徴収税額の年間精算）を実装する。P3-T3までで確立した設計パターン
（AI/ルールエンジン提案→人間確認→既存承認エンジン→確定、確定後WORM、tenant整合性、
RBAC三層防御）をそのまま踏襲する。

# 前提となる既存実装
- P3-T3: payroll_calculations（status='active'の確定済み給与計算、applied_rate_idsによる
  計算根拠の追跡）
- P3-T2: insurance_rate_tables, income_tax_withholding_brackets（有効期間付き、適用済みは不変）
- Phase 0〜3で確立した設計パターン全般（tenant整合性トリガー、RLS、RBAC三層防御、
  migrationのappend-only・fail-closed運用、承認エンジンの確定境界＝DB最終防御＋API認証境界）
- 本計画書0.5節（DB最終防御の限界と受容境界）

# やってはいけないこと
- 年末調整の計算結果を、人間の確認・承認を経ずに直接確定・提出可能な状態にしない。
  P3-T3で確立した「ルール計算→draft→人間確認→承認エンジン→active」パターンを
  年末調整にも適用する。
- 発行済み（confirmed）の給与明細・年末調整結果を通常のUPDATEで変更可能にしない
  （P3-T2/P3-T3で確立したfail-closedなWORMパターンを踏襲する）。
- 年末調整の計算ロジックを「法令完全準拠」と称さない。5.2節の原則（簡略モデルとして扱う、
  専門家レビューの推奨）を維持する。

# 実装対象
1. 新規マイグレーションで payslips テーブル（給与明細、tenant_id, payroll_calculation_id,
   pdf生成に必要な表示用データのスナップショット, issued_at, status(draft/confirmed)等）を
   作成する。RLS、tenant整合性トリガー（payroll_calculation_id経由）、confirmed後の
   変更禁止トリガーを実装する。
2. 給与明細PDF生成機能を実装する（既存のpdf生成基盤があれば再利用し、なければ新規に
   構築する。docx/pdfスキルのような社内標準がある場合はそれに従う）。
3. year_end_adjustments テーブル（年末調整、tenant_id, employee_id, tax_year,
   annual_income_total, annual_withheld_tax, deductions（生命保険料控除・地震保険料控除等、
   簡略化した項目でよい）, adjustment_amount（還付/追加徴収額）, applied_rate_ids,
   status(draft/pending_approval/active)等）を作成する。RLS、tenant整合性、
   状態遷移・WORM、既存承認エンジンとの統合（target_type='year_end_adjustment'）を、
   P3-T3で確立したパターンに従って実装する。同一tenant・employee・tax_yearの
   重複計算を防ぐUNIQUE制約を設ける。
4. payslip.create/view、year_end_adjustment.create/view/approve のpermissionをRBAC体系に
   追加し、Controller・Service両層でチェックする。employee自身が自分の年末調整を
   確定できないようにする。
5. 給与明細発行・年末調整計算・確認・確定のAPIとフロントエンド画面を実装する。

# 受け入れ基準（Definition of Done）
- [ ] 確定済みpayroll_calculationsから給与明細PDFが発行できる
- [ ] confirmed後の給与明細がDBトリガーで変更不可になる
- [ ] 年末調整の計算結果が人間確認・承認エンジンを経てからactiveになる
- [ ] 同一employee・同一tax_yearの重複計算がDB制約で防止される
- [ ] employee自身が自分の年末調整を確定できないことを確認する
- [ ] 他テナントのデータが一切見えないことをRLSで確認
- [ ] Phase 0〜3で繰り返し指摘された問題（暗黙自動承認、tenant整合性のアプリ層依存、
      RBAC未強制、同時実行race condition、migration事後書き換え、確定境界のDB未防御、
      実質何も検証しないテスト）のいずれも再発していないことを確認する
- [ ] 完了報告に正確なコミットSHA・ブランチ名を明記する（本計画書0.4節ルール4に従う）
- [ ] クリーンDBでの実DB E2E結果を報告に添付する
- [ ] feature/p3-t4-payslips-year-end-adjustment ブランチにコミット・pushし、
      比較URLを報告に含める（本計画書0.4節に従う）

# ChatGPTレビュー時の確認観点
- 給与明細・年末調整の確定境界が、P3-T3で最終的に到達した「DB最終防御＋API認証境界」の
  二層構造と同じ厳格さで実装されているか
- 年末調整のapplied_rate_idsが正しい料率マスタを参照しているか、tenant境界を越えていないか
- これがPhase 3最後のタスクであるため、Phase 3全体を通して確立されたパターンからの
  逸脱がないか総括的に確認してほしい
```

---

#### 【フォローアップ指示プロンプト P3-T4-FIX】REQUEST CHANGES対応（計算根拠の不一致・年分の未整理・実DB E2E未実行）

ChatGPT(SO)よりP3-T4が「REQUEST CHANGES」と判定された。DB防御・承認エンジン連携・
暗黙自動承認防止・payslip側の実装は評価されており、修正対象は以下3点。

```
# SOレビュー結果：P3-T4 REQUEST CHANGES
main...feature/p3-t4-payslips-year-end-adjustment の実差分（コミットeccbe9b）を確認した
結果、現状はマージ不可です。

# BLOCKER-01: applied_rate_idsが実際の計算根拠と一致していない
年末調整の計算本体（calcEmploymentIncomeDeduction() / calcIncomeTaxFromBrackets()）は
ハードコードされた関数を使っている一方、applied_rate_idsは
「SELECT id FROM income_tax_withholding_brackets WHERE tenant_id=$1 AND is_active=TRUE
LIMIT 1」で取得した、計算に実際には使っていないレコードを記録しています。これは
「IDが入っている」だけで、後から計算根拠を追跡できるという本来の目的を満たしていません。

## 修正方針
income_tax_withholding_brackets（および使用する他の料率マスタ）を、対象tax_yearの
所得金額に応じて実際にlookupし、その計算で実際にマッチしたレコードのIDをapplied_rate_ids
に記録するよう修正してください。ハードコード関数を使い続ける場合でも、計算の各ステップで
参照すべきマスタレコードを実際に検索し、その結果のIDを記録する形にしてください。

## 追加すべき実DB E2E（必須）
異なる複数のincome_tax_withholding_bracketsレコード（tenant内に複数年度・複数所得帯を
用意）に対し、実際にマッチしたレコードのIDがapplied_rate_idsに正しく記録されることを
確認してください。単に「1件以上入っている」ではなく、「どのレコードが選ばれたか」を
具体的に検証してください。

# BLOCKER-02: 年分（tax_year）に応じた計算根拠が整理されていない
tax_yearパラメータを受け取っているにもかかわらず、基礎控除・給与所得控除の計算式が
年分によらず固定値になっています。国税庁の資料によれば、令和7年分・令和8年分では
基礎控除・給与所得控除の金額が改正されており、現在の実装はどの年分の制度とも一致しません。
5.2節の「簡略モデルとして扱う」という原則自体は維持してよいですが、「どの年分を想定した
簡略モデルなのか」が不明確なまま任意のtax_yearを受け付ける状態は、実運用時の誤解を招きます。

## 修正方針（いずれかを選択し、報告に理由を明記する）
  a. 現時点でサポートするtax_yearを明示的に1つ（またはごく少数）に限定し、それ以外の
     tax_yearが指定された場合はエラーを返す（「現在は令和8年分の簡略モデルのみ対応」等）。
  b. 基礎控除・給与所得控除の閾値・金額をP3-T2のinsurance_rate_tablesと同様の
     有効期間付きマスタ（例: income_deduction_rules）として切り出し、tax_yearに応じて
     異なる値を参照できるようにする（スコープが大きくなる場合は、aを採用した上でDEBTとして
     bを将来対応に回してよい）。
どちらを選んでも、README等に「対象年分」「簡略化の範囲」を明記してください。

# BLOCKER-03: 実DB E2Eが未実行
Docker停止によりverify_schema.py --use-dockerが実行できておらず、Jest/typecheck/build
のみの確認に留まっています。本計画書0.4節ルール5に該当するため、クリーンDBでの実DB E2E
結果が揃うまでは完了報告として扱いません。Docker環境が復旧してから、001〜025全件の
実DB E2E結果を報告に添付してください。Docker自体の起動に失敗する場合は、その旨と
エラーメッセージを報告してください（環境側の問題であればユーザー側での対応が必要となる
ため、コード修正では解決しない可能性がある点も明記してください）。

# 軽微な修正（あわせて対応）
payslips.created_by / year_end_adjustments.created_byについて、他のテーブルと同様の
created_byのtenant整合性トリガー（既存パターンを踏襲）を追加してください。

# 受け入れ基準（Definition of Done）
- [ ] applied_rate_idsが実際の計算に使用したマスタレコードのIDと一致する
- [ ] 複数レコードが存在する状況で正しいレコードが選ばれることを実DB E2Eで確認する
- [ ] サポート対象のtax_year、または年分に応じたマスタ参照方式のいずれかが実装され、
      対象年分・簡略化範囲がREADME等に明記されている
- [ ] created_byのtenant整合性トリガーがpayslips/year_end_adjustments双方に追加されている
- [ ] クリーンDBでの実DB E2E（001〜025全件、新規テストケース含む）の結果を報告に添付する
- [ ] 完了報告に正確なコミットSHA・ブランチ名を明記する（本計画書0.4節ルール4に従う）
- [ ] feature/p3-t4-payslips-year-end-adjustment ブランチに追加コミット・pushし、
      比較URLを報告に含める

# ChatGPTレビュー時の確認観点
- applied_rate_idsの修正が、複数年度・複数所得帯が混在する複雑なケースでも正しく機能するか
- tax_yearの制限方式（a案）または動的マスタ方式（b案）が、将来の年度追加時に
  コード変更を最小限にできる設計になっているか
```

---

#### 【フォローアップ指示プロンプト P3-T4-VERIFY-AND-MERGE】Docker復旧後の実DB E2E実行とマージ（コード修正はPASS相当）

ChatGPT(SO)よりP3-T4-FIXがCONDITIONAL PASS（コード修正内容は全てPASS相当、残るは
Docker復旧後の実DB E2E実行のみ）と判定された。DEBT-020-VERIFYと合わせて、Docker復旧後に
まとめて実行する。

```
# 指示
Docker Desktopが起動可能になったら、以下を順に実行してください。

1. mainブランチで実DB E2Eを実行し、DEBT-020を解消する。
   git checkout main && git pull origin main
   .\.venv\Scripts\python.exe scripts/verify_schema.py --use-docker
   → 001から現在のmain最新migrationまでの全件PASSを確認・報告する。

2. feature/p3-t4-payslips-year-end-adjustment ブランチで実DB E2Eを実行する。
   git checkout feature/p3-t4-payslips-year-end-adjustment
   .\.venv\Scripts\python.exe scripts/verify_schema.py --use-docker
   （またはP3-T4専用のE2Eスクリプトがあれば合わせて実行）
   → 001〜025全件PASS、および前回FIXで追加した以下のケースを含めて結果を報告する。
     - 実際のtax bracketマッチング（年度・扶養人数・所得帯違いの除外を含む）
     - unsupported tax yearのエラー
     - created_by tenant不整合の拒否
     - 承認境界（多段階・0-step・active後WORM）

3. 両方が問題なければ、feature/p3-t4-payslips-year-end-adjustment を main へマージする。
   マージコミットハッシュ（git rev-parse HEAD）、ブランチ削除の完了、main上での
   テスト再実行結果を報告してください（本計画書0.4節に従う）。

4. Dockerの起動自体に失敗する場合は、そのエラーメッセージをそのまま報告してください。
   コード側の問題ではなく環境側の問題である可能性が高いため、無理に回避策を
   実装しようとしないでください。
```

これが完了すれば、**Phase 3（人事労務）の全4タスクが完了**する。

### Phase 3クローズ時点のサマリ

| タスク | 最終判定 | 往復回数 |
|--------|----------|----------|
| P3-T1 | ✅ PASS | 5回（週40時間未接続 → object-level auth → 並行実行race condition → ロック順序 → 最終E2E） |
| P3-T2 | ✅ PASS | 2回（過去マスタのUPDATE可能性） |
| P3-T3 | ✅ PASS | 6回（週次計算 → 確定境界のDB最終防御を段階的に強化、最終的にDB最終防御＋API認証境界の二層構造へ到達） |
| P3-T4 | ✅ PASS | 2回（applied_rate_idsの実マッチング化・tax_year限定・実DB E2E） |

### Phase 3で確立・強化された恒久ルール

1. 0.5節「DBを最終防御とする原則の限界（受容する境界）」を新設（P3-T3）。
2. 0.4節ルール5に「関数の存在≠実運用経路での動作」の3件目の実例（P3-T1）を追記。
3. 人事労務Phaseに特有の設計原則（5.2節: 保険料率・税率のマスタ化、AI提案+人間承認
   パターンの適用、専門家レビューの推奨、監査可能性）を新設し、給与計算・年末調整の
   両タスクで一貫して適用した。

### 未解決の技術的負債一覧（Phase 4着手前に一度棚卸しを推奨）

DEBT-001, 002, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016, 017, 018, 021 が
8節に記録されている（DEBT-003〜006, 020は解消済み、DEBT-019は受容境界として区別）。
Phase 4（営業事務）は既存の請求書発行・契約管理の延長という位置付けで規制複雑度は
低いため、着手前の棚卸しの優先度は他Phaseより低い。

---

---

## 6. Phase 4: 営業事務（見積書・契約更新連携・案件管理）

### 6.1 目的

Phase 0〜3で確立した設計パターン（tenant整合性のDBトリガー、暗黙自動承認の防止、RBAC
三層防御、migrationのappend-only・fail-closed運用、AI提案→人間承認→DB確定の三段構成）を
営業事務ドメインに展開する。本Phaseは既存の請求書発行機能（経理会計基盤）・Phase 1で
構築した契約管理・Phase 0の承認ワークフローエンジンの再利用度が高く、規制複雑度は
Phase 3（人事労務）と比べて低い。

### 6.2 本Phase特有の設計原則（最重要・全タスク共通）

営業事務ドメインはPhase 3のような法令リスクは低いが、代わりに「確定した見積・受注内容が
後から静かに書き換わる」「同じ見積から二重に受注・請求が発生する」といった商取引上の
整合性リスクが中心になる。以下を全タスク共通の設計原則とする。

1. **確定済み見積書は不変（immutable）として扱う。** 見積を`draft`から`sent`（顧客提示済み）
   状態に遷移させた後は、金額・明細を直接UPDATEで書き換えることを禁止する。内容変更が
   必要な場合は新しいバージョンの見積レコードを追加発行する設計とする（Phase 1の
   `finalized`契約・Phase 3の適用開始後料率マスタで確立した「確定後は追記のみ」パターンを
   踏襲）。
2. **見積→受注→請求の変換は一方向かつ一度きりの遷移として管理する。** 同一の見積から
   複数の受注・請求が重複して生成されないよう、DB制約（unique制約、状態遷移トリガー）で
   多重変換を防止する。
3. **既存の請求書発行機能・契約管理（Phase 1）との統合点を新規に再定義しない。** 請求書の
   実際の発行処理・契約更新アラートのバッチ処理自体はPhase 1およびベースの経理会計基盤で
   既に確立済みであり、本Phaseはそれらに「営業側からの連携データ（案件・見積の紐付け）」
   を追加する立場に徹する。既存テーブル・APIの責務を奪って作り直さないこと。
4. **案件（商談）のステージ変更は人間の営業担当者による操作を基本とする。** AIによる
   提案要素を導入する場合（例: 見積明細のドラフト生成、案件の受注確度スコアリング）も、
   0.2節の三段構成（AI提案→人間承認→DB確定）を踏襲し、AIの出力が承認なしに確定状態
   （受注確定・見積確定）へ直接反映されないようにする。

### 6.3 タスク分解

| タスクID | タスク名 | 概要 | 依存 | ステータス |
|----------|----------|------|------|-----------|
| P4-T1 | 見積書（見積作成・確定・受注転換） | 見積の作成・明細管理、`draft`→`sent`→`accepted`/`rejected`/`expired`の状態遷移、確定後の不変性、受注への一方向変換 | P0-T1, P0-T4 | ✅ PASS・mainマージ完了（マージコミット`7317b04`、E2E 57/57・Schema 169/169） |
| P4-T2 | 案件管理（商談パイプライン） | 案件（商談）の登録・ステージ管理（見込み〜受注/失注）、見積との紐付け | P4-T1 | ✅ PASS・mainマージ完了（マージコミット`8227404`、E2E 51/51・Schema 176/176） |
| P4-T3 | 契約更新連携 | Phase 1の契約更新期限アラート（P1-T4）と営業案件・見積を連携し、更新期限が近い契約から更新提案の案件・見積を起票できるようにする | P4-T1, P4-T2 | ✅ PASS・mainマージ完了（マージコミット`b67b356`、regression 189/189） |
| P4-T4 | 営業ダッシュボード・レポート | 案件パイプライン・見積成約率等の可視化（P2-T4の購買ダッシュボードと同様の設計パターン） | P4-T1, P4-T2, P4-T3 | ✅ PASS・mainマージ完了（マージコミット`f697778`、E2E 81/81・全体194/194）— **Phase 4完了** |

P4-T2以降の詳細タスク分解・実装指示プロンプトは、P4-T1の実装結果を踏まえてClaudeが
都度作成する（Phase 0/1/2/3と同じ方針）。

### 6.4 Phase 4 実装指示プロンプト（Gemini向け）

#### 【指示プロンプト P4-T1】見積書（見積作成・確定・受注転換）

```
# 背景・目的
営業事務Phaseの最初のタスクとして、見積書機能（見積の作成・明細管理・確定・受注転換）を
実装する。本タスクは案件管理（P4-T2）に先行して着手するが、見積は特定の顧客に対して
単独でも発行できる設計とし、案件との紐付けは任意（nullable）とする（P4-T2実装後に
接続する）。

# 前提となる既存実装
- ベースの経理会計基盤（`docs/03_database_design.md`）に既存の顧客マスタ・請求書発行
  テーブルがある前提。これらのテーブル名・スキーマを実装前に確認し、重複する顧客マスタを
  新規に作らないこと。顧客マスタが存在しない場合はその旨を完了報告に明記し、独断で
  スキーマを拡張せず確認を求めること。
- P0-T1: 承認ワークフローエンジン（本タスクでは見積確定自体に承認は必須としないが、
  将来的に高額見積へ承認を追加できるよう、既存エンジンとの接続点を塞がない設計にする）
- Phase 0〜3で確立した設計パターン全般（tenant整合性トリガー、RLS、RBAC三層防御、
  migrationのappend-only・fail-closed運用）

# やってはいけないこと
- 顧客マスタ・請求書発行ロジックをこのタスクで重複実装しない（既存基盤を参照・連携する）。
- `sent`状態（顧客に提示済み）に遷移した見積の金額・明細をUPDATEで書き換え可能にしない
  （本計画書6.2節の原則1）。内容変更が必要な場合は新しいバージョンの見積として追加発行する
  設計にする。
- 同一の見積から複数回「受注転換」処理が実行され、重複した受注・請求データが生成される
  ことを許さない（本計画書6.2節の原則2）。DB制約で多重変換を機械的に防止すること。
- Phase 0〜3で繰り返し指摘・修正された問題（暗黙自動承認、tenant整合性のアプリ層依存、
  RBAC未強制、migration事後書き換え、fail-closedでないデータ検証、DBエラーの握り潰し、
  同時実行race condition、実質何も検証しないテスト、関数は実装されているが実運用経路に
  未接続、object-level authorizationの欠如）のいずれも再発させないこと。

# 実装対象
1. 新規マイグレーションで quotations テーブルを作成する
   （id, tenant_id, customer_id（既存顧客マスタへの参照）, deal_id（nullable、P4-T2で使用）,
   quote_no, status(draft/sent/accepted/rejected/expired), valid_until, subtotal, tax_amount,
   total_amount, version（改訂版発行用の連番）, superseded_by（新バージョンへの参照、
   nullable）等）。RLS（ENABLE + FORCE）、tenant整合性トリガーを実装する。
2. quotation_line_items テーブルを作成する（id, tenant_id, quotation_id, item_name,
   quantity, unit_price, amount等）。RLS、tenant整合性トリガー（quotation_id経由）を実装する。
3. `sent`状態への遷移後はquotationsおよびquotation_line_itemsの金額・明細列への直接
   UPDATEをDBトリガーでfail-closed（例外送出）に禁止する。status自体の遷移
   （sent→accepted/rejected/expired）は許可する。内容変更が必要な場合は、既存見積を
   `superseded_by`で新バージョンにリンクしつつ元レコードは変更しない、という改訂フローを
   実装する。
4. 見積受注転換（`accepted`への遷移と同時に、または別アクションとして）処理を実装し、
   同一quotation_idからの多重変換をDB制約（unique制約または状態チェック）で防止する。
   受注転換後のデータ（受注/請求データ）の具体的な生成先は、既存の請求書発行テーブルとの
   接続点を確認した上で決定し、確認結果を完了報告に含める。
5. quotation.create/view/edit/send/convert のpermissionをRBAC体系に追加し、
   Controller・Service両層でチェックする。
6. 見積作成・明細編集・確定送付・一覧・PDF出力のAPIとフロントエンド画面を実装する。

# 受け入れ基準（Definition of Done）
- [ ] 見積を作成・編集（draft状態のみ）・確定送付（sent）・一覧表示できる
- [ ] `sent`後の見積の金額・明細への直接UPDATEがDBレベルで拒否されることを実DBで確認する
- [ ] 見積の改訂（新バージョン発行）が、旧バージョンを書き換えずに実行できることを確認する
- [ ] 同一見積からの受注転換が一度しか成功しないことを実DBで確認する（2回目はエラー）
- [ ] 他テナントの見積・見積明細が一切見えないことをRLSで確認
- [ ] permissionを持たないロールでは操作できないことを確認
- [ ] migrationがappend-only・fail-closedの原則（本計画書0.4節）に従っている
- [ ] Phase 0で確立した実DB E2E検証基盤で、上記すべてを実PostgreSQL上で確認し、
      結果を報告に添付する
- [ ] 完了報告に正確なコミットSHA（git rev-parse HEAD）・ブランチ名・main...ブランチの
      比較URLを明記する（本計画書0.4節ルール4に従う）
- [ ] feature/p4-t1-quotations ブランチにコミット・pushし、比較URLを報告に含める
      （本計画書0.4節に従う）

# ChatGPTレビュー時の確認観点
- `sent`状態遷移後の金額・明細不変性が、アプリケーション層のバリデーションだけでなく
  DBトリガーで最終防御されているか
- 見積の改訂（新バージョン発行）フローが、既存レコードを一切書き換えずに実装されているか
- 受注転換の多重実行防止がDB制約レベルで担保されているか（アプリ層のフラグチェックのみに
  依存していないか）
- 既存の顧客マスタ・請求書発行テーブルとの統合が、重複実装や責務の奪い合いになっていないか
- Phase 0〜3で繰り返し指摘された問題のいずれかが再発していないか
```

---

#### 【フォローアップ指示プロンプト P4-T1-FIX】REQUEST CHANGES対応（WORMと`superseded_by`更新の矛盾ほか）

ChatGPT(SO)よりP4-T1が「REQUEST CHANGES（現時点）」と判定された。ただしSOは今回、
実コード・migration全文・git diffが未提示であることを理由に**最終判定自体を保留**しており、
明確なBLOCKER確定は1点（WORMと改訂処理の矛盾）、残りは「実コード確認が必要な確認事項」
という位置づけである。以下、優先度順に対応する。

```
# SOレビュー結果：P4-T1 REQUEST CHANGES（現時点・証跡未提示のため最終判定保留）
完了報告の記載内容から、少なくとも1点の仕様矛盾（BLOCKER候補）と、実コードを確認しないと
判定できない複数の確認事項がある。今回は以下の対応と、それを裏付ける証跡の両方を求める。

# BLOCKER-01（最優先）: WORMトリガーと`superseded_by`更新処理が矛盾している
報告では「`sent`以降の見積は金額・顧客・改訂リンク（superseded_by）等の変更をDBトリガーで
拒絶する」とある一方、改訂フローでは「新バージョンを発行し、旧レコードのsuperseded_byを
更新する」ともある。両方が文字通り正しければ、改訂処理自体がWORMトリガーに拒否されて
成立しないはずである。

## 修正方針
「不変」の定義を以下のように明確化し、その通りに実装・文書化すること。
  - 見積の業務内容（customer_id, subtotal, tax_amount, total_amount, currency,
    valid_until, quote_no, 明細行）は、`sent`以降は一切変更不可（WORM）。
  - `superseded_by` は例外として、**NULL → 新バージョンの見積ID への一度きりの遷移**
    のみをDBトリガーで許可する。すでに`superseded_by`が設定済みのレコードへの再UPDATE、
    および任意の値への変更は引き続き拒絶する。
  - この例外を許可する経路を、改訂処理を実行する特定のDB関数・特定のトランザクション
    パターンに限定せず、「NULLから非NULLへの一度きりの遷移」という条件そのものを
    トリガー内で機械的に検証すること（アプリケーション層がこの関数だけを呼ぶという
    運用上の約束に依存しない）。
  - `fn_guard_quotation_immutability`のコード全文と、上記の例外条件をどう実装したかを
    完了報告に含めること。

## 追加すべき実DB E2E（必須）
- 通常のUPDATE文で`sent`後の見積の`superseded_by`を直接書き換えようとして拒否される
  ケース（改訂用の正規経路を通さない場合）
- 改訂処理経由で`superseded_by`がNULLから新バージョンIDへ正しく設定されるケース
- 既に`superseded_by`が設定済みの見積に対し、再度別の値へ変更しようとして拒否される
  ケース

# BLOCKER候補-02: 受注転換時のinvoice自動起票がP4-T1仕様の範囲内か
報告では、`accepted`確定と同時に既存`invoices`/`invoice_lines`へdraft請求書を自動起票
しているとのことである。これはP4-T1の指示プロンプン本文（受注転換後のデータ生成先を
確認の上決定し、報告に含める）で許容されている設計判断であり、**Claude（進行管理）として
この設計自体は仕様内と確認する**。ただし以下を満たすことを条件とする。
  - 自動生成されるinvoiceは必ず`draft`（未確定）状態であり、既存の請求書発行フロー上の
    通常の確認・確定操作を経ないと実際の請求書として発行されないこと（見積の受注転換が
    請求の確定を自動的に意味しないこと）。
  - この設計判断（見積accepted時にdraft invoiceを自動生成する）を完了報告および実装コード
    のコメントに明記し、後から見積・請求それぞれの担当者が意図を追跡できるようにすること。

# 確認事項-03: 受注転換の同時実行（二重転換）耐性
`converted_invoice_id`のUNIQUE制約と`fn_guard_quotation_conversion`により2回目の転換が
DBレベルで拒絶される、という報告内容は方向性として良い。ただし以下を実DB E2Eで確認し、
結果を報告に含めること。
  - 同一見積に対しほぼ同時に2つの転換トランザクションを実行した場合、片方のみが成功し、
    失敗した側のtransactionが完全にrollbackされ、孤立したinvoice/invoice_lineレコードが
    一切残らないこと。

# 確認事項-04: invoice側のtenant_id導出の安全性
見積側のtenant整合性トリガーが堅牢でも、受注転換時に生成される`invoices`/`invoice_lines`
の`tenant_id`が、クライアント入力や別経路からではなく、**変換元の`quotation.tenant_id`
からサーバ側で強制的に導出されている**ことを実装コードで確認し、その旨を報告に明記すること。

# 確認事項-05: send/convertエンドポイントの認証主体
`quotation.send` / `quotation.convert` 等のエンドポイントが、操作主体（承認者・実行者）を
リクエストボディ等のクライアント指定値からではなく、認証済みセッションから強制導出して
いることを確認し、該当コード箇所を報告に明記すること（本計画書0.5節・P3-T3-FIX5で確立した
「client-controlled identityを許さない」パターンと同一の観点）。

# 確認事項-06: WORM対象範囲と明細のfail-closed範囲の網羅性
「金額、顧客、改訂リンク等」という報告の「等」を具体化し、`quotations`テーブルのどの列を
`sent`以降変更禁止としているかを列挙すること。また`quotation_line_items`について、
`sent`以降のINSERT/UPDATE/DELETEの**すべて**がDBトリガー・権限の両方でfail-closedに
なっていることを実DB E2Eで確認し、結果を報告に含めること。

# 確認事項-07: PDF発行における日本語文字の扱い
`pdf-lib`のWinAnsi制約を理由に「ASCII安全なレイアウト」を採用したとのことだが、本システムは
日本語の会計・バックオフィスSaaSであり、見積書に記載される顧客名・商品名・住所・備考等は
日本語であることが前提である。顧客名や商品名をASCII化（ローマ字化・置換等）して出力する
実装は業務要件を満たさない可能性が高い。日本語を含む埋め込みフォント（fontkit等を用いた
CJK対応フォントの埋め込み）へ変更し、日本語の顧客名・商品名がそのままPDFに正しく表示
されることを確認すること。既存のPDF発行機能（給与明細PDF等）がある場合はそのフォント戦略
を参考にし、フォント埋め込み方式の一貫性を検討すること。

# 提出してほしい証跡
上記の修正・確認に加えて、以下を完了報告に添付・記載すること（本計画書0.4節に従い、
コミットSHA・ブランチ名は必須）。
  - `git diff --name-only <P4-T1開始時点のbase>...HEAD`
  - `fn_guard_quotation_immutability` および `fn_guard_quotation_conversion` の
    トリガー関数コード全文
  - 上記の追加E2Eの実行結果（実DB PostgreSQL上）
```

---

#### 【フォローアップ指示プロンプト P4-T1-FIX2】REQUEST CHANGES継続対応（設計は妥当、証跡提出が必須）

ChatGPT(SO)よりP4-T1-FIXの内容は「指摘対応の方向性は妥当。ただし証跡確認前なので
REQUEST CHANGES継続」と判定された。前回7点のうち設計面の懸念（WORM、`superseded_by`
例外、同時実行対策、invoice側tenant導出、認証主体、日本語PDF）は**方向性として妥当と
確認済み**であり、新たな設計変更は求められていない。今回は「説明の追加」ではなく、
**実物の証跡そのもの**を提出する段階である。

```
# SOレビュー結果：P4-T1-FIX REQUEST CHANGES継続（証跡提出が必須）
設計・実装方針についてはSOから前向きな評価を得ている。以下の証跡一式を、次の完了報告に
必ず添付すること。今回はコードの追加変更を求めるものではなく、既存実装の証跡提出が
中心である。ただし1点、実装確認（コード上の確認であり、設計変更ではない）を含む。

# 提出必須の証跡一式
1. `git diff --name-only <P4-T1開始時点のbase>...HEAD` の全文（target files以外への
   変更がないこと、forbidden filesが空であることが分かる形で）
2. `git diff <P4-T1開始時点のbase>...HEAD` の全文（差分そのもの）
3. 以下のファイルの完全なコード（抜粋ではなく全文）
   - `sql/026_quotations.sql`（該当するmigrationファイル。ファイル名が異なる場合は
     実際のファイル名で可）
   - `QuotationsService`（該当ファイルパスの全文）
   - `QuotationsController`（該当ファイルパスの全文）
   - `verify-quotations-e2e.ts`（または相当するE2E検証スクリプトの全文）
   - 関連するDTO・schema定義
4. 「44項目E2E」「162/162 Jest」について、件数の総括だけでなく、**各テスト項目の
   識別名・検証内容・結果（PASS/FAIL）が個別に分かる一覧**（テストコードのdescribe/it名
   と実行ログで足りる）。特に以下の項目が個別にどのテストで検証されているかを明示すること。
   - `superseded_by`：NULLから値への1回限りの遷移が許可されること
   - `superseded_by`：既に値が設定されている場合の再変更が拒否されること
   - `superseded_by`：値からNULLへの巻き戻しが拒否されること
   - `superseded_by`：自己参照（自分自身のIDを設定）が拒否されること
   - `superseded_by`：任意の別IDへの書き換え（改訂経路を通さない場合）が拒否されること
   - `sent`以降の見積本体への直接SQL UPDATEが拒否されること
   - `sent`以降の`quotation_line_items`へのINSERT/UPDATE/DELETEが拒否されること
   - 他テナントの見積に対する受注転換がRLS/tenant整合性チェックで拒否されること
   - リクエストボディ等で偽装した`userId`が無視され、認証セッションの主体が使われること
   - 同時実行による二重転換で、失敗した側のtransactionが`invoice`/`invoice_lines`/
     `quotation`の全変更を含めて完全にrollbackされ、孤立レコードが残らないこと

# 実装確認（設計変更ではなくコード上の確認）
- `quotations`テーブルのWORM対象列（報告にある14列）と、`total_amount`
  （generated column）・`superseded_by`（例外的に許可される1回限りの遷移）の扱いが、
  本計画書6.2節の原則（確定済み見積の業務内容は不変）と矛盾なく整合していることを
  トリガー定義の全文で確認できるようにすること。
- `send` / `convert` / `accept` / `revise` の各操作が同一の認証主体取得ロジック
  （例: `requireUserId()`相当）を使用しており、`created_by`・`approved_by`相当の値を
  クライアント入力で上書きできないことを、該当する4箇所それぞれのコードで確認できるように
  すること。
- 同時実行時のロック範囲が、SELECT...FOR UPDATEから invoice/invoice_lines への
  INSERT・quotationへのUPDATE・COMMITまで、単一トランザクション内に収まっていることを
  該当コードで確認できるようにすること。

# 受け入れ基準（Definition of Done）
- [ ] 上記の証跡一式（diff、コード全文、E2E個別結果一覧）が完了報告に添付されている
- [ ] 上記の実装確認3点が、コードの該当箇所を示す形で報告に明記されている
- [ ] target files以外の変更がないこと、forbidden filesへの変更がないことがdiffから
      確認できる
- [ ] コミットSHA・ブランチ名（本計画書0.4節）が明記されている

なお、今回のFIX2は新たな仕様変更・設計変更を求めるものではないため、証跡の提出のみで
対応可能であれば、コードの追加変更は不要である。証跡確認の結果、実際には設計通りに
実装されていないことが判明した場合に限り、次のFIX3で個別に修正を求める。
```

---

#### 【フォローアップ指示プロンプト P4-T1-FIX3】REQUEST CHANGES対応（`superseded_by`の正当性がDB未検証というBLOCKER）

ChatGPT(SO)よりP4-T1-FIX2は「証跡不足はほぼ解消。ただし実装確認の結果、新たなBLOCKERが
1点発見された」と判定された。今回は前回までと異なり、**証跡提出ではなく実際のコード修正が
必要**である。

```
# SOレビュー結果：P4-T1-FIX2 REQUEST CHANGES（新規BLOCKER: superseded_byの正当性未検証）
証跡提出・前回までの懸念（同時転換、tenant導出、認証主体、日本語PDF等）はすべて解消と
確認された。ただし実装コードそのものを確認した結果、WORM triggerに以下の欠陥が見つかった。

# BLOCKER-01: `superseded_by`が「正規の改訂先」であることをDBが検証していない
現在のtriggerは、NULL→非NULLの遷移かどうか、tenantが一致するか、既設定後の再変更でないか
のみを見ており、**参照先が「本当にこの見積のv+1改訂版として発行されたレコードか」を
検証していない**。このため、同一tenant内の無関係な既存見積のIDを直接SQLで`superseded_by`
に設定することがDBレベルで可能になってしまっている。また`superseded_by`列に
UNIQUE制約がなく、複数の旧見積が同じ新見積を指す状態も作成可能である。

これは「DBを最終防御とする」という本計画書0.5節の方針、および本Phaseの設計原則
（6.2節：確定済み見積の不変性・改訂は正規の一本のリンクのみ）に反する。

# 修正方針
1. `superseded_by`列に、NULLを除外した部分UNIQUE制約（例:
   `CREATE UNIQUE INDEX ... ON quotations (superseded_by) WHERE superseded_by IS NOT NULL`）
   を新規migrationで追加する。これにより、複数の旧見積が同一の新見積を指す状態を
   構造的に排除する。
2. WORMトリガー内で、`OLD.superseded_by IS NULL AND NEW.superseded_by IS NOT NULL`の
   遷移が発生した際、NEW.superseded_byが参照する見積（以下「target」）について、
   以下をすべて満たすことをDB側で検証し、満たさない場合は例外を発生させて拒絶する。
   - target.tenant_id = OLD.tenant_id（既存の検証を維持）
   - target.quote_no = OLD.quote_no（同一見積番号の改訂版であること）
   - target.version = OLD.version + 1（version値がちょうど1つ進んだ版であること）
   上記の照合により、「無関係な既存見積」を`superseded_by`として直接設定することを
   構造的に排除する。
3. 既存のmigrationファイルは書き換えず、新しいmigrationファイルを追加してトリガー関数を
   `CREATE OR REPLACE FUNCTION`で更新すること（本計画書0.4節：migrationのappend-only原則）。

# 追加すべき実DB E2E（必須）
- 同一tenant内に無関係な既存見積（quote_noが異なる、またはversionがOLD.version+1でない
  見積）が存在する状態で、`sent`状態の見積に対し直接SQLで`superseded_by`をその無関係な
  見積のIDに設定しようとして、DB側で拒絶されること
- 正規のrevise()フロー（quote_no同一・version+1）による`superseded_by`設定は引き続き
  成功すること（既存の47項目E2Eの回帰確認）
- 複数の旧見積から同一の新見積IDへ`superseded_by`を設定しようとした場合、2件目がUNIQUE
  制約違反で拒絶されること

# BLOCKER候補-02（要確認）: `converted_invoice_id`の参照先が「この見積から生成されたinvoice」であることの保証
現状のtriggerは、初回設定であること・statusがsent/acceptedであること・tenant整合性が
あることのみを検証しており、参照先invoiceが「本当にこの見積の受注転換によって生成された
invoiceか」（同一tenantの無関係な既存invoiceではないか）を検証していない。
この点について、以下のいずれかの対応を行い、選択した理由を完了報告に明記すること。
   - (a) `invoices`テーブルに、この見積由来のinvoiceであることを示す参照列
     （例: `source_quotation_id`、nullable、UNIQUE）を追加し、`converted_invoice_id`
     設定時にDBトリガーで`target.source_quotation_id = quotation.id`を照合する。
   - (b) 既存の`invoices`テーブル設計上、上記(a)相当の情報が既に別の形で存在している
     場合は、それを用いて同様の照合を行う。
   - (c) 上記のいずれも実施しない場合は、その理由（例: invoicesテーブルを一切変更しない
     方針の妥当性）を明記し、Claude（進行管理）の判断を求める。

# 受け入れ基準（Definition of Done）
- [ ] `superseded_by`のUNIQUE制約（NULL除外）が追加されている
- [ ] `superseded_by`のNULL→非NULL遷移時に、target.quote_no・target.versionの整合性が
      DBトリガーで検証されることを実DB E2Eで確認する
- [ ] 無関係な既存見積への直接SQLリンクが拒絶されることを実DB E2Eで確認する
- [ ] 既存47項目E2Eすべてが引き続きPASSすること（回帰確認）
- [ ] BLOCKER候補-02について、(a)(b)(c)いずれかの対応・判断を報告に明記する
- [ ] migrationがappend-only（既存ファイルの書き換えなし）であることをdiffで確認できる
- [ ] コミットSHA・ブランチ名（本計画書0.4節）を明記する
- [ ] `git diff --name-only <FIX2完了時点>...HEAD`を報告に含め、target files以外への
      変更がないことを示す

# ChatGPTレビュー時の確認観点
- `superseded_by`の正当性検証が、quote_no・versionの照合という構造的な条件でDB側で
  機械的に保証されているか（アプリ層のrevise()関数だけが正しく呼ばれるという運用上の
  前提に依存していないか）
- UNIQUE制約により「複数の旧見積が同一の新見積を指す」状態が排除されているか
- 追加した検証が、既存の正規revise()フローを妨げていないか（回帰E2Eで確認）
- BLOCKER候補-02への対応が、選択した方針に対して十分な根拠を持っているか
```

---

#### 【フォローアップ指示プロンプト P4-T1-FIX4】REQUEST CHANGES対応（`invoices.source_quotation_id`の後発改変防止が未確認）

ChatGPT(SO)よりP4-T1-FIX3は「`superseded_by`のBLOCKERは解消方向。ただし新たに追加した
`invoices.source_quotation_id`について、設定時の整合性は確認できたが、設定後の改変・
NULL化を防ぐDB防御が未確認」と判定された。`superseded_by`については今回SOから
「再度掘り下げる必要はない」と明言されているため、対応不要。

```
# SOレビュー結果：P4-T1-FIX3 REQUEST CHANGES（残る確認ポイント: invoices.source_quotation_idの後発改変防止）
`superseded_by`に関するBLOCKERはFIX3で解消と評価された（対応不要）。一方、FIX3で新規に
追加した`invoices.source_quotation_id`（見積→invoice逆参照）について、初期設定時の整合性
（`converted_invoice_id`設定時に対象invoiceの`source_quotation_id`が当該見積のidと一致
することの検証）は確認できたが、**一度設定された`source_quotation_id`が後から
UPDATE・NULL化されても防御されるか**が報告に含まれていない。双方向リンクの片側だけ
不変性を保証しても、もう片側を後から書き換えれば整合性が壊れるため、これはBLOCKERとして
扱う。

# BLOCKER: `invoices.source_quotation_id`の後発改変を防ぐDB防御が未実装（または未確認）
`quotations.superseded_by`・`quotations.converted_invoice_id`に対して確立した
「一度設定されたら不変（WORM）」という原則を、`invoices.source_quotation_id`にも
同様に適用すること。

# 修正方針
1. `invoices`テーブルに対するトリガー（既存のinvoice側WORM/ガードトリガーがあれば
   それを拡張し、なければ新規に追加）で、以下を検証し違反時は例外を発生させて拒絶する。
   - `OLD.source_quotation_id IS NOT NULL AND NEW.source_quotation_id IS DISTINCT FROM
     OLD.source_quotation_id` の場合（別quotationへの付け替え、またはNULLへの巻き戻しの
     いずれも含む）は拒絶する。
2. `invoices.source_quotation_id`にも、NULLを除外した部分UNIQUE制約を追加し、複数の
   invoiceが同一quotationを指す状態（または1つのinvoiceが複数quotationに紐付く矛盾）を
   構造的に排除する（`quotations.converted_invoice_id`側のUNIQUE制約と対で、双方向
   一対一の関係をDB構造として保証する）。
3. 既存のmigrationファイル（026, 027）は書き換えず、新しいmigrationファイル
   （例: `sql/028_invoice_source_quotation_guard.sql`）を追加すること
   （本計画書0.4節：migrationのappend-only原則）。
4. 027で追加した`invoices.source_quotation_id`列が、既存の（本Phase以前からある）
   invoiceレコードに対して安全に適用されていること（nullable列としてのADD COLUMNであり、
   既存データへのNOT NULL制約やbackfill要件による失敗が発生しないこと）を、完了報告で
   改めて明記すること。

# 追加すべき実DB E2E（必須）
- 受注転換によって`source_quotation_id`が設定済みのinvoiceに対し、直接SQLで
  `source_quotation_id`を別のquotation IDへUPDATEしようとして拒絶されること
- 上記と同じ状況で`source_quotation_id`をNULLへUPDATEしようとして拒絶されること
- 既存の52項目E2E（前回FIX3分）が引き続きすべてPASSすること（回帰確認）
- 新規追加したUNIQUE制約により、2つ目のinvoiceが同一quotationの`source_quotation_id`
  として設定されようとした場合に拒絶されること

# 受け入れ基準（Definition of Done）
- [ ] `invoices.source_quotation_id`の後発UPDATE・NULL化がDBトリガーで拒絶されることを
      実DB E2Eで確認する
- [ ] `invoices.source_quotation_id`に部分UNIQUE制約（NULL除外）が追加されている
- [ ] 既存52項目E2Eがすべて引き続きPASSする（回帰確認）
- [ ] 027で追加した列の既存データへの適用安全性を報告に明記する
- [ ] migrationがappend-only（026, 027を書き換えず、新規ファイルのみ追加）であることを
      diffで確認できる
- [ ] コミットSHA・ブランチ名（本計画書0.4節）を明記する
- [ ] `git diff --name-only <FIX3完了時点>...HEAD`を報告に含める

# ChatGPTレビュー時の確認観点
- `invoices.source_quotation_id`の不変性が、`quotations.superseded_by`・
  `converted_invoice_id`と同水準のDBトリガー（アプリ層の運用ルールに依存しない）で
  保証されているか
- 双方向リンク（quotation⇄invoice）の両側にUNIQUE制約と不変性トリガーが対称に適用され、
  片側だけを後から書き換えて整合性を破壊する経路が残っていないか
- 新規migrationがappend-onlyであり、026・027を書き換えていないか
```

---

#### 【フォローアップ指示プロンプト P4-T1-VERIFY】CONDITIONAL PASS対応（証跡確認のみ・新規BLOCKERなし）

ChatGPT(SO)よりP4-T1-FIX4は「CONDITIONAL PASS」と判定された。設計・実装上の主要な
未解決点（`superseded_by`の正当性、`invoices.source_quotation_id`の後発改変防止）は
FIX3・FIX4で解消済みと評価されており、**新たなBLOCKERは報告内容からは見当たらない**。
残るのは、`converted_invoice_id`側の既存ガード（FIX3で実装済み）が、FIX4の双方向リンク
設計と組み合わせても実際に成立していることを、テストコード・実行ログ・SQL実体で最終確認
することのみである。

```
# SOレビュー結果：P4-T1-FIX4 CONDITIONAL PASS（証跡確認のみで最終PASS判定可能）
設計上のBLOCKERはFIX3・FIX4で解消済みと評価されている。以下の証跡を提示すれば、
コードの追加変更なしに最終PASS判定に進める可能性がある。

# 提出必須の証跡
1. `sql/027_quotation_revision_and_conversion_guards.sql`および
   `sql/028_invoice_source_quotation_guard.sql`の完全なコード全文
2. 55項目E2Eのうち、以下の観点を検証しているテストの該当箇所（テスト名・検証内容・結果）
   - `quotations.converted_invoice_id`が設定済みの状態から、直接SQLで別のinvoiceへの
     変更を試みて拒絶されること（FIX3のガードが、FIX4で追加した双方向リンクの状態でも
     引き続き機能していることの確認）
   - `quotations.converted_invoice_id`を設定済みの状態からNULLへUPDATEしようとして
     拒絶されること
   - `invoices.source_quotation_id`の別quotationへの付け替え拒絶
   - `invoices.source_quotation_id`のNULLへのrollback拒絶
   - 同一quotationに対する2件目のinvoiceでの`source_quotation_id`設定がUNIQUE制約で
     拒絶されること
3. `git diff --name-only <FIX4開始時点のbase>...HEAD`（target files以外の変更がないこと
   の確認用）

# 受け入れ基準（Definition of Done）
- [ ] 上記のSQLファイル全文が完了報告に添付されている
- [ ] 上記5項目の該当E2Eテストが個別に識別できる形（テスト名・検証内容・結果）で提示
      されている
- [ ] `converted_invoice_id`側のFIX3ガードが、双方向リンクの状態でも実際に機能して
      いることが証跡から確認できる
- [ ] コミットSHA・ブランチ名（本計画書0.4節）が明記されている（追加変更がない場合は
      FIX4完了時点と同一のSHAでよい）

なお、本プロンプトは新たな設計変更・コード修正を求めるものではない。証跡の提示のみで
上記が確認できれば、Claude（進行管理）はその内容を整理してChatGPT(SO)に再提示し、
最終PASS判定を経てマージ指示プロンプトの作成に進む。証跡確認の結果、実際にはガードが
機能していないことが判明した場合に限り、P4-T1-FIX5として個別に修正を求める。
```

---

#### 【マージ指示プロンプト P4-T1】mainへのマージ（SO正式PASS）

ChatGPT(SO)よりP4-T1-VERIFYが**PASS**と正式判定された。前回のCONDITIONAL PASSで
求めていた5項目の証跡（`converted_invoice_id`の別invoice変更拒否・NULL rollback拒否、
`source_quotation_id`の付け替え拒否・NULL rollback拒否、同一quotationへの2件目invoice
拒否）がテスト単位（10.3b, 10.3c, 10.4, 10.5, 10.6）で確認され、SOは「双方向リンクを
後から壊せるのではないかという懸念は解消された」と明言している。FIX2〜FIX4を通じて、
サービス層の実装だけでなくDB制約・トリガーによる最終防御まで段階的に確立できたことが
PASSの根拠である。

```
# マージ指示：P4-T1（見積書：見積作成・確定・受注転換）
ChatGPT(SO)がP4-T1を正式PASSと判定した。以下の手順でmainへマージすること。

# PASS根拠の要約（完了報告に転記・保持すること）
- WORM（確定済み見積の不変性）：`sent`以降の見積本体・明細の変更をDBトリガーでfail-closed
  に拒否することを確認済み
- `superseded_by`（改訂リンク）：tenant一致・quote_no一致・version+1・多重参照防止・
  再設定防止・NULL rollback防止をすべてDB制約・トリガーで保証
- `converted_invoice_id`（受注転換）：一回限りの設定・別invoiceへの変更拒否・NULL
  rollback拒否をDBで保証、UNIQUE制約で多重転換を防止
- `invoices.source_quotation_id`（逆参照）：初期設定時の整合性検証、後発の付け替え・
  NULL rollback拒否、UNIQUE制約による1:1保証
- 同時実行（二重転換）耐性：`SELECT ... FOR UPDATE`による単一トランザクション内ロック、
  失敗側の完全rollbackを実DB E2Eで確認
- invoice側tenant_id：クライアント入力ではなく変換元見積のtenant_idからサーバ側で導出
- 認証主体：send/convert等の操作主体はクライアント指定値ではなく認証済みセッションから
  導出
- 日本語PDF：`fontkit` + IPAexゴシックにより顧客名・品名等の日本語描画を実証
- migration：026〜028がすべてappend-only（既存ファイルの書き換えなし）
- 実DB E2E 57/57、Schema 169/169、clean DB 001〜028、TypeScript型チェック・本番ビルド
  すべてPASS

# マージ手順
1. `feature/p4-t1-quotations`ブランチ（および関連するFIX2〜FIX4のコミット）をmainへ
   マージする。
2. マージコミットのSHA（`git rev-parse HEAD`）を記録する。
3. マージ後、mainブランチ上でclean DBへのmigration一括適用（001〜028）を再実行し、
   実DB E2E（57項目）が引き続きすべてPASSすることを確認する（本計画書0.4節：push前の
   報告は完了とみなさない、Phase 0〜3で確立した「main実DB E2E再実行」の原則を踏襲）。
4. 完了報告には、マージコミットSHA・mainブランチでの再検証結果（E2E件数・PASS件数）を
   必ず明記すること。

# 受け入れ基準（Definition of Done）
- [ ] mainへのマージが完了し、マージコミットSHAが報告に明記されている
- [ ] マージ後、main上で001〜028のclean DB migration適用が成功する
- [ ] マージ後、main上で実DB E2E 57/57（または相当件数）がすべてPASSする
- [ ] 上記結果を完了報告に明記する
```

---

#### 【指示プロンプト P4-T2】案件管理（商談パイプライン）

P4-T1が正式PASS・マージ済みとなったことを受け、案件管理（商談パイプライン）タスクの
詳細を分解する。P4-T1で用意した`quotations.deal_id`（nullable、WORM対象列の一部）を
実際に活用し、案件と見積を紐付ける。

```
# 背景・目的
営業事務Phaseの2番目のタスクとして、案件（商談）管理機能を実装する。案件は見積とは異なり、
確定後も内容を書き換え続ける「進行中の業務レコード」であり、見積のWORM設計とは異なる
設計方針（terminal状態（受注/失注）以外は編集可能）を採る。

# 前提となる既存実装
- P4-T1: `quotations`テーブル（`deal_id`列はnullableかつWORM対象列の一部として既に
  存在する。本タスクでは`quotations`側のmigration・トリガーを変更せず、`deals`テーブルの
  新規作成と、`quotations.deal_id`へのFK制約追加のみを行う）
- 既存の顧客マスタ（P4-T1で確認済みのテーブル）
- Phase 0〜3で確立した設計パターン全般（tenant整合性トリガー、RLS、RBAC三層防御、
  migrationのappend-only・fail-closed運用、terminal状態からの遷移禁止パターン
  ※P3給与計算のfinalizedパターン等を参照）

# やってはいけないこと
- `quotations`・`quotation_line_items`の既存migrationファイル（026〜028）を書き換えない。
  `quotations.deal_id`へのFK制約は新規migrationファイルで追加する。
- `quotations`のWORM対象列（`deal_id`を含む）の不変性ルールを本タスクで変更・緩和しない。
- 案件が`won`（受注）または`lost`（失注）のterminal状態に達した後、stageやその他の業務
  列が変更できてしまう状態を許さない（fail-closedでDB防御する）。
- Phase 0〜4で繰り返し指摘・修正された問題（暗黙自動承認、tenant整合性のアプリ層依存、
  RBAC未強制、migration事後書き換え、fail-closedでないデータ検証、DBエラーの握り潰し、
  同時実行race condition、実質何も検証しないテスト、client-controlled identity、
  object-level authorizationの欠如）のいずれも再発させないこと。

# 実装対象
1. 新規マイグレーションで`deals`テーブルを作成する
   （id, tenant_id, customer_id（既存顧客マスタへの参照）, title, stage
   (lead/qualified/proposal/negotiation/won/lost), expected_amount, currency_code,
   expected_close_date, owner_user_id, lost_reason（nullable、lostの場合のみ使用）,
   closed_at（nullable）, created_by, created_at, updated_at等）。RLS（ENABLE + FORCE）、
   tenant整合性トリガーを実装する。
2. `stage`が`won`または`lost`に達した後、当該レコードのstage・業務列への変更をDBトリガー
   でfail-closedに拒否する（terminal状態からの遷移禁止。P3給与のfinalizedパターンを参照）。
   `closed_at`はterminal状態遷移時にDBトリガーまたはデフォルトで設定する。
3. `quotations.deal_id`に対し、`deals.id`への外部キー制約を新規migrationで追加する
   （既存の`quotations`レコードは`deal_id`がNULLのままで問題なく、既存データへの影響が
   ないことを確認・報告する）。
4. deal.create/view/edit/close のpermissionをRBAC体系に追加し、Controller・Service両層で
   チェックする。
5. 案件の作成・編集（terminal状態以外）・クローズ（won/lostへの遷移、lost時は
   lost_reason必須）・一覧・詳細のAPIとフロントエンド画面を実装する。
6. 案件詳細画面から、紐づく見積（`quotations.deal_id = deals.id`）の一覧を表示できるように
   する。既存の見積一覧・詳細APIを呼び出すのみとし、見積側のロジックを重複実装しない。

# 受け入れ基準（Definition of Done）
- [ ] 案件の作成・編集・一覧・詳細表示ができる
- [ ] `won`/`lost`への遷移後、stage・業務列への変更が実DBで拒否されることを確認する
- [ ] `lost`への遷移時に`lost_reason`が必須であることを確認する
- [ ] `quotations.deal_id`へのFK制約が既存データに影響を与えないことを確認する
- [ ] 他テナントの案件が一切見えないことをRLSで確認する
- [ ] permissionを持たないロールでは操作できないことを確認する
- [ ] 案件詳細画面から紐づく見積一覧が正しく表示されることを確認する
- [ ] migrationがappend-only・fail-closedの原則（本計画書0.4節）に従っている
- [ ] Phase 0で確立した実DB E2E検証基盤で、上記すべてを実PostgreSQL上で確認し、
      結果を報告に添付する
- [ ] 完了報告に正確なコミットSHA・ブランチ名・main...ブランチの比較URLを明記する
      （本計画書0.4節ルール4）
- [ ] feature/p4-t2-deals ブランチにコミット・pushし、比較URLを報告に含める

# ChatGPTレビュー時の確認観点
- terminal状態（won/lost）からの変更がDBトリガーで最終防御されているか（アプリ層の
  バリデーションのみに依存していないか）
- `quotations.deal_id`のFK制約追加が、既存のWORM設計・既存データに影響を与えていないか
- tenant整合性・RBAC・認証主体がPhase 0〜4で確立したパターンと一貫しているか
- 案件詳細画面の見積一覧表示が、見積側の実装を重複させていないか
```

---

#### 【フォローアップ指示プロンプト P4-T2-VERIFY】CONDITIONAL PASS対応（設計確認1点＋証跡確認4点）

ChatGPT(SO)よりP4-T2は「CONDITIONAL PASS」と判定された。terminal状態（won/lost）の
DB最終防御・tenant分離・`quotations.deal_id`連携等の主要設計は妥当と評価されており、
**実装をやり直すべき明確なBLOCKERは見当たらない**。今回は1点の設計意図の明確化と、
4点の証跡確認・コード確認が必要である。

```
# SOレビュー結果：P4-T2 CONDITIONAL PASS（設計確認1点＋証跡確認4点）

# 設計確認-01（Claudeからの回答）: 通常ステージ間の遷移順序について
SOより「lead→qualified→proposal→negotiation→won/lostという正規遷移だけを許可している
のか、DBで保証されているのか」という確認があった。

**Claude（進行管理）としての設計方針を以下に明記する。** 本タスク（P4-T2）の元の指示
プロンプトでは、terminal状態（won/lost）からの変更禁止のみを要求しており、非terminal
ステージ間（lead/qualified/proposal/negotiation）の遷移順序を厳密な一方向のみに制限する
ことは要求していない。実務上、商談は`negotiation`から`qualified`に戻る、`lead`から
直接`negotiation`に進む等、非線形に移動することが一般的であるため、**非terminal
ステージ間の遷移は自由（DBによる順序制限なし）とし、terminal状態への遷移のみを
一方向・不可逆として保護する、という設計を正式な仕様とする**。

Geminiは、この設計方針が現在の実装と一致していることを確認し、以下を完了報告に追加
すること。
  - 非terminalステージ間の任意の遷移（後退・スキップを含む）が意図的に許可されている
    ことを示すE2Eテスト（例: `negotiation`→`qualified`への後退が成功する等）を追加する。
  - この設計方針を、実装コードのコメントまたはドキュメントに明記する。

# 証跡確認-02: `owner_user_id`のFK・tenant境界の実装詳細
以下を完了報告に明記すること。
  - `owner_user_id`が`users.id`へのFK制約を持つこと（コード該当箇所を提示）
  - `owner_user_id`のtenant整合性チェック（`users.tenant_id = deals.tenant_id`）がDB
    トリガーで検証されていることをコードで確認できるようにする
  - NULL許容かどうか、および担当者変更時の制約範囲を明記する
  - 追加E2E: 存在しないuser_idの指定が拒否されること、別tenantのuser_idの指定が拒否
    されること（別tenant拒否は確認済みとのことだが、テストコードの該当箇所を明示する）

# 証跡確認-03: 認証actorの実装確認
`deal.close`等の重要操作について、実際の操作主体（`created_by`・`owner_user_id`・
`updated_by`・`closed_by`相当の値）が、クライアント指定値ではなく認証済みセッションから
強制導出されていることを、該当コード箇所（Controller・Serviceの認証コンテキスト取得部分）
を示して確認すること。特に`deal.close`エンドポイントについて、リクエストボディで
`userId`等を偽装しても無視されることをE2Eで確認し、該当テストを明示すること。

# 証跡確認-04: `closed_at`の後発改変防止
terminal状態（won/lost）への遷移後、`closed_at`列への直接UPDATE（別の値への変更、または
NULLへの巻き戻し）がDBトリガーで拒絶されることを、「業務列変更禁止」の対象列一覧に
`closed_at`が明示的に含まれているかを示すコードとともに確認すること。追加E2E
（`closed_at`の直接UPDATE拒否、NULL rollback拒否）を実施し、結果を報告に含めること。

# 証跡確認-05: git diffの変更スコープ
`git diff --name-only <P4-T2開始時点のbase>...HEAD`の全文を提出すること。特に
`quotations.service.ts`・`quotation.schemas.ts`・`permissions.guard.ts`等の既存
ファイルへの変更が、`deal_id`絞り込み・deal権限マッピングの追加に限定されており、
既存のP4-T1機能（WORM・改訂・受注転換ロジック）に影響を与えていないことを、該当diffの
抜粋で示すこと（P4-T1の57項目E2Eが引き続きPASSしていることは既に確認済みだが、diffの
スコープそのものも確認する）。

# 受け入れ基準（Definition of Done）
- [ ] 設計確認-01の方針が実装と一致していることを確認し、対応するE2Eテストと文書コメントを
      追加する
- [ ] 証跡確認-02〜05のすべてについて、該当コード・該当テスト・git diffを完了報告に
      明記する
- [ ] 既存41項目E2E・P4-T1回帰57項目E2Eが引き続きすべてPASSする
- [ ] コミットSHA・ブランチ名（本計画書0.4節）を明記する（追加変更がない場合は既存SHAで
      よいが、E2E追加やコメント追加がある場合は新しいコミットとして明記する）

なお、本プロンプトのうち証跡確認-02〜05は新たな設計変更を求めるものではなく、確認と
不足分のE2E追加が中心である。確認の結果、実際に防御が機能していないことが判明した場合に
限り、P4-T2-FIXとして個別に修正を求める。
```

---

#### 【マージ指示プロンプト P4-T2】mainへのマージ（SO正式PASS）

ChatGPT(SO)よりP4-T2-VERIFYが**PASS**と正式判定された。前回のCONDITIONAL PASSで求めた
5点（非terminalステージ遷移の設計意図確認、`owner_user_id`のFK/tenant境界、認証actor
実装、`closed_at`後発改変防止、git diffスコープ）すべてについて実DB証跡が提出され、
SOは「追加FIXを要求する理由は現時点ではない」と明言している。

```
# マージ指示：P4-T2（案件管理：商談パイプライン）
ChatGPT(SO)がP4-T2を正式PASSと判定した。以下の手順でmainへマージすること。

# PASS根拠の要約（完了報告に転記・保持すること）
- terminal状態（won/lost）：DELETE拒否・stage逆戻り拒否・`closed_at`を含む業務列の
  全面UPDATE拒否をDBトリガーで保証
- 非terminalステージ間：意図的に自由遷移（前進・後退・スキップ許容）とする設計方針を
  Claudeが確定し、E2Eで検証済み
- tenant分離：RLS ENABLE+FORCE、`owner_user_id`のFK・tenant境界をDBトリガーで保証
- 認証actor：`deal.create`/`deal.close`等の操作主体を認証済みセッション
  （`req.user.sub`）から強制導出、偽装入力を実DBで拒否確認
- `quotations.deal_id`連携：FK（ON DELETE RESTRICT）、別tenant deal拒否、案件削除時の
  紐づく見積存在チェックを確認
- P4-T1回帰：57/57 E2E継続PASSを確認（案件管理追加による見積機能への影響なし）
- 実DB E2E 51/51、Schema 176/176、clean DB 001〜029、Backend 223/223、Frontend build
  すべてPASS

# マージ手順
1. `feature/p4-t2-deals`ブランチ（および関連するVERIFYのコミット）をmainへマージする。
2. マージコミットのSHA（`git rev-parse HEAD`）を記録する。
3. マージ後、mainブランチ上でclean DBへのmigration一括適用（001〜029）を再実行し、
   実DB E2E（P4-T1 57項目・P4-T2 51項目）が引き続きすべてPASSすることを確認する。
4. **この機会に、P4-T1のマージが実際に完了しているか（マージコミットSHA）も併せて
   確認・報告すること。** P4-T2の開発がP4-T1マージ後のmainを土台にしていることは
   P4-T1回帰E2Eの実行から推測されるが、明示的なコミットSHAの報告を本計画書0.4節に
   従って改めて記録する。
5. 完了報告には、P4-T1・P4-T2それぞれのマージコミットSHA・mainブランチでの再検証結果
   （E2E件数・PASS件数）を必ず明記すること。

# 受け入れ基準（Definition of Done）
- [ ] P4-T1・P4-T2それぞれのマージコミットSHAが報告に明記されている
- [ ] マージ後、main上で001〜029のclean DB migration適用が成功する
- [ ] マージ後、main上で実DB E2E（P4-T1 57項目・P4-T2 51項目）がすべてPASSする
- [ ] 上記結果を完了報告に明記する
```

---

#### 【指示プロンプト P4-T3】契約更新連携

P4-T2が正式PASSとなったことを受け、Phase 4の3番目のタスク（契約更新連携）の詳細を
分解する。本タスクはPhase 1で構築した契約更新期限アラート（P1-T4）と、P4-T1（見積書）・
P4-T2（案件管理）を連携させる。

```
# 背景・目的
Phase 1で構築した契約更新期限アラート（P1-T4）は、契約の更新期限が近づいたことを検知
するが、その後の営業アクション（更新提案の商談化・見積作成）は手作業だった。本タスクでは、
アラートから既存の案件（P4-T2）・見積（P4-T1）の作成へワンクリックで繋げられるようにし、
どのアラートからどの案件・見積が起票されたかを追跡できるようにする。

# 前提となる既存実装
- P1-T4: 契約更新期限アラート（テーブル・バッチ処理・API）。本タスクではこのアラート
  エンジン自体・契約管理のmigrationを変更しない。
- P4-T1: `quotations`（WORM設計、`deal_id`列を含む）
- P4-T2: `deals`（terminal状態のDB防御、tenant整合性、RBAC）
- Phase 0〜4で確立した設計パターン全般（tenant整合性トリガー、RLS、RBAC三層防御、
  migrationのappend-only・fail-closed運用、AI提案→人間承認→確定の三段構成）

# やってはいけないこと
- P1-T4のアラートエンジン・契約管理関連の既存migrationファイルを書き換えない。連携用の
  テーブルは新規migrationファイルで追加する。
- アラートから案件・見積が**人間の操作（ボタン押下）を介さずに自動生成・自動確定**される
  設計にしない。あくまで人間が「更新提案の案件を作成する」を明示的に実行した結果として
  記録される設計とする（0.2節のAI提案→人間承認→確定の三段構成を踏襲。本タスクにAI提案
  要素はないが、「人間の明示的操作なしに業務レコードが生成されない」という原則は同じ）。
- P4-T1のWORM設計・P4-T2のterminal設計を本タスクで変更・緩和しない。
- 契約（contract）エンティティやアラート機能を重複実装しない。既存のP1-T4 APIを呼び出す
  のみとする。
- Phase 0〜4で繰り返し指摘・修正された問題（暗黙自動承認、tenant整合性のアプリ層依存、
  RBAC未強制、migration事後書き換え、fail-closedでないデータ検証、DBエラーの握り潰し、
  同時実行race condition、実質何も検証しないテスト、client-controlled identity、
  object-level authorizationの欠如）のいずれも再発させないこと。

# 実装対象
1. 新規マイグレーションで`contract_renewal_links`テーブルを作成する
   （id, tenant_id, contract_id（既存contractsテーブルへの参照）, deal_id（`deals`への
   参照、nullable）, quotation_id（`quotations`への参照、nullable）, created_by,
   created_at等）。RLS（ENABLE + FORCE）、tenant整合性トリガーを実装する。
2. 契約更新期限アラート一覧・詳細画面（既存のP1-T4 API）に、「更新提案の案件を作成」
   ボタンを追加する。押下すると、当該契約の顧客情報を引いた`deals`レコードを`lead`
   ステージで新規作成し（P4-T2の既存APIを呼び出すのみとし、`deals`側のロジックを重複
   実装しない）、`contract_renewal_links`にリンクを記録する。
3. 案件詳細画面・見積作成画面から、その案件がどの契約の更新に紐づくか（該当する場合）を
   表示できるようにする。
4. `contract_renewal_link.create`のpermissionをRBAC体系に追加し、Controller・Service
   両層でチェックする。

# 受け入れ基準（Definition of Done）
- [ ] 契約更新アラートから「更新提案の案件を作成」を実行すると、`deals`レコードが作成され、
      `contract_renewal_links`にリンクが記録される
- [ ] 案件詳細画面から、紐づく契約情報が表示される
- [ ] 他テナントの契約・案件・見積が一切見えないことをRLSで確認する
- [ ] permissionを持たないロールでは操作できないことを確認する
- [ ] P1-T4（契約更新アラート）・P4-T1（見積）・P4-T2（案件）の既存migration・既存E2E
      （回帰）に影響がないことを確認する
- [ ] migrationがappend-only・fail-closedの原則（本計画書0.4節）に従っている
- [ ] Phase 0で確立した実DB E2E検証基盤で、上記すべてを実PostgreSQL上で確認し、
      結果を報告に添付する
- [ ] 完了報告に正確なコミットSHA・ブランチ名・main...ブランチの比較URLを明記する
      （本計画書0.4節ルール4）
- [ ] feature/p4-t3-contract-renewal-link ブランチにコミット・pushし、比較URLを報告に
      含める

# ChatGPTレビュー時の確認観点
- 案件・見積の作成が人間の明示的操作（ボタン押下）を経ており、アラートから自動的に
  確定状態のレコードが生成されていないか
- `contract_renewal_links`のtenant整合性・RLSがDBで保証されているか
- P1-T4・P4-T1・P4-T2の既存実装・既存migrationを重複実装・書き換えしていないか
- 既存E2E（P1-T4・P4-T1・P4-T2）が回帰していないか
```

---

#### 【フォローアップ指示プロンプト P4-T3-VERIFY】CONDITIONAL PASS対応（設計確定4点＋実装追加＋証跡確認）

ChatGPT(SO)よりP4-T3は「CONDITIONAL PASS。明確なBLOCKERは見当たらないが、リンクの
正当性・不変性・作成主体・既存データとの関係を最終確認したい」と判定された。うち複数点は
本タスクの元の指示プロンプトで仕様として明記していなかった事項であるため、**Claude
（進行管理）としてここで設計を確定**し、それに基づく実装追加・証跡確認をGeminiに求める。

```
# SOレビュー結果：P4-T3 CONDITIONAL PASS（設計確定4点＋実装追加＋証跡確認）

# 設計確定-01（Claudeからの回答）: `contract_renewal_links`の一意性・不変性
1件の契約に対して複数回の更新提案（deal）が作られること自体は業務上正常（例:
1回目の更新商談が`lost`になった後、別の更新商談を起票する等）であるため、**1契約に
対する複数リンクは許可する**。一方、以下は構造的に排除する。
  - 1つの`deal`が複数の契約のリンク対象になること（`deal_id`にNULL除外の部分UNIQUE
    制約を追加する）
  - リンク行作成後、`contract_id`・`deal_id`への直接UPDATE（付け替え）が可能であること
    （WORMトリガーで拒否する）
  - `quotation_id`は、`deal`作成時点ではNULLで良く、その案件から見積が実際に作成された
    タイミングで**NULLから1回だけ**設定できる（P4-T1の`superseded_by`と同じ「一度限りの
    遷移」パターンを踏襲）。既に設定済みの`quotation_id`への再設定・NULLへの巻き戻しは
    WORMトリガーで拒否する。同一quotationが複数のリンク行から参照されることも、
    `quotation_id`へのNULL除外部分UNIQUE制約で排除する。

# 設計確定-02（Claudeからの回答）: `quotation_id`の正当性
リンクの`quotation_id`は、**その`quotation`の`deal_id`が、当該リンク行の`deal_id`と
一致する場合にのみ**設定を許可する（同一tenantであることだけでは不十分、という前回
P4-T1のレビュー基準と同じ考え方）。`quotation_id`設定時にDBトリガーで
`quotations.deal_id = contract_renewal_links.deal_id`を検証し、一致しない場合は拒絶する。

# 設計確定-03（Claudeからの回答）: RBACの権限構成
`contract-renewal-link.create`権限を持つユーザーが、`deal.create`権限を別途持たなくても
更新提案の案件を作成できる、という現在の実装方針を**意図した設計として確認・採用する**。
これは「契約更新提案の起票」という業務上の複合アクションに対する専用の権限であり、
基盤となる`deal.create`権限とは独立した権限単位として扱う（Phase 0〜3でも、複合業務
アクションに専用permissionを割り当てるパターンは複数採用されている）。Geminiは、この
方針が意図した設計であることをコード・完了報告に明記し、対応するRBAC E2E
（`contract-renewal-link.create`のみを持つユーザーで機能が使えること、両方を持たない
ユーザーでは拒否されること）を追加する。

# 設計確定-04（Claudeからの回答）: 顧客自動探索の複数候補時の扱い
契約相手先名からの顧客自動探索は、**完全一致のみ**を対象とし、完全一致が0件または2件
以上の場合はいずれもfail-closed（自動選択せず、明示的な顧客指定を要求するエラーを返す）
とする。Geminiは、現在の実装がこの方針（0件・複数件のいずれもfail-closed）と一致して
いることを確認し、**複数候補（同名顧客が2件以上存在する場合）のケースのE2Eが未実施で
あれば追加する**。

# 追加すべき実装（設計確定-01, 02に基づく）
1. `contract_renewal_links.deal_id`にNULLを除外した部分UNIQUE制約を追加する。
2. `contract_renewal_links.quotation_id`にNULLを除外した部分UNIQUE制約を追加する。
3. `contract_renewal_links`に対するWORMトリガーを追加し、以下を拒絶する。
   - `contract_id`・`deal_id`への作成後の直接UPDATE
   - `quotation_id`が既に設定済みの場合の再設定・NULLへの巻き戻し
4. `quotation_id`のNULL→非NULL遷移時、対象quotationの`deal_id`が当該リンク行の
   `deal_id`と一致することをDBトリガーで検証する。
5. 既存のmigrationファイル（026〜030）は書き換えず、新しいmigrationファイル
   （例: `sql/031_contract_renewal_link_guards.sql`）を追加すること（本計画書0.4節：
   migrationのappend-only原則）。

# 追加すべき実DB E2E（必須）
- 同一deal_idを別のcontract_renewal_link行に設定しようとして、UNIQUE制約で拒絶される
  こと
- リンク作成後、`contract_id`・`deal_id`への直接SQL UPDATEが拒絶されること
- リンクの`quotation_id`に、当該deal由来ではない（別dealの）quotationを設定しようとして
  拒絶されること
- 同一quotationを複数のリンク行から参照しようとして、UNIQUE制約で拒絶されること
- `quotation_id`設定済みリンクへの再設定・NULL巻き戻しが拒絶されること
- 契約相手先名に完全一致する顧客が2件以上存在する場合、自動探索がfail-closed（明示指定
  要求のエラー）になること
- `contract_renewal_links.created_by`・`deals.created_by`（更新提案経由で作成された
  deal）・`audit_logs.actor_user_id`が、クライアント入力ではなく認証済みセッションから
  導出されていること（偽装したuser_idが無視されることを実DBまたはAPI経由で確認）

# 証跡確認: git diffスコープと`deals.mapper.ts`の変更理由
`git diff --name-only <P4-T3開始時点のbase>...HEAD`の全文を提出すること。特に
`deals.mapper.ts`への変更（`toDateString`ヘルパー導入）について、P4-T3のどの要件から
必要になったのか（例: 契約更新連携でdeal一覧に契約関連の日付を表示する際に既存の
日付マッピングに不具合があった等）を具体的に説明し、この変更を含めてもP4-T2の既存51項目
E2Eが引き続きすべてPASSすることを確認・報告すること。

# 受け入れ基準（Definition of Done）
- [ ] 上記「追加すべき実装」5点がすべて実装されている
- [ ] 上記「追加すべき実DB E2E」7点すべてが実DB PostgreSQL上でPASSする
- [ ] `deals.mapper.ts`の変更理由が報告に明記され、P4-T2の既存51項目E2Eが引き続きPASSする
- [ ] `git diff --name-only`が報告に添付され、target files以外の不要な変更がないことが
      確認できる
- [ ] migrationがappend-only（026〜030を書き換えず、新規ファイルのみ追加）であることを
      diffで確認できる
- [ ] 既存のP4-T3 50項目E2E・P1-T4/P4-T1/P4-T2の回帰E2Eが引き続きすべてPASSする
- [ ] コミットSHA・ブランチ名（本計画書0.4節）を明記する

# ChatGPTレビュー時の確認観点
- `contract_renewal_links`のUNIQUE制約・WORMトリガーが、設計確定-01, 02の内容を正確に
  実装しているか
- `quotation_id`の正当性検証が、tenant一致だけでなくdeal_id一致まで踏み込んでいるか
- RBACの権限構成（設計確定-03）・顧客自動探索のfail-closed（設計確定-04）が、方針通りに
  実装・テストされているか
- `deals.mapper.ts`の変更が、P4-T3の要件から必要な範囲に限定されているか
```

---

#### 【マージ指示プロンプト P4-T3】mainへのマージ（SO正式PASS）＋DEBT-022の解消

ChatGPT(SO)よりP4-T3-VERIFYが**PASS**と正式判定された。前回のCONDITIONAL PASSで求めた
確認事項（linkの一意性・WORM、`quotation`↔`deal`正当性、複数顧客候補のfail-closed、
RBAC権限構成、`deals.mapper.ts`変更範囲）はすべて解消と評価され、「追加FIXを要求する
明確な理由はない」と明言されている。今回はP4-T3のマージに加えて、DEBT-022（P4-T1・
P4-T2のマージコミットSHA未確認）もあわせて解消する。

```
# マージ指示：P4-T3（契約更新連携）＋ P4-T1・P4-T2のマージ状況確認（DEBT-022解消）
ChatGPT(SO)がP4-T3を正式PASSと判定した。以下の手順でmainへマージし、あわせてP4-T1・
P4-T2のマージ状況を確認・記録すること。

# PASS根拠の要約（完了報告に転記・保持すること）
- `contract_renewal_links`：`deal_id`・`quotation_id`への部分UNIQUE制約、`contract_id`・
  `deal_id`のWORM（作成後変更不可）、`quotation_id`の一度限りの遷移をDBで保証
- `quotation`↔`deal`正当性：`quotations.deal_id = contract_renewal_links.deal_id`を
  DBトリガーで検証し、無関係なquotationのリンクを拒否
- 顧客自動探索：完全一致0件・2件以上の両方でfail-closed（明示指定を要求）
- RBAC：`contract-renewal-link.create`を「契約更新提案作成」の独立した複合業務権限として
  整理（`deal.create`とは別軸）
- 実DB E2E・回帰：189/189 PASS、clean DB 001〜031、P4-T1・P4-T2のWORM設計を壊さず
  P4-T3を追加できていることを確認

# マージ手順
1. `feature/p4-t3-contract-renewal-link`ブランチ（および関連するVERIFYのコミット）を
   mainへマージする。
2. マージコミットのSHA（`git rev-parse HEAD`）を記録する。
3. マージ後、mainブランチ上でclean DBへのmigration一括適用（001〜031）を再実行し、
   実DB E2E（189項目、またはP4-T1 57・P4-T2 51・P4-T3の該当項目の合算）が引き続き
   すべてPASSすることを確認する。
4. **DEBT-022の解消として、`git log`等でP4-T1（feature/p4-t1-quotations）・
   P4-T2（feature/p4-t2-deals）のmainへの反映が実際に完了しているマージコミットの
   SHAを特定し、報告に明記すること。** 万一、いずれかが実際にはmainへ未反映のまま
   後続タスクのブランチ上でのみ作業が続いていた場合は、その旨を正直に報告し、
   Claude（進行管理）と対応方針を相談すること。
5. 完了報告には、P4-T1・P4-T2・P4-T3それぞれのマージコミットSHA・mainブランチでの
   再検証結果（E2E件数・PASS件数）を必ず明記すること。

# 受け入れ基準（Definition of Done）
- [ ] P4-T1・P4-T2・P4-T3それぞれのマージコミットSHAが報告に明記されている
- [ ] マージ後、main上で001〜031のclean DB migration適用が成功する
- [ ] マージ後、main上で実DB E2EがすべてPASSする（件数を明記）
- [ ] DEBT-022の解消状況（P4-T1・P4-T2が実際にmainへ反映済みであることの確認結果）が
      報告に明記されている
```

---

#### 【指示プロンプト P4-T4】営業ダッシュボード・レポート

P4-T3が正式PASSとなったことを受け、Phase 4最終タスク（営業ダッシュボード・レポート）の
詳細を分解する。既存のP2-T4（購買ダッシュボード）と同様の設計パターンを踏襲する。

```
# 背景・目的
Phase 4で構築した見積（P4-T1）・案件（P4-T2）・契約更新連携（P4-T3）のデータを集計し、
案件パイプラインの状況・見積の成約率・契約更新提案の進捗を可視化する営業ダッシュボードを
実装する。本タスクの完了をもってPhase 4（営業事務）が全4タスク完了となる。

# 前提となる既存実装
- P4-T1: `quotations`（status: draft/sent/accepted/rejected/expired）
- P4-T2: `deals`（stage: lead/qualified/proposal/negotiation/won/lost）
- P4-T3: `contract_renewal_links`
- P2-T4（購買ダッシュボード）の設計パターン（集計クエリのtenant scoping、権限体系、
  フロントエンドの可視化コンポーネント構成）

# やってはいけないこと
- 集計のために既存テーブル（quotations, deals, contract_renewal_links）のデータを
  重複保持する新規テーブルを作らない。集計はSQLビュー、またはオンデマンドの集計クエリで
  行う（パフォーマンス上必要な場合のみ、read-onlyのmaterialized viewを検討し、その場合は
  更新タイミング・整合性の考慮を完了報告に明記する）。
- 既存のP4-T1〜T3のmigration・WORM設計・RLS設計を変更・書き換えない。
- 集計クエリがtenant_idでのフィルタを欠き、他テナントのデータが集計に混入する状態を
  作らない（既存のRLSに依存する場合も、集計用のクエリ・ビュー自体がRLSの対象になって
  いることを確認する）。
- dashboard.view権限を持たないユーザーがダッシュボードデータにアクセスできる状態を
  作らない。

# 実装対象
1. 案件パイプラインの集計API（ステージ別件数・金額合計、`won`/`lost`の件数と勝率）
2. 見積の状態別集計API（`draft`/`sent`/`accepted`/`rejected`/`expired`の件数、
   成約率 = accepted / (sent + accepted + rejected + expired)）
3. 契約更新連携の進捗集計API（P1-T4のアラート対象契約数に対する
   `contract_renewal_links`作成率、リンクされた案件のステージ分布）
4. `dashboard.view`のpermissionをRBAC体系に追加し、Controller・Service両層でチェックする。
5. 上記集計を可視化するフロントエンド画面（グラフ・KPIカード等、P2-T4の購買ダッシュボード
   と一貫したデザイン）

# 受け入れ基準（Definition of Done）
- [ ] 案件パイプライン・見積状態・契約更新連携進捗の集計値が、テストデータに対して
      正しいことを確認する
- [ ] 他テナントのデータが集計結果に一切混入しないことを確認する
- [ ] `dashboard.view`権限を持たないユーザーがアクセスできないことを確認する
- [ ] P4-T1〜T3の既存E2E（回帰）が引き続きすべてPASSする
- [ ] migrationがappend-only・fail-closedの原則（本計画書0.4節）に従っている（新規
      ビュー等を追加する場合も既存migrationは書き換えない）
- [ ] Phase 0で確立した実DB E2E検証基盤で、上記すべてを実PostgreSQL上で確認し、
      結果を報告に添付する
- [ ] 完了報告に正確なコミットSHA・ブランチ名・main...ブランチの比較URLを明記する
      （本計画書0.4節ルール4）
- [ ] feature/p4-t4-sales-dashboard ブランチにコミット・pushし、比較URLを報告に含める

# ChatGPTレビュー時の確認観点
- 集計クエリ・ビューがtenant境界を正しく守っているか（RLSに依存する場合、そのビュー・
  クエリ自体がRLSの対象になっているか）
- `dashboard.view`権限のチェックがController・Service両層で行われているか
- 集計ロジックが既存のP4-T1〜T3のWORM・状態遷移設計を変更していないか
- 成約率・進捗率等の計算式が、完了報告に明記された定義通りに実装されているか
```

---

#### 【フォローアップ指示プロンプト P4-T4-FIX】REQUEST CHANGES対応（実DB E2Eがsuperuser接続でRLSを経由していない）

ChatGPT(SO)よりP4-T4は「実装自体は完成度が高く、GitHub上の実差分（`b67b356`→
`1b0952e`、15ファイル）もスコープ内。ただし正式PASS・マージ前に1点の修正が必要」と
判定された。作り直しではなく、実質1点（E2Eの接続方式）＋報告表現の整理のみである。

```
# SOレビュー結果：P4-T4 REQUEST CHANGES（実質1点: E2Eの接続方式）

# BLOCKER-01: ダッシュボード集計のRLS実DB検証が、実際にはRLSを経由していない
現在のP4-T4 E2Eは、`Pool`を直接生成して`DatabaseService`にセットし、`SalesDashboardService`
を実行している。この接続はPostgreSQLの`postgres`（superuser）ロールのままであり、
`SET LOCAL ROLE app_runtime`も`app.current_tenant_id`の設定も行われていない。
PostgreSQLではsuperuserは`FORCE ROW LEVEL SECURITY`であってもRLSを常にバイパスするため、
現在のE2Eが証明しているのは「`SalesDashboardService`のSQLに明示的な`WHERE tenant_id = $1`
句がある」ことだけであり、「RLSというDB最終防御を実際に経由してtenant分離が機能している」
ことの証明にはなっていない。これは実装コードの不備ではなく、E2Eの検証方法の不備である。

# 修正方針
1. P4-T4のE2Eスクリプト（`verify-sales-dashboard-e2e.ts`）を、既存の
   `DatabaseService.transaction(tenantId, userId, callback)`（`BEGIN` →
   `set_config('app.current_tenant_id', ...)` → `set_config('app.current_user_id', ...)`
   → クエリ → `COMMIT`という、Phase 0〜4で確立済みの正規のRLSコンテキスト設定経路）を
   通して`SalesDashboardService`を呼び出すように変更する。`Pool`を直接操作する現在の
   方式を廃止する。
2. 接続ロールが`app_runtime`（RLS対象ロール）であることを確認する。既存の
   `verify_schema.py`の`tx_as(role="app_runtime", tenant_id=...)`ヘルパーと同水準の
   検証パターンに合わせること。
3. 上記の変更はテスト（E2Eスクリプト）側の修正であり、`SalesDashboardService`本体の
   SQL・ロジックを変更する必要はない（既存の`WHERE tenant_id = $1`はそのまま維持して
   良い。RLSは多層防御の一つであり、アプリ層のtenant filterを取り除く必要はない）。

# 追加すべき実DB E2E（必須）
- Tenant Aのコンテキスト（`app_runtime`ロール、`app.current_tenant_id = A`）で
  ダッシュボード集計を実行し、Tenant Aのデータのみが結果に含まれることを確認する
  （既存のTenant A/B分離テストを、この接続方式に置き換えて再実行する）
- 同じRLSコンテキスト下で、Tenant Bの大きな金額データが一切混入しないことを確認する
  （既存のテストデータ・期待値はそのまま使用可能）

# 完了報告の証跡表現の整理（コード修正ではなく報告の書き方の修正）
以下のように、それぞれ別の検証であることを明確に分離して記載すること。
  - Backend Jest: 28 suites / 241 tests PASS
  - `verify_schema.py`: 194件の検証項目PASS
  - P4-T4 E2E: （件数）PASS
  - clean DB 001〜032のmigration一括適用: PASS（これは「migration列が破綻していない」
    ことの確認であり、「全機能をclean DB上でE2E再実行した」ことを意味しない、という
    区別を明記する）

# 受け入れ基準（Definition of Done）
- [ ] P4-T4のE2Eが`app_runtime`ロール・`app.current_tenant_id`設定を経由して実行される
      ように修正されている
- [ ] Tenant A/B分離が、上記の正規RLSコンテキスト下で実DBにより確認されている
- [ ] 完了報告の証跡表現が、Jest・schema verifier・E2E・clean DB migration適用の4つを
      混同せず分離して記載されている
- [ ] 既存のP4-T1〜T3回帰E2Eが引き続きすべてPASSする
- [ ] コミットSHA・ブランチ名（本計画書0.4節）を明記する

# ChatGPTレビュー時の確認観点
- E2Eの接続がPostgreSQLの`app_runtime`ロールで実行され、superuserのRLSバイパスを
  経由していないか
- `SalesDashboardService`本体のロジックが不必要に変更されていないか（今回はE2E側の
  修正のみで十分なはず）
- 完了報告の数字（Jest/schema verifier/E2E/clean DB）が正確に区別されているか
```

---

#### 【マージ指示プロンプト P4-T4】mainへのマージ（SO正式PASS、Phase 4全4タスク完了）

ChatGPT(SO)よりP4-T4-FIXが**PASS**と正式判定され、「mainマージ可能」と明言された。
今回の判定で、DEBT-022（P4-T1〜T3のマージコミットSHA未確認）についても、SOがGitHub
履歴から`7317b04`（P4-T1）・`8227404`（P4-T2）・`b67b356`（P4-T3）を確認し、
「解消済みとして扱ってよい」との判断が示された。

```
# マージ指示：P4-T4（営業ダッシュボード・レポート）
ChatGPT(SO)がP4-T4を正式PASSと判定した。以下の手順でmainへマージすること。

# PASS根拠の要約（完了報告に転記・保持すること）
- RLS実DB検証：`app_runtime`ロール・`app.current_tenant_id`設定下で、Tenant Bの
  deals/quotations/contracts/renewal_linksが0件であることを直接SELECTで確認し、
  同一RLSコンテキストでダッシュボード集計を実行（アプリ層のtenant filterとDB層のRLSを
  切り分けて検証）
- 案件勝率・見積成約率・契約更新起票率：実データによる計算値の一致を確認
- ゼロ除算：空テナントで各比率が0になることを確認
- RBAC：Controller/Service二重防御、権限別のアクセス可否を確認
- migration：032がappend-only、既存migration（026〜031）を書き換えず、`ON CONFLICT DO
  NOTHING`で冪等性も確保
- git diffスコープ：15ファイルに収まり、スコープ逸脱なし
- 実DB E2E 81/81、Backend Jest 28 suites/241 tests、schema verifier 194/194、
  clean DB 001〜032 migration適用、すべてPASS

# マージ手順
1. `feature/p4-t4-sales-dashboard`ブランチ（FIXのコミットを含む）をmainへマージする。
2. マージコミットのSHA（`git rev-parse HEAD`）を記録する。
3. マージ後、mainブランチ上でclean DBへのmigration一括適用（001〜032）を再実行し、
   実DB E2E（P4-T1〜T4の該当項目）が引き続きすべてPASSすることを確認する。
4. 完了報告には、マージコミットSHA・mainブランチでの再検証結果を必ず明記すること。

# 受け入れ基準（Definition of Done）
- [ ] mainへのマージが完了し、マージコミットSHAが報告に明記されている
- [ ] マージ後、main上で001〜032のclean DB migration適用が成功する
- [ ] マージ後、main上で実DB E2EがすべてPASSする（件数を明記）
- [ ] 上記結果を完了報告に明記する

このマージが完了すれば、**Phase 4（営業事務）の全4タスクが完了**する。
```

これにより、**Phase 4（営業事務）の全4タスクが完了**した（マージコミット`f697778`、
mainブランチ上でclean DB 001〜032・実DB E2E 81/81・schema verifier 194/194・
Backend Jest 28 suites/241 tests・Frontend buildをすべて確認済み）。

### Phase 4クローズ時点のサマリ

| タスク | 最終判定 | マージコミット | 往復回数 |
|--------|----------|----------------|----------|
| P4-T1 | ✅ PASS・mainマージ完了 | `7317b04` | 5回（FIX〜FIX4、VERIFY。`superseded_by`正当性→`converted_invoice_id`/`source_quotation_id`双方向リンクへ段階的にDB最終防御を強化） |
| P4-T2 | ✅ PASS・mainマージ完了 | `8227404` | 2回（CONDITIONAL PASS→VERIFY。非terminalステージの自由遷移という設計意図の明確化が中心） |
| P4-T3 | ✅ PASS・mainマージ完了 | `b67b356` | 2回（CONDITIONAL PASS→VERIFY。`contract_renewal_links`の一意性・WORM・`quotation`↔`deal`正当性のDB検証追加が中心） |
| P4-T4 | ✅ PASS・mainマージ完了 | `f697778` | 2回（REQUEST CHANGES→FIX。実DB E2Eの接続方式をsuperuserから`app_runtime`+tenant contextへ修正したことでRLS最終防御を実証） |

### Phase 4で確立・強化された恒久ルール

1. WORM対象列に対する「一度限りの遷移」パターン（P4-T1の`superseded_by`・
   `converted_invoice_id`・`invoices.source_quotation_id`、P4-T3の
   `contract_renewal_links.quotation_id`）を、双方向リンクの両側に対称に適用する
   という設計原則が確立された。片側だけの不変性は不十分であり、双方向リンクは
   両端をDBトリガーで保護する。
2. 「リンクの正当性」はtenant一致だけでは不十分であり、参照先の構造的な関係
   （quote_no・version、deal_id等）までDBトリガーで検証する、という基準がP4-T1の
   `superseded_by`レビューで確立し、P4-T3の`quotation_id`↔`deal_id`検証でも
   一貫して適用された。
3. 実DB E2Eにおいて、`postgres`superuser接続のままではRLSが常にバイパスされるため、
   「RLSを最終防御として検証した」と言うためには`app_runtime`ロール・
   `app.current_tenant_id`設定を経由した検証が必須である、という基準がP4-T4で
   確立した（本計画書0.4節への追記候補）。
4. 非terminalな業務ステータス間の遷移について、実務上の非線形性（後退・スキップ）を
   許容し、terminal状態への遷移のみを一方向・不可逆としてDBで保護する、という
   区別がP4-T2で確立した。

### 未解決の技術的負債一覧（Phase 5着手前に一度棚卸しを推奨）

DEBT-001, 002, 007, 008, 009, 010, 011, 012, 013, 014, 015, 016, 017, 018, 021 が
8節に記録されている（DEBT-003〜006, 020, 022は解消済み、DEBT-019は受容境界として区別）。
特にDEBT-001（添付ファイルアップロードの非原子性）は、記録時点から「Phase 5
（統合最適化）またはストレージ本格化タイミングで再評価」と明記されており、Phase 5
着手時に優先的に棚卸しすることを推奨する。

---

## 7. Phase 5: 統合最適化（横断ダッシュボード・AIレコメンド）

### 7.1 目的

Phase 0〜4で構築した各業務ドメイン（承認ワークフロー、契約管理、購買・調達、人事労務、
営業事務）のデータを横断的に活用し、経営者・管理者が全社の状況を一目で把握できる統合
ダッシュボードと、業務担当者の意思決定を支援するAIレコメンド機能を提供する。本Phaseは
新規の業務ドメインを追加するものではなく、既存ドメインの「統合」と「最適化」に専念する
最終Phaseである。

### 7.2 本Phase特有の設計原則（最重要・全タスク共通）

本Phaseは規制複雑度こそ低いが、複数ドメインのデータを横断するため、tenant境界・
アクセス権限の観点で新たなリスクが生じやすい。以下を全タスク共通の設計原則とする。

1. **横断ダッシュボードは既存の各ドメインのRLS・RBACを迂回しない。** 集計値を出す際も、
   各ドメインの参照権限を持たないユーザーには、その内訳が推測できる形の詳細を表示しない
   （例: 給与データの集計を、給与閲覧権限のないユーザーに見せない）。ダッシュボード専用の
   permissionを新設する場合も、既存ドメインごとのpermissionとの関係を明確にする。
2. **AIレコメンドは提案に留め、業務データを自動的に変更・確定しない。** 0.2節の
   AI提案→人間承認→確定の三段構成を、本Phaseでは特に厳格に適用する。レコメンドは
   「表示されるだけ」であり、採用するかどうかは常に人間の明示的操作（既存の各ドメインの
   正規APIを通じた操作）に委ねる。レコメンド機能自体が業務レコードを直接作成・更新・
   削除する経路を持たない。
3. **AIレコメンドの根拠データは、閲覧者本人がアクセス権限を持つデータの範囲に限定する。**
   業務横断的な相関から提案を生成する場合でも、提案文中に閲覧者が本来アクセスできない
   ドメインの詳細情報（他部署の契約金額、他ユーザーの担当案件の内情等）が漏れないように
   する。
4. **レコメンドの提示・採用・見送りをすべて記録する（監査可能性）。** どのレコメンドが
   いつ誰に表示され、採用されたか見送られたかを記録し、後から効果検証・誤提案の追跡が
   できるようにする。

### 7.3 タスク分解

| タスクID | タスク名 | 概要 | 依存 | ステータス |
|----------|----------|------|------|-----------|
| P5-T1 | 横断KPIダッシュボード基盤 | Phase 0〜4の主要KPI（承認待ち件数、契約更新期限、購買稟議状況、給与・勤怠概況、営業パイプライン・見積成約率）を1画面に統合表示する経営者向けダッシュボード | P0〜P4の各ダッシュボード・集計API | ✅ PASS・mainマージ完了（マージコミット`28c4f75`） |
| P5-T2 | AIレコメンドエンジン基盤 | 業務横断的なデータ相関から提案（レコメンド）を生成する基盤。提案の生成・表示・採用/見送りの記録に専念し、業務データの自動変更は行わない | P5-T1 | ✅ PASS・mainマージ完了（マージコミット`0da4b87`） |
| P5-T3 | レコメンドの業務画面への統合表示 | P5-T2のレコメンドを、各ドメインの既存業務画面（契約詳細、案件詳細、購買申請等）に文脈に応じて表示する | P5-T2 | ✅ PASS・mainマージ完了（マージコミット`c63382f`） |
| P5-T4 | 技術的負債の棚卸し・解消とPhase 5クローズ | DEBT-001等、Phase 5着手前に推奨された技術的負債の棚卸しと解消、プロジェクト全体の最終確認 | P5-T1, P5-T2, P5-T3 | ✅ PASS・mainマージ完了（マージコミット`8d15cca`、E2E 93/93・schema 209/209・Jest 261/261）— **Phase 5完了・ロードマップ全体完了** |

P5-T2以降の詳細タスク分解・実装指示プロンプトは、P5-T1の実装結果を踏まえてClaudeが
都度作成する（Phase 0〜4と同じ方針）。

### 7.4 Phase 5 実装指示プロンプト（Gemini向け）

#### 【指示プロンプト P5-T1】横断KPIダッシュボード基盤

```
# 背景・目的
Phase 5（統合最適化）の最初のタスクとして、Phase 0〜4で構築した各業務ドメインの主要KPIを
1画面に統合表示する経営者向けダッシュボードを実装する。既存のP2-T4（購買ダッシュボード）・
P4-T4（営業ダッシュボード）の集計パターンを踏襲し、新たに承認ワークフロー（Phase 0）・
契約更新期限（P1-T4）・人事労務（Phase 3）の主要指標を追加で集計する。

# 前提となる既存実装
- P2-T4: 購買ダッシュボードの集計パターン（tenant scoping, RBAC）
- P4-T4: 営業ダッシュボードの集計パターン（`app_runtime`ロール・tenant context経由での
  RLS実DB検証を含む、本プロジェクトで確立した検証基準）
- P0（承認ワークフロー）、P1-T4（契約更新アラート）、Phase 3（人事労務）の各テーブル・API
- Phase 0〜4で確立した設計パターン全般（tenant整合性トリガー、RLS、RBAC三層防御）

# やってはいけないこと
- 各ドメインの既存permission体系を迂回する形で、`dashboard.view`権限だけで全ドメインの
  詳細データにアクセスできるようにしない。ダッシュボードの各KPIカードは、閲覧者が当該
  ドメインの参照権限を持つ場合にのみ表示する（権限がない場合はカード自体を非表示、または
  「権限がありません」の表示に留め、集計値の推測を許さない）。
- 集計のために既存テーブルのデータを重複保持する新規テーブルを作らない（P4-T4と同じ方針）。
- 実DB E2Eを`postgres`superuser接続のまま実行し、RLSを経由しない検証で済ませない
  （P4-T4-FIXで確立した基準：`app_runtime`ロール・`app.current_tenant_id`設定を経由した
  検証を必須とする）。
- Phase 0〜4で繰り返し指摘・修正された問題（暗黙自動承認、tenant整合性のアプリ層依存、
  RBAC未強制、migration事後書き換え、fail-closedでないデータ検証、DBエラーの握り潰し、
  同時実行race condition、実質何も検証しないテスト、client-controlled identity、
  object-level authorizationの欠如、RLSバイパス状態での検証）のいずれも再発させないこと。

# 実装対象
1. 横断KPI集計API（既存の各ドメインAPI・集計ロジックを呼び出す形で実装し、ロジックを
   重複実装しない）
   - 承認ワークフロー：承認待ち件数（Phase 0）
   - 契約更新：期限が近い契約件数（P1-T4）
   - 購買：稟議中の件数・金額（P2-T4のロジックを再利用）
   - 人事労務：勤怠異常件数等の概況（Phase 3）
   - 営業：案件パイプライン・見積成約率（P4-T4のロジックを再利用）
2. `dashboard.executive_view`（仮称）のpermissionをRBAC体系に追加し、各KPIカードの表示は
   さらに当該ドメインのview権限（例: `deal.view`, `contract.view`等）の有無で個別に
   制御する。
3. フロントエンドの統合ダッシュボード画面（KPIカードのグリッド表示）

# 受け入れ基準（Definition of Done）
- [ ] 各ドメインのKPIが正しく集計・表示される
- [ ] 閲覧者が当該ドメインの参照権限を持たない場合、そのKPIカードが非表示になる
      （集計値も一切返さない）ことを確認する
- [ ] 他テナントのデータが集計に混入しないことを、`app_runtime`ロール・tenant context
      経由の実DB E2Eで確認する（P4-T4で確立した検証基準に従う）
- [ ] 既存のP0〜P4の集計ロジックを重複実装せず、呼び出しのみで構成されていることを
      コードで確認する
- [ ] migrationがappend-only・fail-closedの原則（本計画書0.4節）に従っている
- [ ] Phase 0で確立した実DB E2E検証基盤で、上記すべてを実PostgreSQL上で確認し、
      結果を報告に添付する
- [ ] 完了報告に正確なコミットSHA・ブランチ名・main...ブランチの比較URLを明記する
      （本計画書0.4節ルール4）
- [ ] feature/p5-t1-executive-dashboard ブランチにコミット・pushし、比較URLを報告に
      含める

# ChatGPTレビュー時の確認観点
- ドメインごとの表示権限制御が、`dashboard.executive_view`権限だけに頼らず、各ドメインの
  既存permissionとの組み合わせで正しく機能しているか
- 実DB E2Eが`app_runtime`ロール・tenant context経由で実行され、RLSを実際に検証しているか
  （P4-T4-FIXで確立した基準）
- 各ドメインの既存集計ロジックを重複実装していないか
```

---

#### 【フォローアップ指示プロンプト P5-T1-FIX】REQUEST CHANGES対応（既存集計ロジックの重複実装というDoD違反）

ChatGPT(SO)よりP5-T1は「RLS実DB検証・tenant isolation・二重認可・Git証跡はいずれも
良好。ただし核心となるDoD（既存の各ドメインAPI・集計ロジックを呼び出す形で実装し、
重複実装しない）を満たしていない」と判定された。セキュリティ検証のやり直しではなく、
実装方針そのものの修正が必要である。

```
# SOレビュー結果：P5-T1 REQUEST CHANGES（既存集計ロジックの重複実装というBLOCKER）

# BLOCKER: `ExecutiveDashboardService`が既存ドメインのServiceを呼び出さず、独自にSQL集計している
現在の実装は、`deals`・`quotations`・`contract_renewal_links`・`purchase_requests`・
`approval_requests`・`employees`・`attendance_records`等のテーブルに対して、
`ExecutiveDashboardService`内で直接SQL集計を行っている。特に営業KPI（win rate、
quotation conversion rate、renewal proposal rate）は、既存の`SalesDashboardService`
（P4-T4）にほぼ同じ計算式のメソッドが既に存在するにもかかわらず、それを呼び出さず
再実装している。購買KPIについても同様に、既存の`PurchaseDashboardService`（P2-T4）を
呼び出さず直接`purchase_requests`を集計している。これはP5-T1の指示プロンプト本文・DoD
（「既存の各ドメインAPI・集計ロジックを呼び出す形で実装し、ロジックを重複実装しない」）
に対する明確な違反である。

**「既存テーブルを参照している」ことと「既存の集計ロジックを再利用している」ことは
別である**。今回求めているのは後者であり、前者への修正（SQLを変えずに残す等）では
対応にならない。

# 修正方針
1. `ExecutiveDashboardService`から、各ドメインのテーブルへの直接SQL集計をすべて削除する。
2. 営業KPIは、既存`SalesDashboardService`の該当メソッドを呼び出す形に変更する。
   `ExecutiveDashboardService`が必要とする粒度のメソッドが`SalesDashboardService`に
   存在しない場合は、**`SalesDashboardService`側に必要なメソッドを追加**し、それを
   `ExecutiveDashboardService`から呼び出す（`ExecutiveDashboardService`側にSQL・
   計算ロジックを持たせない）。
3. 購買KPIについても、既存`PurchaseDashboardService`（P2-T4）の該当メソッドを呼び出す
   形に変更する。必要なメソッドがなければ`PurchaseDashboardService`側に追加する。
4. 承認ワークフロー（Phase 0）・契約更新（P1-T4）・人事労務（Phase 3）のKPIについても
   同様に、各ドメインの既存Service（実際のクラス名・ファイルは既存コードから確認する
   こと）に必要な集計メソッドがあれば呼び出し、なければそのドメインのService側に
   追加してから呼び出す。
5. `ExecutiveDashboardService`自身は、各ドメインServiceのメソッド呼び出し結果を合成する
   だけの薄いレイヤーとし、SQLクエリを直接発行しないようにする。
6. 既存Serviceにメソッドを追加する際、既存の呼び出し元（既存ダッシュボード画面等）の
   挙動・既存のtenant/RLS/権限チェックの前提を壊さないこと。

# 追加すべき実DB E2E（必須）
- Executive Dashboardが返す各ドメインのKPI値が、対応する既存Service（
  `SalesDashboardService`・`PurchaseDashboardService`等）のメソッドを直接呼び出した
  結果と完全一致することを確認する（同じデータに対する独立した再計算ではなく、同一の
  呼び出し経路であることの確認）
- 既存のP2-T4・P4-T4ダッシュボードの既存E2Eが引き続きすべてPASSする（回帰確認）
- `app_runtime`ロール・tenant context経由の実DB E2E（前回の54項目相当）が、修正後も
  引き続きすべてPASSする

# 受け入れ基準（Definition of Done）
- [ ] `ExecutiveDashboardService`が独自のSQL集計を持たず、各ドメインの既存（または
      新規追加された）Serviceメソッドの呼び出しのみで構成されていることをコードで
      確認できる
- [ ] 既存Serviceへの追加が必要だった箇所（例: `SalesDashboardService`,
      `PurchaseDashboardService`）が、そのドメインのService内に追加され、
      `ExecutiveDashboardService`側に重複実装されていないことを確認する
- [ ] 上記「追加すべき実DB E2E」3点がすべてPASSする
- [ ] 既存のP0〜P4回帰E2Eが引き続きすべてPASSする
- [ ] `git diff main...HEAD`（修正後の最終コミット）で、意図しない変更が混入していない
      ことを確認する
- [ ] コミットSHA・ブランチ名・main...ブランチの比較URLを完了報告に明記する
      （本計画書0.4節）

# ChatGPTレビュー時の確認観点
- `ExecutiveDashboardService`が本当に薄いレイヤーになっており、SQL・計算ロジックを
  自前で持っていないか
- 既存ドメインServiceへの追加メソッドが、そのドメインの既存tenant/RLS/権限チェックの
  前提を壊していないか
- 「既存テーブルを見ている」ことと「既存ロジックを呼び出している」ことを混同した誤修正
  になっていないか
```

---

#### 【マージ指示プロンプト P5-T1】mainへのマージ（SO正式PASS）

ChatGPT(SO)よりP5-T1-FIXが**PASS**と正式判定された。前回のBLOCKER（既存集計ロジックの
重複実装）は、`ExecutiveDashboardService`を各ドメインServiceへの委譲のみで構成する
薄いオーケストレーターに再設計し、委譲結果と各ドメインService直接呼出結果の一致まで
実DBで確認したことで解消された。

```
# マージ指示：P5-T1（横断KPIダッシュボード基盤）
ChatGPT(SO)がP5-T1を正式PASSと判定した。以下の手順でmainへマージすること。

# PASS根拠の要約（完了報告に転記・保持すること）
- `ExecutiveDashboardService`は業務テーブルを直接参照せず、
  `ApprovalRequestsService.getPendingSummary()`・`ContractsService.getExpirySummary()`・
  `PurchaseDashboardService.getExecutivePurchaseKpi()`・
  `AttendanceService.getHrKpiSummary()`・`SalesDashboardService.getExecutiveSalesKpi()`
  への委譲のみで構成
- 委譲結果とドメインService直接呼出結果の一致を実DBで検証（`toEqual`比較）
- RLS実DB検証：`app_runtime`ロール・`app.current_tenant_id`設定下でTenant Bの
  deals/contracts/purchase_requests等が直接0件であることを確認
- RBAC：実際の`user_roles`を割り当てたテストユーザーで、ドメイン別のnull返却・403を確認
- ゼロ除算：Tenant Cで各比率が0になることを確認
- WORM/既存データ非破壊：既存件数の維持を確認
- Backend Jest 29 suites/246 tests、実DB E2E、clean DB 001〜033、Frontend buildすべて
  PASS

# 完了報告で補足すること（マージ阻害要因ではないが、記録として明記）
- Jestのテスト数が前回報告（247）から今回（246）に変わった理由（
  `executive-dashboard.service.spec.ts`の旧テストを委譲型テストへ置き換えたため）を
  1行で説明する
- `git diff --name-only main...HEAD`（マージ直前の最終コミット時点）の一覧を明記する

# マージ手順
1. `feature/p5-t1-executive-dashboard`ブランチ（FIXのコミットを含む）をmainへマージする。
2. マージコミットのSHA（`git rev-parse HEAD`）を記録する。
3. マージ後、mainブランチ上でclean DBへのmigration一括適用（001〜033）を再実行し、
   実DB E2Eが引き続きすべてPASSすることを確認する。
4. 完了報告には、マージコミットSHA・mainブランチでの再検証結果を必ず明記すること。

# 受け入れ基準（Definition of Done）
- [ ] mainへのマージが完了し、マージコミットSHAが報告に明記されている
- [ ] マージ後、main上で001〜033のclean DB migration適用が成功する
- [ ] マージ後、main上で実DB E2EがすべてPASSする（件数を明記）
- [ ] Jestテスト数の変化理由・`git diff --name-only`が報告に明記されている
```

---

#### 【指示プロンプト P5-T2】AIレコメンドエンジン基盤

P5-T1が正式PASSとなったことを受け、Phase 5の2番目のタスク（AIレコメンドエンジン基盤）の
詳細を分解する。

```
# 背景・目的
業務横断的なデータ相関から、担当者への提案（レコメンド）を生成・記録・表示する基盤を
実装する。本タスクでは提案の生成に専念し、業務データの自動変更は一切行わない
（本計画書7.2節の設計原則を厳格に適用する）。

# 設計方針の確定（Claudeからの回答：「AI」の実装範囲について）
本タスクにおける「AIレコメンド」は、**外部LLM APIへテナントの業務データを送信する実装
ではなく、構造化データに基づくルールベース（ヒューリスティック）の推奨エンジンとして
実装する**。理由は、テナントの契約・案件・見積・従業員データを外部APIへ送信することに
伴うデータガバナンス上の検討（何を送信してよいか、tenant分離をプロンプト送信経路でも
維持できるか等）が本タスクの本来のスコープ（提案生成の基盤づくり）を超えて重くなる
ためである。将来的に、本タスクで構築した構造化レコメンドの上に自然言語生成を追加する
タスクを検討する余地はあるが、それはP5-T2の範囲外とする。

# 前提となる既存実装
- P5-T1: `ExecutiveDashboardService`とその委譲先の各ドメインService（レコメンド生成でも
  同じ委譲パターンを踏襲し、各ドメインのデータへ直接SQLでアクセスしない）
- P1-T4: 契約更新期限アラート
- P4-T1〜T3: 見積・案件・契約更新連携
- Phase 0〜5で確立した設計パターン全般（tenant整合性トリガー、RLS、RBAC三層防御、
  migrationのappend-only・fail-closed運用、AI提案→人間承認→確定の三段構成）

# やってはいけないこと
- レコメンドエンジンが業務データ（deals, quotations, contracts, approval_requests等）を
  直接作成・更新・削除する経路を持たない。レコメンドは表示されるだけであり、採用する
  場合も既存の正規API（P4-T2のdeal作成API等）を人間が明示的に操作する。
- レコメンドの生成ロジックが、各ドメインの既存Service・APIを経由せず、業務テーブルに
  直接SQLアクセスする実装にしない（P5-T1-FIXで確立した「既存ロジックへの委譲」原則を
  踏襲する）。
- レコメンドの根拠データ・提案文に、閲覧者本人がアクセス権限を持たないドメインの詳細
  情報が含まれる状態を作らない。
- 外部LLM APIへテナントの業務データを送信する実装をしない（上記「設計方針の確定」で
  明記した通り、本タスクはルールベースエンジンとする）。
- Phase 0〜5で繰り返し指摘・修正された問題のいずれも再発させないこと。

# 実装対象
1. 新規マイグレーションで`recommendations`テーブルを作成する
   （id, tenant_id, type（例: `contract_renewal_pending`, `approval_stale`,
   `quotation_follow_up`）, target_domain, target_id（対象レコードへの参照。ポリモーフィック
   参照とするか、typeごとに専用列を持つかはGeminiの判断とし、理由を報告に明記する）,
   message, status(new/shown/accepted/dismissed), shown_at, responded_at, created_at
   等）。RLS（ENABLE + FORCE）、tenant整合性トリガーを実装する。
2. 以下のルールベースのレコメンド生成ロジックを実装する（既存の各ドメインServiceの
   参照メソッドを呼び出して判定材料を取得し、レコメンド生成ロジック自体はレコメンド
   モジュール内に置く。判定に使うデータの取得は既存Serviceへの委譲とする）。
   - 契約更新期限が近い（P1-T4アラート対象）にもかかわらず、`contract_renewal_links`が
     まだ存在しない契約 → 「更新提案の案件作成をお勧めします」
   - 承認待ちの申請が一定期間（例: 5営業日）滞留している → 「承認確認をお勧めします」
   - 見積が`sent`のまま一定期間（例: 14日）経過し、`accepted`/`rejected`/`expired`の
     いずれにもなっていない → 「フォローアップをお勧めします」
3. レコメンドの一覧・表示API（`recommendation.view`権限で保護。対象データへのアクセス
   権限も併せて確認し、権限がないレコメンドは表示しない）
4. レコメンドの「採用」「見送り」操作（ステータス更新のみを行い、対象の業務レコードには
   一切書き込まない）と、それに伴う監査記録
5. レコメンド生成バッチ（定期実行、または閲覧時のオンデマンド生成。方式はGeminiの判断とし
   理由を報告に明記する）

# 受け入れ基準（Definition of Done）
- [ ] 上記3種類のレコメンドが、テストデータに対して正しく生成される
- [ ] レコメンドの生成ロジックが、各ドメインの既存Serviceを経由してデータを取得している
      （直接SQLアクセスしていない）ことをコードで確認できる
- [ ] レコメンドの「採用」「見送り」操作が、`recommendations`テーブルのステータス以外の
      いかなる業務テーブルも変更しないことを実DBで確認する
- [ ] 他テナントのレコメンドが一切見えないことをRLSで確認する
- [ ] 閲覧者が対象データへのアクセス権限を持たない場合、該当レコメンドが表示されないことを
      確認する
- [ ] 外部API（LLM等）への通信が一切発生しないことを確認する
- [ ] migrationがappend-only・fail-closedの原則（本計画書0.4節）に従っている
- [ ] Phase 0で確立した実DB E2E検証基盤（`app_runtime`ロール・tenant context経由、
      P4-T4-FIXで確立した基準）で、上記すべてを実PostgreSQL上で確認し、結果を報告に
      添付する
- [ ] 完了報告に正確なコミットSHA・ブランチ名・main...ブランチの比較URLを明記する
      （本計画書0.4節ルール4）
- [ ] feature/p5-t2-recommendation-engine ブランチにコミット・pushし、比較URLを報告に
      含める

# ChatGPTレビュー時の確認観点
- レコメンド生成が各ドメインの既存Serviceへの委譲で構成されており、直接SQLアクセスや
  ロジックの重複実装になっていないか
- レコメンドの「採用」操作が、業務データを一切変更していないか（採用は既存の正規API
  操作へのナビゲーションに留まり、レコメンド自身が業務レコードを作成・更新しないか）
- tenant整合性・RBAC・権限による表示制御が、既存パターンと一貫しているか
- 外部API通信が本当に発生していないか
```

---

#### 【フォローアップ指示プロンプト P5-T2-FIX】REQUEST CHANGES対応（WORMとaccept/dismissの状態遷移モデルの整理）

ChatGPT(SO)よりP5-T2は「検証量自体はかなり多く良好。既存Service委譲・業務テーブル
非変更・RLS実DB検証は評価できる。ただし`recommendations`の状態遷移モデルとDB最終防衛の
整合性を詰め切れていない」と判定された。作り直しではなく、状態遷移トリガーの精緻化と
それに対応するE2Eの追加が中心である。

```
# SOレビュー結果：P5-T2 REQUEST CHANGES（状態遷移モデルの整理＋証跡確認）

# 設計確定-01（Claudeからの回答）: `recommendations`の不変性の正確な定義
`recommendations`は完全なWORM（一切のUPDATE不可）ではなく、**「作成後は
append-only、ただし`status`列に限り、`pending`から`accepted`または`dismissed`への
一度限りの遷移のみを許可する」**という設計を正式な仕様とする。以下を明確に区別する。
  - 許可される遷移：`pending → accepted`、`pending → dismissed`
  - 拒否される遷移：`accepted → dismissed`、`dismissed → accepted`、
    `accepted → pending`、`dismissed → pending`、およびその他のあらゆる`status`変更
  - `status`以外の列（`tenant_id`, `type`, `target_domain`, `target_id`, `message`,
    `reason`等、実際の列名は実装に合わせる）は、作成後は一切変更不可（真のWORM）
  - `DELETE`は常に拒否（fail-closed）
  - これらはアプリケーション層の権限チェックとは独立して、**DBトリガーが呼び出し元
    （アプリ経由か直接SQLか、どのDBロールか）を問わず機械的に強制する**（P4-T1の
    `superseded_by`等で確立した「一度限りの遷移」パターンと同じ考え方）

# 修正方針
1. `fn_guard_recommendation_immutability`（または同等のトリガー関数）を、上記
   設計確定-01の内容通りに実装・修正する。「WORM」という呼称が完全不変を連想させ
   誤解を招いていた場合は、完了報告・コード内コメントで「append-only +
   許可された状態遷移」という表現に整理する。
2. `target_domain`のポリモーフィック参照について、既知のドメイン（`contracts`,
   `approval_requests`, `quotations`等、実装で対応している値のみ）以外の値が
   `target_domain`に指定された場合、INSERT/UPDATE時にDBトリガーで明示的に拒否する
   （未知のドメイン値でも整合性チェックを素通りしてINSERTが成功する状態を許さない）。
3. `RecommendationsService`が業務テーブルへの直接SQLアクセス・`DatabaseService`の
   直接injectによるquery発行を一切持たず、既存ドメインServiceへの委譲のみで構成されて
   いることを、該当コード（`recommendations.service.ts`等）の該当箇所を示して報告に
   明記する。

# 追加すべき実DB E2E（必須）
- 正規の`accept`/`dismiss`操作による`pending→accepted`・`pending→dismissed`遷移が
  引き続き成功すること（回帰確認）
- 直接SQLによる`accepted→dismissed`・`dismissed→accepted`・`accepted→pending`・
  `dismissed→pending`のいずれの遷移も拒絶されること
- 直接SQLによる`tenant_id`・`type`・`target_domain`・`target_id`・`message`等の
  作成後の変更が拒絶されること
- `target_domain`に未知の値（例: `future_domain`）を指定したINSERTが拒絶されること
- 直接SQLによる`recommendations`レコードのDELETEが拒絶されること（既存確認分を維持）

# 証跡確認: RBACマトリクスとgit diff
1. 以下のマトリクスを、Controller層・Service層の両方について実DB E2Eで確認し、結果を
   報告に含めること。
   | 操作 | `recommendation.view`のみ | `recommendation.act`あり | 他tenant |
   |------|---------------------------|---------------------------|----------|
   | GET recommendations | 許可（一覧取得） | 許可 | 0件 |
   | accept | 403 | 許可 | 404または不可視 |
   | dismiss | 403 | 許可 | 404または不可視 |
2. `git diff --name-only main...<今回のコミット>`および
   `git diff main...<今回のコミット> -- '*.spec.ts'`を提出し、既存テストの削除・
   期待値の弱体化・変更がないことを確認できるようにする（P5-T1で247→246という
   テスト数変動があったため、今回の251件についても同様の透明性を確保する）。

# 受け入れ基準（Definition of Done）
- [ ] `recommendations`の状態遷移が設計確定-01の内容通りにDBトリガーで実装され、上記
      「追加すべき実DB E2E」5点すべてがPASSする
- [ ] `target_domain`の未知の値がfail-closedで拒否されることを確認する
- [ ] `RecommendationsService`が業務テーブルへの直接アクセスを持たないことをコードで
      示す
- [ ] RBACマトリクス（6ケース）を実DB E2Eで確認する
- [ ] `git diff --name-only`・`*.spec.ts`のdiffを提出し、既存テストの弱体化がないことを
      示す
- [ ] 既存のP5-T1回帰E2E・Backend Jestが引き続きすべてPASSする
- [ ] コミットSHA・ブランチ名（本計画書0.4節）を明記する

# ChatGPTレビュー時の確認観点
- `recommendations`の状態遷移が、呼び出し経路（アプリ経由・直接SQL・どのDBロールか）を
  問わずDBトリガーで一貫して強制されているか
- `target_domain`の未知の値が本当にfail-closedで拒否されるか
- 「WORM」という表現が実際の設計（append-only + 許可された状態遷移）と整合する形に
  整理されているか
- 既存テストが弱体化・削除されていないか（git diffで確認）
```

---

#### 【マージ指示プロンプト P5-T2】mainへのマージ（SO正式PASS）

ChatGPT(SO)よりP5-T2-FIXが**PASS**と正式判定された。前回の状態遷移モデルの矛盾は、
「append-only + `pending→accepted`/`pending→dismissed`の一度限りの遷移」という定義通りに
DBトリガーで実装され、不正遷移・不変列の改ざん・DELETE・未知の`target_domain`のいずれも
直接SQLでの実DB検証まで含めて拒否を確認できたことがPASSの根拠である。

```
# マージ指示：P5-T2（AIレコメンドエンジン基盤）
ChatGPT(SO)がP5-T2を正式PASSと判定した。以下の手順でmainへマージすること。

# PASS根拠の要約（完了報告に転記・保持すること）
- 状態遷移：`pending→accepted`/`pending→dismissed`の一度限りの遷移のみを許可し、
  それ以外の遷移（`accepted→dismissed`等）を`fn_guard_recommendation_immutability`で
  拒絶（実DB E2Eで`SQLSTATE 55000`を確認）
- 不変列WORM：`tenant_id`・`type`・`target_domain`・`target_id`等の作成後の変更を拒絶
- unknown `target_domain`：`future_domain`等の未知の値によるINSERTを拒絶
- DELETE：常に拒絶
- Domain Service委譲：`ContractRenewalLinksService`・`ApprovalRequestsService`・
  `QuotationsService`の既存公開メソッドを呼び出す構造を維持、`RecommendationsService`
  自身は業務テーブルへの直接アクセスを持たない
- RBAC：`recommendation.view`のみ/`recommendation.act`ありの権限差、Tenant Bの
  不可視・404をController+Service+RLSで確認
- 業務テーブル非変更：accept/dismiss前後で件数変更なし
- 実DB E2E 61 assertions、Jest 30 suites/251 tests、schema 208/208、clean DB
  001〜035、Frontend buildすべてPASS

# マージ前の任意確認（マージ阻害要因ではない）
SOより、`2fe3dc3`（P5-T2初回コミット）→`00d6d9b`（FIX後コミット）間で
`recommendations.service.spec.ts`・`verify-recommendations-e2e.ts`のdiffを確認し、
P5-T2初回実装時のテストがFIXで弱体化されていないことを最終確認すると証跡としてより
完全になる、との補足があった。必須ではないが、余裕があれば実施すること。

# マージ手順
1. `feature/p5-t2-recommendation-engine`ブランチ（FIXのコミットを含む）をmainへ
   マージする。
2. マージコミットのSHA（`git rev-parse HEAD`）を記録する。
3. マージ後、mainブランチ上でclean DBへのmigration一括適用（001〜035）を再実行し、
   実DB E2Eが引き続きすべてPASSすることを確認する。
4. **この機会に、P5-T1のマージが実際に完了しているか（マージコミットSHA）も併せて
   確認・報告すること。** 未確認のまま複数タスクが積み上がることを防ぐため、
   本計画書0.4節に従い都度確認する。
5. 完了報告には、P5-T1・P5-T2それぞれのマージコミットSHA・mainブランチでの再検証結果を
   必ず明記すること。

# 受け入れ基準（Definition of Done）
- [ ] P5-T1・P5-T2それぞれのマージコミットSHAが報告に明記されている
- [ ] マージ後、main上で001〜035のclean DB migration適用が成功する
- [ ] マージ後、main上で実DB E2EがすべてPASSする（件数を明記）
- [ ] 上記結果を完了報告に明記する
```

---

#### 【指示プロンプト P5-T3】レコメンドの業務画面への統合表示

P5-T2が正式PASSとなったことを受け、Phase 5の3番目のタスク（レコメンドの業務画面への
統合表示）の詳細を分解する。

```
# 背景・目的
P5-T2で構築したレコメンドエンジンは、現時点では独立した一覧画面からのみアクセスできる
想定である。本タスクでは、レコメンドを対象の業務レコードに文脈付けて、既存の各業務画面
（契約詳細、承認申請一覧、見積詳細等）に表示し、担当者が業務の流れの中で自然にレコメンド
を確認・採用・見送りできるようにする。

# 前提となる既存実装
- P5-T2: `recommendations`テーブル・レコメンド一覧/accept/dismiss API
  （`recommendation.view`/`recommendation.act`権限）
- 契約詳細画面（Phase 1）、承認申請一覧画面（Phase 0）、見積詳細画面（P4-T1）

# やってはいけないこと
- 本タスクで新たな業務ロジック・集計ロジックを追加しない。P5-T2の既存API（一覧取得・
  accept・dismiss）を呼び出すのみとする。
- レコメンドウィジェットが、表示対象のレコード（契約・承認申請・見積）に紐づかない
  レコメンドまで表示してしまう状態を作らない（`target_domain`+`target_id`で厳密に
  絞り込む）。
- `recommendation.view`権限に加えて、表示先の業務レコード自体の閲覧権限（例:
  `contract.view`）を持たないユーザーにレコメンドウィジェットを表示しない。
- Phase 0〜5で繰り返し指摘・修正された問題のいずれも再発させないこと。

# 実装対象
1. 契約詳細画面・承認申請一覧画面・見積詳細画面のそれぞれに、該当する
   `target_domain`+`target_id`のレコメンドを表示するウィジェットを追加する
   （P5-T2の既存一覧APIをクエリパラメータで絞り込んで呼び出す）。
2. ウィジェットから直接、既存の`accept`/`dismiss`APIを呼び出せるようにする。
3. `accept`時は、レコメンドが示す`action_url`（P5-T2で既に用意されている想定）へ
   遷移し、実際の業務操作（案件作成等）は既存の正規画面・APIに委ねる。

# 受け入れ基準（Definition of Done）
- [ ] 各業務画面で、該当レコードに紐づくレコメンドのみが表示される
- [ ] 表示先の業務レコードの閲覧権限を持たないユーザーには、レコメンドウィジェットが
      表示されない
- [ ] ウィジェットからのaccept/dismissが、P5-T2の既存APIをそのまま利用しており、
      新たな業務ロジックを追加していないことをコードで確認する
- [ ] 他テナントのレコメンドが一切表示されないことを確認する
- [ ] 既存のP5-T2回帰E2Eが引き続きすべてPASSする
- [ ] Phase 0で確立した実DB E2E検証基盤で、上記すべてを実PostgreSQL上で確認し、
      結果を報告に添付する
- [ ] 完了報告に正確なコミットSHA・ブランチ名・main...ブランチの比較URLを明記する
      （本計画書0.4節ルール4）
- [ ] feature/p5-t3-recommendation-widgets ブランチにコミット・pushし、比較URLを
      報告に含める

# ChatGPTレビュー時の確認観点
- レコメンドウィジェットの表示絞り込みが、`target_domain`+`target_id`で厳密に
  行われているか
- 表示権限が、`recommendation.view`と業務レコード自体の閲覧権限の両方で制御されているか
- 新たな業務ロジックの重複実装がないか
```

---

#### 【マージ指示プロンプト P5-T3】mainへのマージ（SO正式PASS）

ChatGPT(SO)よりP5-T3が**PASS**と正式判定された。レコメンドの対象レコード混入防止・
tenant境界・業務閲覧権限との連動・P5-T2 accept/dismiss基盤の再利用・業務ロジックの
重複回避・P5-T2回帰・実DB検証のいずれも良好であり、修正指示は不要とのことである。

```
# マージ指示：P5-T3（レコメンドの業務画面への統合表示）
ChatGPT(SO)がP5-T3を正式PASSと判定した。以下の手順でmainへマージすること。

# PASS根拠の要約（完了報告に転記・保持すること）
- `target_domain`+`target_id`による厳密な絞り込みを実DBで確認（他契約・他ドメイン
  混入ゼロ、未知UUID・Tenant BのIDでは0件）
- 業務レコード閲覧権限（例: `quotation.view`）を持たないユーザーには該当レコメンドが
  0件になることをBackend側でも確認（Frontendのみに依存しない）
- accept/dismissはP5-T2の既存APIへ委譲、業務テーブルへの直接更新なし
- P5-T2回帰：82 assertions、Jest 30 suites/252 tests、schema 208/208、clean DB
  001〜035、Frontend buildすべてPASS
- 既存テストの削除なし（`*.spec.ts`のdiffで確認）

# マージ前に確認すること（任意・軽微な表記確認）
完了報告に`next_action_url`という表記が見られたが、P5-T2で確立した実際のカラム名は
`action_url`である。実装が本当に`next_action_url`へ変更されたのか、単なる報告上の
表記ミスかを完了報告の中で明確にすること（BLOCKERではないが、記録の正確性のため）。

# マージ手順
1. `feature/p5-t3-recommendation-widgets`ブランチをmainへマージする。
2. マージコミットのSHA（`git rev-parse HEAD`）を記録する。
3. マージ後、mainブランチ上でclean DBへのmigration一括適用（001〜035）を再実行し、
   実DB E2Eが引き続きすべてPASSすることを確認する。
4. この機会に、P5-T1・P5-T2のマージが実際に完了しているか（マージコミットSHA）も
   併せて確認・報告すること。
5. 完了報告には、P5-T1・P5-T2・P5-T3それぞれのマージコミットSHA・mainブランチでの
   再検証結果を必ず明記すること。

# 受け入れ基準（Definition of Done）
- [ ] P5-T1・P5-T2・P5-T3それぞれのマージコミットSHAが報告に明記されている
- [ ] マージ後、main上で001〜035のclean DB migration適用が成功する
- [ ] マージ後、main上で実DB E2EがすべてPASSする（件数を明記）
- [ ] `action_url`/`next_action_url`の実際のカラム名が明記されている
```

---

#### 【指示プロンプト P5-T4】技術的負債の棚卸し・解消とPhase 5クローズ

P5-T3が正式PASSとなったことを受け、Phase 5最終タスク（技術的負債の棚卸し・解消）の
詳細を分解する。本タスクの完了をもってPhase 5、およびロードマップ全体（Phase 0〜5）が
完了となる。

```
# 背景・目的
本計画書8節に記録されている未解消の技術的負債（DEBT-001, 002, 007〜018, 021）を棚卸しし、
対応が容易かつ価値の高いものは実際に解消し、それ以外は「意図的な設計判断として現状維持」
であることを明文化する。プロジェクト全体（Phase 0〜5）のクローズ前の最終整理と位置づける。

# 前提となる既存実装
- 8節の技術的負債（DEBT）一覧全体
- 各DEBTが発見されたタスクの実装（該当ファイル）

# やってはいけないこと
- DEBTの棚卸しと称して、対応不要と判断した項目を計画書から削除しない。「解消」
  「受容済み境界として記録」等のステータス変更と理由の明記に留め、記録自体は残す
  （本計画書0.6節）。
- 本タスクの範囲外の新機能を追加しない（あくまで既存の技術的負債の解消・整理に専念する）。
- Phase 0〜5で繰り返し指摘・修正された問題のいずれも再発させないこと（特に、修正時に
  migrationを書き換えず新規ファイルで追加する、fail-closedを維持する等）。

# 実装対象
1. **まず、DEBT-001, 002, 007〜018, 021の各項目について、「対応する」か「意図的な設計
   判断として現状維持する」かのトリアージ表を作成し、完了報告の冒頭に提示すること。**
   判断基準は、対応コストが低く、かつ放置した場合の実害・監査上のリスクが相対的に高い
   ものを優先する。
2. 特に以下の3項目については、対応コストと価値のバランスから**実際に解消することを
   推奨する**（Geminiの調査の結果、想定より対応コストが高いと判断した場合は、その理由を
   報告した上で「現状維持」を選択してよい）。
   - **DEBT-001**（添付ファイルアップロードの非原子性）：`AttachmentsService.upload()`
     の処理順序を見直し、DB transactionのコミット後にファイル実体を確定させる、または
     transaction失敗時にファイル実体を確実に削除する補償処理を追加する。
   - **DEBT-008**（RBACドリフトリスク）：`PermissionsGuard`の静的マップとDBの
     `role_permissions`テーブルの整合性を検証する仕組み（起動時チェック、またはCI上の
     検証スクリプト）を追加する。DB参照方式への全面移行までは行わなくてよいが、
     乖離を検知できるようにする。
   - **DEBT-010**（`general_requests`の編集・削除権限）：`created_by`（起票者本人）か、
     または管理者相当の権限を持つ場合にのみPUT/DELETEを許可するよう修正する（「テナント
     内共同編集」ではなく「起票者本人または管理者のみ編集可」という仕様を正式に採用する。
     Claudeとしてこの仕様を確定する）。
3. 上記以外の項目（DEBT-002, 007, 009, 011〜018, 021）については、対応しない場合、
   その理由（意図的な機能制約・MVPスコープ・将来の業務要件次第等）を8節の該当行に
   反映し、必要に応じてステータスを「受容済み境界として記録」に更新する（DEBT-019と
   同じ扱い）。
4. Phase 0〜5を通じて確立した恒久ルール・設計原則の最終確認を行い、本計画書の内容と
   実装が乖離していないかを確認する（特に0.4〜0.5節、各Phaseの設計原則）。

# 受け入れ基準（Definition of Done）
- [ ] DEBT-001, 002, 007〜018, 021のトリアージ表（対応する/しないと理由）が完了報告に
      提示されている
- [ ] DEBT-001, 008, 010について、対応した場合はその実装内容と実DB E2Eでの確認結果を、
      対応しなかった場合はその理由を報告に明記する
- [ ] 対応した項目について、既存機能への回帰がないことをE2Eで確認する
- [ ] migrationがappend-only・fail-closedの原則（本計画書0.4節）に従っている（新規
      migrationが必要な場合も既存ファイルは書き換えない）
- [ ] Phase 0で確立した実DB E2E検証基盤で、上記すべてを実PostgreSQL上で確認し、
      結果を報告に添付する
- [ ] 完了報告に正確なコミットSHA・ブランチ名・main...ブランチの比較URLを明記する
      （本計画書0.4節ルール4）
- [ ] feature/p5-t4-debt-triage ブランチにコミット・pushし、比較URLを報告に含める

# ChatGPTレビュー時の確認観点
- トリアージ判断（対応する/しない）の理由が妥当か
- DEBT-001, 008, 010の実装（対応した場合）が、既存の設計原則（fail-closed、
  append-only、tenant整合性等）と一貫しているか
- 対応しなかった項目の記録が、削除ではなく理由付きのステータス更新として残っているか
```

---

#### 【フォローアップ指示プロンプト P5-T4-FIX】REQUEST CHANGES対応（解消表現の精度＋DEBT-010のステータス別確認＋証跡の数字整合）

ChatGPT(SO)よりP5-T4は「実装・検証量は十分だが、"解消した"とする根拠の精度に確認事項が
残る。作り直しではない」と判定された。DEBT-008は現状の証跡でPASS相当、DEBT-001は
表現の精度、DEBT-010は既存ステータス制約との組み合わせ確認が必要である。

```
# SOレビュー結果：P5-T4 REQUEST CHANGES（解消表現の精度＋DEBT-010確認＋数字整合）

# 設計確定-01（Claudeからの回答）: DEBT-001の解消範囲
`AttachmentsService.upload()`について、DBトランザクションが失敗した場合に書き込み済み
ファイル実体を補償的に削除する実装は、**「非原子性の完全解消」ではなく「DB失敗時の
補償削除による緩和」として正確に記録する**。真の原子性（ファイル書き込みとDBコミットの
不可分な一体化、transactional outbox等）は、MVP・ローカルディスク保存の間は引き続き
過剰な対応と判断し、実施しない。ただし、以下の残存リスクを新たに明示的に記録すること。
  - プロセスが「ファイル書き込み成功後・DBコミット前」に強制終了した場合、補償削除の
    `catch`経路自体が実行されないため、孤立ファイルが残り得る（発生確率は低いが、
    ゼロではない）
  - この残存リスクは、DEBT-001のステータスを「✅解消」ではなく「🟡部分解消（補償処理）。
    プロセス強制終了時の孤立ファイル残存リスクは受容」に修正し、理由とあわせて8節に
    記録する。将来S3等のオブジェクトストレージへ移行する際に、transactional outbox等を
    含めた本格対応を検討する、という記載は維持してよい。

# 修正方針
1. 完了報告およびDEBT-001の記録を、上記「設計確定-01」の表現に修正する。
2. DEBT-010について、`assertCanModify()`（または相当するチェック関数）が、
   「本人または管理者」という主体判定に加えて、`general_requests`の既存ステータス
   （draft/submitted/approved等、実際の値は既存実装に合わせる）による編集・削除可否の
   制約と矛盾しないことを確認する。特に「承認後（approved）は本人であっても編集・
   削除できない」という既存の（暗黙的または明示的な）制約を壊していないことを、実DB
   E2Eで確認する。もし既存実装にそのような status 制約がそもそも存在しない場合は、
   その旨を報告に明記し、Claude（進行管理）に判断を仰ぐこと。
3. 完了報告内のE2E件数表記（「88/88」「DEBT-010 4/4」「セクション15: 6アサーション」等）
   の不整合を解消し、各検証レイヤー（DEBT-001, DEBT-008, DEBT-010それぞれのE2E件数、
   全体のE2E件数、schema検証件数）を矛盾なく整理して報告する。
4. 完了報告の表現を、「本タスクの完了をもってPhase 0〜5全体を再検証した」ではなく、
   「ロードマップ上の最終タスクであるP5-T4が完了したため、ロードマップ全体（Phase
   0〜5）を計画上クローズする（Phase 0〜4は各タスクのPASS時点で個別に検証済み）」
   という表現に修正する。

# 追加すべき実DB E2E（必須）
- DEBT-010: 「本人×approved」「管理者×approved」等、ステータスと主体の組み合わせに
  ついて、既存の状態制約と矛盾しない結果になることを確認する（承認後は誰であっても
  編集・削除できない、というのが正しい仕様であれば、本人・管理者いずれであっても拒否
  されることを確認する）

# 受け入れ基準（Definition of Done）
- [ ] DEBT-001の記録が「部分解消（補償処理）」として正確な表現に修正され、残存リスクが
      明記されている
- [ ] DEBT-010が、既存の`general_requests`ステータス制約と矛盾しないことを実DB E2Eで
      確認する（ステータス制約が存在しない場合はその旨を報告し判断を仰ぐ）
- [ ] E2E件数・schema検証件数の表記が完了報告内で矛盾なく整理されている
- [ ] 「P5-T4完了＝ロードマップクローズ」の表現が、Phase 0〜4の個別検証結果とP5-T4の
      検証結果を混同しない形に修正されている
- [ ] 既存のP5-T1〜T3回帰E2Eが引き続きすべてPASSする
- [ ] コミットSHA・ブランチ名（本計画書0.4節）を明記する

# ChatGPTレビュー時の確認観点
- DEBT-001の記録が、実際に実装した内容（補償削除）と一致した正確な表現になっているか
- DEBT-010が、主体判定だけでなく既存のステータス制約とも整合しているか
- 完了報告内の証跡の数字が一貫しているか
- Phase 0〜5全体クローズの表現が、根拠の水準を正確に反映しているか
```

---

#### 【マージ指示プロンプト P5-T4】mainへのマージ（SO正式PASS・ロードマップ全体の最終タスク）

ChatGPT(SO)よりP5-T4-FIXが**PASS・マージ可能**と正式判定された。前回の4指摘（DEBT-001の
表現精度、DEBT-010のステータス制約確認、E2E件数の整合、Phase全体クローズ表現の精度）は
すべて解消されたとのことである。**本タスクはロードマップ（Phase 0〜5）の最終タスクである。**

```
# マージ指示：P5-T4（技術的負債の棚卸し・解消とPhase 5クローズ）
ChatGPT(SO)がP5-T4を正式PASSと判定した。以下の手順でmainへマージし、あわせて
ロードマップ全体のクローズに必要な情報を確認・整理すること。

# PASS根拠の要約（完了報告に転記・保持すること）
- DEBT-001：「完全解消」ではなく「部分解消（補償処理）」として正確に表現を修正。
  DBトランザクション失敗時のファイル補償削除を実装し、プロセス強制終了時の孤立
  ファイル残存リスクを明記
- DEBT-008：`ROLE_PERMISSIONS`（Guard静的マップ）とDB`role_permissions`の200組を
  双方向比較し、差分ゼロを`verify_schema.py`で検証できる機構を追加
- DEBT-010：`update()`/`delete()`が`status !== draft`なら409を返すサービス層の制約に
  加え、DB側`fn_guard_general_request_transition()`で`active`状態のDELETE・重要列
  変更・不正な状態遷移を拒否することを確認。本人・管理者いずれであってもactive状態は
  変更不可であることをE2Eで確認
- E2E件数：Backend Jest 261/261、実DB E2E 93/93、schema verifier 209/209、RBAC
  DB200組/Guard200組、clean DB 001〜035、Frontend buildすべて整理して報告
- Phase全体クローズの表現：「P5-T4完了によりロードマップを計画上クローズする。
  Phase 0〜4は各タスクのPASS時点で個別検証済み」という正確な表現に修正済み
- Git差分：9ファイルに収まり、スコープ逸脱なし

# マージ手順
1. `feature/p5-t4-debt-triage`ブランチをmainへマージする。
2. マージコミットのSHA（`git rev-parse HEAD`）を記録する。
3. マージ後、mainブランチ上でclean DBへのmigration一括適用（001〜035）を再実行し、
   実DB E2Eが引き続きすべてPASSすることを確認する。
4. **本タスクはロードマップ全体の最終タスクであるため、この機会にP5-T1・P5-T2・
   P5-T3・P5-T4すべてのマージコミットSHAを一括で確認・整理し、報告すること。**
   いずれかが実際にはmainへ未反映であった場合は、その旨を正直に報告し、Claude
   （進行管理）と対応方針を相談すること。
5. **P5-T4の完了報告本文に含まれていた、DEBT-002, 007, 009, 011〜018, 021の
   トリアージ結果（対応する/しないとその理由）の一覧を、改めてこの完了報告にも
   明記すること。** 計画書8節のDEBT一覧をこれに基づいて最終更新するために必要である。
6. 完了報告には、上記すべての結果を明記すること。

# 受け入れ基準（Definition of Done）
- [ ] P5-T1・P5-T2・P5-T3・P5-T4すべてのマージコミットSHAが報告に明記されている
- [ ] マージ後、main上で001〜035のclean DB migration適用が成功する
- [ ] マージ後、main上で実DB E2EがすべてPASSする（件数を明記）
- [ ] DEBT-002, 007, 009, 011〜018, 021のトリアージ結果一覧が報告に明記されている
- [ ] 上記結果を完了報告に明記する

このマージが完了すれば、**Phase 5（統合最適化）が全4タスク完了し、ロードマップ全体
（Phase 0〜5）が計画上完了**する。
```

これにより、**Phase 5（統合最適化）の全4タスクが完了**した（マージコミット
`28c4f75`（P5-T1）・`0da4b87`（P5-T2）・`c63382f`（P5-T3）・`8d15cca`（P5-T4）、
mainブランチ上でclean DB 001〜035・実DB E2E 93/93・schema verifier 209/209・
Backend Jest 30 suites/261 tests・Frontend buildをすべて確認済み）。

### Phase 5クローズ時点のサマリ

| タスク | 最終判定 | マージコミット | 往復回数 |
|--------|----------|----------------|----------|
| P5-T1 | ✅ PASS・mainマージ完了 | `28c4f75` | 2回（既存ドメインServiceへの委譲構造への修正） |
| P5-T2 | ✅ PASS・mainマージ完了 | `0da4b87` | 2回（WORM/status遷移モデルの整理） |
| P5-T3 | ✅ PASS・mainマージ完了 | `c63382f` | 1回 |
| P5-T4 | ✅ PASS・mainマージ完了 | `8d15cca` | 2回（解消表現の精度・ステータス制約確認の補強） |

### Phase 5で確立・強化された恒久ルール

1. 横断的な集計・統合機能は、既存ドメインのRLS・RBACを迂回せず、既存ドメインService
   への委譲のみで構成する（「既存テーブルを参照している」ことと「既存ロジックを
   再利用している」ことは別であり、後者を要求する）。P5-T1のFIXで確立。
2. AI関連機能であっても、外部LLM APIへのテナントデータ送信が不要な場合はルールベースで
   実装し、データガバナンス上のリスクを増やさない設計を優先する（P5-T2）。
3. 「不変性（WORM）」を名乗る場合、完全な不変と「特定の一度限りの状態遷移を許可する
   append-only」を明確に区別し、後者であれば正確にそう表現する（P5-T2）。
4. 「解消した」という完了報告の表現は実装水準と一致させる。補償処理による緩和を
   「完全解消」と呼ばない、検証スクリプトの追加を「CI常時自動検知」と過大に表現しない
   （P5-T4）。
5. Phaseやロードマップ全体の「完了」表現は、当該タスクの検証範囲と、過去タスクの
   個別検証結果を混同しない（例: 最終タスクの回帰確認をもって「全Phase再検証済み」と
   言わない）（P5-T4）。

### プロジェクト全体（Phase 0〜5）完了の総括

`keiri-kaikei`（経理会計SaaS）を全社バックオフィス統合SaaSへ拡張する本プロジェクトは、
Phase 0（基盤汎用化）からPhase 5（統合最適化）まで、ロードマップ上の全タスクが完了した。

| Phase | ドメイン | タスク数 | 主な成果 |
|-------|----------|---------|----------|
| Phase 0 | 基盤汎用化 | 5/5 | 承認ワークフローエンジンの汎用化、汎用ドキュメント管理基盤、AI提案の枠組み |
| Phase 1 | 総務・法務 | 6/6 | 契約書管理、稟議申請、条項AI抽出、更新期限アラート |
| Phase 2 | 購買・調達 | 4/4 | 発注申請、サプライヤー管理、購買稟議、購買ダッシュボード |
| Phase 3 | 人事労務 | 4/4 | 勤怠管理、給与計算内製化、社保・年末調整 |
| Phase 4 | 営業事務 | 4/4 | 見積書、案件管理、契約更新連携、営業ダッシュボード |
| Phase 5 | 統合最適化 | 4/4 | 横断KPIダッシュボード、AIレコメンドエンジン、技術的負債の棚卸し |

全Phaseを通じて、以下の設計原則が一貫して適用・強化された（詳細は0.4〜0.5節および
各Phaseの恒久ルール参照）。
- tenant整合性・RLSをDBトリガーで最終防御し、`app_runtime`ロール・tenant context経由の
  実DB E2Eで検証する
- RBACをController・Service・DBの三層で防御する
- migrationはappend-only、既存ファイルを事後的に書き換えない
- 完了報告のテストPASSをそのまま実動作の証明として扱わず、実DB・実運用経路での検証を
  要求する
- 双方向リンク・状態遷移は両端・両方向を対称にDBで保護する
- 「解消した」「自動検知」等の表現は実装の水準と一致させる

技術的負債（DEBT）については、DEBT-003〜006, 008, 010, 020, 022が解消済み、DEBT-001が
部分解消（残存リスクを受容）、DEBT-002, 007, 009, 011〜018, 021はP5-T4のトリアージで
「対応しない・受容済み境界」に整理された（8節）。DEBT-019は設計上の恒久的な境界として
情報共有の扱いとしている。

なお、DEBT-002, 007, 009, 011〜018, 021について、Gemini完了報告内の個別の理由付け
文章は、一部の項目でDEBT番号と記述内容の対応関係が判然としない箇所があったため、
本計画書には「P5-T4のトリアージで対応しない方針と判定された」という結論のみを反映し、
既存の詳細記述（内容・重要度列）はそのまま保持した。理由文言の詳細な紐付けが必要に
なった場合は、Geminiに再確認すること。

---

## 7.5 ドキュメント整備（README・要件定義書等の更新・追加）

外部レビュー（Qwenによるリポジトリ全体評価）を受け、README・`docs/01_requirements.md`
等の主要ドキュメントが、**Phase 0〜5拡張前（経理会計コアのみ）の内容のまま**である
ことが判明した。実装（テスト戦略・アーキテクチャ原則・スキーマ）は拡張後の水準まで
整備されているにもかかわらず、ドキュメントが追随していないため、外部から見た評価が
実態より低く見えてしまうギャップがある。全社シミュレーション（7.6節）に先立ち、
本節のドキュメント整備を先行して実施する。

### 発見事項（Claudeによるリポジトリ確認）

- `README.md`：タイトル・特徴一覧が「経理・会計オールインワンAIアプリケーション」の
  ままで、契約管理・購買調達・人事労務給与内製化・営業事務・横断ダッシュボード/AI
  レコメンド（Phase 1〜5）への言及が一切ない。
- `docs/01_requirements.md`：スコープが5領域（A〜E、経理会計のみ）で止まっており、
  Phase 1〜5で追加した領域が要件定義として記述されていない。
- `docs/02_architecture.md`：Phase 0〜5のレビュー往復で確立された設計原則
  （既存ドメインServiceへの委譲パターン、状態遷移トリガーの厳密な区別
  ［完全WORM vs 一度限りの遷移を許可するappend-only］、双方向リンクの対称的保護、
  RLS検証は`app_runtime`ロール経由が必須等）が記載されていない。
- `docs/03_database_design.md`：`sql/001_initial_schema_all_in_one.sql`（基盤スキーマ）
  のみを対象としており、`sql/002〜035`（拡張スキーマ）への言及がない。
- `docs/04_technical_reference.md`「7. テスト・検証資産」：記述が数行と薄く、実際の
  テスト規模（Backend Jest 30 suites/261 tests、`verify_schema.py` 209項目、ドメイン
  ごとの実DB E2Eスクリプト群、RBACドリフト自動検知、並行実行・アドバイザリロック
  テスト等）を反映していない。
- `docs/PROJECT_HISTORY.md`：経理会計コアのみのシミュレーション結果（101ユーザー・
  12ヶ月分、2026-08-05実施）で止まっており、Phase 0〜5拡張の経緯が記載されていない。

### 対応方針

いずれのドキュメントも、既存の記述を削除・上書きするのではなく、**拡張後の実態を
追記する形**で更新する（本計画書0.6節の精神と同様、過去の記録を消さない）。

#### 【指示プロンプト】ドキュメント整備（README・要件定義書・アーキテクチャ設計書等）

```
# 背景・目的
外部レビューで「ドキュメントが実装の実態（特にテスト戦略・拡張後のスコープ）を反映して
いない」という指摘を受けた。README・docs配下の主要ドキュメントを、Phase 0〜5拡張後の
実態に合わせて更新・追記する。コードの変更は一切行わない、ドキュメントのみのタスクである。

# やってはいけないこと
- 既存の記述（経理会計コアの5領域A〜E、既存のシミュレーション結果等）を削除・上書き
  しない。追記・拡充する形にする。
- 実装していない機能や、実施していない検証を「実施済み」であるかのように誇張して
  記載しない（実際にリポジトリ・テスト結果から確認できる内容のみを記載する）。
- コード自体は変更しない（ドキュメントファイルのみを対象とする）。

# 実装対象
1. `README.md`
   - タイトル・冒頭説明を「経理・会計 + 全社バックオフィス統合SaaS」であることが
     伝わる内容に更新する（経理会計コアの説明は残しつつ追記する）。
   - 主な特徴（Key Features）に、Phase 1〜5で追加した機能（契約書管理・条項AI抽出・
     更新期限アラート、購買・調達・3点照合、人事労務・給与計算内製化・年末調整、
     見積書・案件パイプライン・契約更新連携、横断KPIダッシュボード・AIレコメンド
     エンジン）を追記する。
   - ドキュメント一覧表に `docs/backoffice_expansion_plan.md`（バックオフィス拡張
     計画書：Phase 0〜5の詳細な実装指示・レビュー往復の全記録）へのリンクを追加する。

2. `docs/01_requirements.md`
   - 既存の5領域（A〜E）はそのまま残し、新しい章として「Phase 1〜5で追加した拡張
     スコープ」を追記する。各Phase（総務・法務／購買・調達／人事労務／営業事務／
     統合最適化）の概要を、`docs/backoffice_expansion_plan.md`の該当節を参照する形で
     簡潔にまとめる（詳細はそちらに譲り、本書では全体像の把握に必要な範囲に留める）。

3. `docs/02_architecture.md`
   - Phase 0〜5のレビュー往復を通じて確立された設計原則を新しい章として追記する。
     - 横断的な集計・統合機能は既存ドメインServiceへの委譲のみで構成し、SQL・
       集計ロジックを重複実装しない（P5-T1で確立）
     - 「不変性（WORM）」は、完全な不変と「一度限りの許可された状態遷移を伴う
       append-only」を明確に区別して設計・記述する（P4-T1, P5-T2で確立）
     - 双方向リンク（例: 見積↔invoice）は両端をDBトリガーで対称に保護する（P4-T1）
     - 実DB E2Eで「RLSを検証した」と言うには、`postgres`のようなsuperuser接続では
       なく`app_runtime`ロール・`app.current_tenant_id`設定を経由した検証が必須
       （P4-T4で確立）

4. `docs/03_database_design.md`
   - 既存の内容（`001_initial_schema_all_in_one.sql`の設計）はそのまま残し、末尾に
     「拡張スキーマ一覧（sql/002〜035）」という付録セクションを追加する。各migration
     ファイル名と一行程度の概要（例: `026_quotations.sql` — 見積書のWORM不変性・
     改訂リンク管理）を一覧化し、各トリガー・制約の詳細設計は
     `docs/backoffice_expansion_plan.md`の該当タスクの実装指示プロンプトを参照する形に
     する（ER図等の全面的な描き直しは行わない）。

5. `docs/04_technical_reference.md`「7. テスト・検証資産」
   - 現在の実際の検証規模を反映するよう拡充する。
     - Backend Jest: 実際のsuite数・test数（実行して確認すること）
     - `scripts/verify_schema.py`: 実際の検証項目数、および検証対象の主要カテゴリ
       （基盤スキーマのRLS/貸借/追記専用等に加えて、RBACドリフト自動検知
       ［DEBT-008対応: Guard静的マップとDB role_permissionsの突合］、各種
       ダッシュボード・レコメンドの権限紐付け検証等）
     - ドメインごとの実DB E2Eスクリプト一覧（`backend/src/scripts/verify-*-e2e.ts`を
       列挙し、各スクリプトが何を検証しているかを一行で説明する）
     - 並行実行・アドバイザリロックによる二重防止のテスト（見積の二重転換防止、
       サプライヤー名変更の直列化等）が実施されていることを明記する
     - RLS検証は`app_runtime`ロール・tenant context経由で実施する、という本プロジェクト
       の検証方針を明記する

6. `docs/PROJECT_HISTORY.md`
   - 既存の「経理会計コアのみ」のシミュレーション結果（2026-08-05実施分）はそのまま
     残す。
   - 新しい章として「Phase 0〜5 バックオフィス拡張」を追記し、拡張の経緯・全Phase・
     全タスクの概要（詳細は`docs/backoffice_expansion_plan.md`を参照する形）、
     モジュール数の変化（29モジュール→47モジュール）を記載する。
   - 全社シミュレーション（本計画書7.6節）が計画中である旨を記載する（実施済みでは
     ないことが分かるように書く）。

# 受け入れ基準（Definition of Done）
- [ ] 上記6ファイルすべてが更新されている
- [ ] 既存の記述（経理会計コアの内容、既存シミュレーション結果等）が削除・上書きされて
      いない
- [ ] テスト・検証資産の記述が、実際に実行して確認した数値（Jest件数、schema
      verifier件数等）と一致している
- [ ] コード変更が一切ないことを`git diff --name-only`で確認する（ドキュメント
      ファイルのみの変更であることを示す）
- [ ] コミットSHA・ブランチ名を明記する（本計画書0.4節）

本タスクはドキュメントのみの変更であり、業務ロジック・DB制約への影響がないため、
通常のREQUEST CHANGES/PASSレビューサイクルは必須としない。ただし、記載内容が実態と
一致しているかについては、Claude（進行管理）が完了報告を確認する。
```

### Claude（進行管理）による確認結果：訂正が必要な事実誤りを発見

完了報告を受け、実際にリポジトリをクローンして内容を確認した。全体として既存記述の
削除はなく、Jest件数・E2Eスクリプト一覧・migration対応関係等は正確だったが、
**実在しないロール名を含む事実誤りを4箇所**で発見した。

- `docs/01_requirements.md` §8.2：`legal_officer`, `procurement_manager`, `hr_admin`,
  `sales_manager`という4つのロール名を挙げているが、これらはコードベースのどこにも
  存在しない（`grep`で全文検索し確認済み）。実際の10ロールは`owner`,
  `accounting_manager`, `accountant`, `approver`, `employee`, `payroll_admin`,
  `viewer_external`, `bookkeeper`, `legal_admin`, `legal_viewer`である。
- `docs/03_database_design.md` 付録：`008a_legal_roles_enum.sql`の説明が
  「`legal_officer`ENUM値の追加」となっているが、実際のファイル内容は
  `legal_admin`・`legal_viewer`の2つのENUM値を追加している。
- `docs/04_technical_reference.md`のE2Eスクリプト表：`verify-contract-rbac-e2e.ts`の
  説明に「法務ロール（`legal_officer`等）」とあるが、スクリプト実体は`legal_viewer`
  ロールのみを使用している。
- `docs/04_technical_reference.md`：トリガー関数名として`fn_guard_recommendation_state_machine`
  を挙げているが、実在する関数名は`fn_guard_recommendation_immutability`
  （`sql/035_recommendation_state_machine_guards.sql`で確認済み）である。

#### 【訂正指示プロンプト】ドキュメント整備の事実誤り修正

```
# 背景・目的
7.5節のドキュメント整備完了報告について、Claude（進行管理）が実際にリポジトリを
確認した結果、実在しないロール名・関数名を含む事実誤りが4箇所見つかった。ドキュメント
の信頼性に関わるため、訂正する。

# 修正対象と内容
1. `docs/01_requirements.md` §8.2「拡張領域における共通設計原則」の
   「権限分掌の全社適用」の記述にある
   `legal_officer`, `procurement_manager`, `hr_admin`, `sales_manager`という
   4つのロール名を削除し、実際にコードベースに存在する10ロール
   （`owner`, `accounting_manager`, `accountant`, `approver`, `employee`,
   `payroll_admin`, `viewer_external`, `bookkeeper`, `legal_admin`,
   `legal_viewer`）のうち、業務別専用ロールの実例（例: `legal_admin`/
   `legal_viewer`＝法務、`approver`＝各種承認、`payroll_admin`＝給与）を正確に
   反映した記述に修正する。
2. `docs/03_database_design.md`「8. 付録: 拡張スキーマ一覧」の
   `008a_legal_roles_enum.sql`の概要を「法務担当ロール（`legal_admin`,
   `legal_viewer`）ENUM値の追加」に修正する（実際のファイル内容と一致させる）。
3. `docs/04_technical_reference.md`のE2Eスクリプト一覧表、
   `verify-contract-rbac-e2e.ts`の説明を、実際にスクリプトが使用しているロール名
   （`legal_viewer`等、実装を確認の上で正確に）に修正する。
4. `docs/04_technical_reference.md`のスキーマ検証カテゴリ説明にある
   `fn_guard_recommendation_state_machine`を、実在する関数名
   `fn_guard_recommendation_immutability`に修正する。

# やってはいけないこと
- 上記4箇所以外の記述（既に正確であることを確認済みの箇所）を不必要に書き換えない。
- 修正の過程で、新たに未確認の固有名詞（ロール名・関数名・ファイル名等）を記載しない。
  記載する場合は、必ず該当するコード・SQLファイルの実物を確認してから記載すること。

# 受け入れ基準（Definition of Done）
- [ ] 上記4箇所すべてが、実際のコードベースと一致する内容に修正されている
- [ ] `git diff --name-only`で、対象2ファイル（`01_requirements.md`,
      `04_technical_reference.md`）と`03_database_design.md`のみが変更されており、
      無関係な変更がないことを確認する
- [ ] 修正後の記述に、新たな未確認の固有名詞が含まれていないことを、該当箇所ごとに
      参照した実ファイルパスとともに完了報告に明記する
- [ ] コミットSHA・ブランチ名を明記する（本計画書0.4節）
```

---

## 7.6 全社シミュレーション（サンプルテナント作成・全ロールUI検証）

ロードマップ完了後の運用検証として、100人規模企業の1年間の業務活動をシミュレートし、
結果をサンプルテナントとして保持、全ロールのアカウントでUIを手動確認する活動を行う。
これは新たな業務機能の開発ではなく、既存実装の検証・データ準備であるため、新しい
Phase・タスクとしては扱わず、本節に独立した記録として残す。

### 前提となる発見事項

リポジトリには既存の`backend/src/scripts/simulate-100-users-year.ts`（決定論的疑似乱数、
実Serviceクラス経由でのデータ生成、SCALE/MONTH_LIMIT環境変数によるスケール調整という
確立されたパターンを持つ）が存在する。ただし、これは**Phase 0〜5の拡張前、経理会計
コア機能のみのスコープ**で作成されたものであり、以下が不足している。
- ロール: `owner`, `accounting_manager`, `employee`, `viewer_external`の4ロールのみを
  作成しており、拡張後に存在する全10ロール（+`accountant`, `approver`, `payroll_admin`,
  `bookkeeper`, `legal_admin`, `legal_viewer`）のうち6ロール分のアカウントがない
- ドメイン: 契約管理（Phase 1）、購買・調達（Phase 2）、内製の人事労務・給与計算
  エンジン（Phase 3）、営業事務（Phase 4）、横断ダッシュボード・AIレコメンド
  （Phase 5）のいずれもシミュレーション対象に含まれていない

### 対応方針

既存スクリプトを書き換えるのではなく拡張し、全10ロールのログイン可能なアカウントと、
Phase 1〜5の各ドメインにまたがる意味のある1年分のデータ（契約更新アラート・
レコメンドが実際に生成される状態を含む）を生成した上で、専用の新規テナントとして
保持する。

#### 【指示プロンプト】全社シミュレーション拡張（サンプルテナント作成）

```
# 背景・目的
ロードマップ（Phase 0〜5）完了後の運用検証として、既存の
`simulate-100-users-year.ts`を拡張し、100人規模企業の1年間の業務活動を、拡張後の
全ドメイン（契約管理・購買調達・人事労務・営業事務・統合最適化）を含めてシミュレート
する。結果は新規の専用サンプルテナントとして保持し、全ロールのアカウントでUIを手動
確認できるようにする。

# 前提となる既存実装
- `backend/src/scripts/simulate-100-users-year.ts`（決定論的疑似乱数・実Service経由での
  データ生成・SCALE/MONTH_LIMIT環境変数によるスケール調整のパターンを踏襲する）
- Phase 0〜5で実装済みの全モジュール・Service

# やってはいけないこと
- 直接SQLでのデータ挿入によるシミュレーション近道をしない。既存スクリプトと同じく、
  実際のServiceクラス・API経由でデータを作成し、業務ロジック・RLS・WORM・承認フロー・
  状態遷移トリガー等を実際に通す（ユーザー作成等、既存スクリプトが既に直接INSERTで
  対応している箇所は、既存の前例に倣ってよい）。
- 既存の`simulate-100-users-year.ts`を全面的に書き換えない。拡張する形にし、既存の
  経理会計コア機能のシミュレーション内容・出力に影響を与えない。
- 本番環境やCI環境ではなく、開発環境（ローカルDocker PostgreSQL等）でのみ実行する。
- 生成するサンプルテナントが、既存の他テナント（テスト用等）のデータと混在・干渉しない
  よう、専用の新規テナントとして作成する。

# 実装対象
1. 全10ロール（owner, accounting_manager, accountant, approver, employee,
   payroll_admin, viewer_external, bookkeeper, legal_admin, legal_viewer）それぞれに
   ついて、最低1名のログイン可能なテストユーザーを作成する。
2. 契約管理（Phase 1）：複数の契約書を作成し、一部は更新期限が近い日付にして、
   P1-T4の更新期限アラートおよびP4-T3の更新提案リンク機能が実際に動作する状態を作る。
   稟議申請（general_requests）も、下書き・承認済み・却下等のステータスを混在させて
   複数件作成する。
3. 購買・調達（Phase 2）：サプライヤーを登録し、年間を通じて発注申請→仕入請求書受領→
   3点照合の流れを複数回実施する。
4. 人事労務（Phase 3）：100名規模の従業員データ・1年分の勤怠記録を生成し、内製の
   給与計算エンジン（`payroll-calculations`、既存の外部インポート
   `payroll-imports`とは別物）で月次給与計算を実行、年末調整も実施する。
5. 営業事務（Phase 4）：見積書・案件（商談パイプライン）を作成し、様々なステージ
   （lead〜won/lost）に分布させる。一部の見積は`sent`のまま長期間放置し、レコメンド
   エンジンのフォローアップ提案条件を満たすようにする。
6. 統合最適化（Phase 5）：上記の結果として、横断KPIダッシュボード・AIレコメンド
   エンジンが意味のある値・提案を返すことを、シミュレーション完了後に軽く確認する。
7. 実行結果として、作成したテナントID、全ロールのログイン情報（メールアドレス・
   パスワード）の一覧、生成したデータ件数のサマリをコンソール出力し、完了報告に含める。

# 受け入れ基準（Definition of Done）
- [ ] 開発環境（Docker PostgreSQL）で実行し、エラーなく完走する
- [ ] 全10ロールのログイン可能なテストアカウントが作成され、一覧が完了報告に明記されている
- [ ] Phase 1〜5の各ドメインについて、最低限の意味のあるデータが生成されている
- [ ] 既存の`simulate-100-users-year.ts`及び経理会計コア機能のシミュレーション内容に
      影響を与えていない
- [ ] 生成されたテナントが既存の他テナントと混在しないことを確認する
- [ ] 完了報告に、サンプルテナントID・全ロールのログイン情報一覧・生成データ件数の
      サマリを明記する
- [ ] コミットSHA・ブランチ名を明記する（本計画書0.4節）

なお、本タスクはコード変更を伴うが性質上「新機能」ではなくテスト・検証用データ生成
ツールの拡張であるため、通常のREQUEST CHANGES/PASSレビューサイクルは必須としない。
ただし、生成ロジックが正規のAPI経路を通っているか（直接SQLの近道をしていないか）等の
懸念があれば、通常通りChatGPT(SO)にレビューを依頼してよい。
```

---

## 8. 既知の技術的負債・フォローアップ事項

タスク完了時にSOが「修正不要だが記録すべき」と判定した事項を追跡する。将来の関連タスク着手時に必ず参照すること。

| ID | 発見タスク | 内容 | 重要度 | 対応予定 | ステータス |
|----|-----------|------|--------|----------|-----------|
| DEBT-001 | P0-T2 | `AttachmentsService.upload()`がファイル実体をディスクへ書き込んだ後にDB transactionを実行しており、DB rollback時に孤児ファイルが残り得る（原子性がない）。P5-T4-FIXで、DBトランザクション失敗時にファイル実体を補償的に削除する処理（`unlink(storagePath)`、`unlink`自体の失敗は元エラーを再throw）を実装した。ただし、これは真の原子性ではなく「DB失敗時の補償削除による緩和」である。プロセスが「ファイル書き込み成功後・DBコミット前」に強制終了した場合、補償削除の`catch`経路自体が実行されないため、孤立ファイルが残り得るリスクは引き続き残存する。S3等のオブジェクトストレージへ移行する際は、transactional outbox等を含めた本格的な整合性設計を検討する。 | LOW（通常の例外経路は補償済み。残存リスクはプロセス強制終了という低頻度事象に限定） | ストレージ本格化タイミングで、transactional outbox等による本格対応を再評価 | 🟡 部分解消（補償処理）。プロセス強制終了時の孤立ファイル残存リスクは受容 |
| DEBT-002 | P0-T3 | `suggested_fields.*.confidence` および `confidenceScore` に0〜1の範囲制約がTypeScript型・Zod入力・JSONB内部のいずれでも実行時に保証されていない。DB制約はJSONB内部までは及ばないため、異常値（例: 1.5, -0.3）が保存され得る。共通スキーマに`z.number().min(0).max(1)`等のruntime validationを追加する必要がある。 | MEDIUM | AIゲートウェイ正式化（複数プロバイダ対応）タイミングで対応 | ℹ️ 受容済み境界として記録（P5-T4トリアージ） |
| DEBT-003 | P0-T3 | 契約書条項抽出（`extractContractTerms()`）は現状ルールエンジン（正規表現ベース）だが、`generateContractSuggestion()`の`model_name`デフォルト値が`claude-3-5-sonnet-20241022`になっており、実際にはLLMを呼んでいないのに監査データ上はClaudeが生成したように見える。`provider='rule_engine'`, `model_name='contract-extractor-v1'`等、実態に即した値に修正し、将来的にはAI Provider/Gateway抽象化（Claude/Gemini/OpenAI/Rule Engineを共通payloadで扱う設計）を正式化する。 | MEDIUM（会計SaaSとして監査追跡性に影響） | Phase 1でAI条項抽出を本格実装するタイミングで対応必須（それまでの暫定値として認識しておく） | ✅ 解消（P1-T2-FIX、model_name='contract-extractor-v1'・provider='rule_engine'として実装済み） |
| DEBT-004 | P0-T4 | 開発・レビュー環境に`psql`クライアントが存在せず、`npm run db:migrate` / `verify_schema.py`のDB接続を伴う実行（実DB E2E検証）が未実施のまま。SQLの静的な安全性（migration runnerの実行順序等）は確認済みだが、実DBに対する動作確認ができていない。CI環境またはローカル開発環境に`psql`（またはコンテナ経由のPostgreSQLクライアント）を整備し、今後のmigrationタスクで実DB E2E確認を標準化する。 | MEDIUM（開発環境整備） | Phase 1のP1-T1（contractsテーブル実装、実DB検証が必須）着手前に対応推奨 | ✅ 解消（P0-T5、実DB E2E 34/34 PASS確認済み） |
| DEBT-005 | P1-T1 | ContractsControllerのCRUD/承認申請APIが`TenantAuthGuard`は通しているが、P0-T4で整備した`contract.create/view/edit/approve/terminate`のpermission（RBAC）を明示的にチェックしていない（既存vendor-bills等と同じパターンを踏襲した結果）。`legal_viewer`が閲覧専用のはずが、現状のAPI実装だけでは書き込み系エンドポイントを呼べてしまう可能性がある。 | MEDIUM〜HIGH（権限外操作の防止に直結） | **P1-T3（契約承認ワークフロー統合）着手時に対応必須** | ✅ 解消（P1-T3、PermissionsGuard導入・Service層でも二重確認済み） |
| DEBT-006 | P1-T1-FIX | `is_explicit_auto_approve=true`の0-stepルールと、1ステップ以上の通常承認ルールが同一ルールセット内に混在していても、現状のロジックは自動承認ルールを優先して選択してしまう（この組み合わせ自体を防ぐ制約がない）。承認ルール管理API/UIを実装する際に、「0-step自動承認ルールは他のstepと同一ルールセットに共存させない」という制約を追加する必要がある。 | LOW〜MEDIUM | 承認ルール管理API/UIの実装タイミング（Phase 1後半、または P1-T3の一部として） | ✅ 解消（P1-T3-FIX、pg_advisory_xact_lockによる並行実行耐性を実DBで確認済み） |
| DEBT-007 | P1-T2 | 現在のPDFテキスト抽出は、テキストが埋め込まれたPDFのみに対応しており、スキャン画像PDF・画像のみのPDFは本文抽出不能として400エラーを返す（フォールバックでダミー処理はしない、安全側の設計）。ただし実際の契約書運用ではスキャンPDFが一定割合存在するため、将来的にはOCR経路（文字なしPDF→OCR→抽出）を追加する必要がある。 | LOW（現状はfail-closedで安全、機能制約のみ） | 契約書アップロード運用の実績を見て、スキャンPDF比率が無視できない場合に対応 | ℹ️ 受容済み境界として記録（P5-T4トリアージ） |
| DEBT-008 | P1-T3 | `PermissionsGuard`がDBの`role_permissions`テーブルを直接参照せず、静的マップ（ROLE_PERMISSIONS）を独自に保持しており、DB側のRBAC定義とAPI側の権限マップが二重管理になっている「RBACドリフト」のリスクがあった。P5-T4-FIXで、`ROLE_PERMISSIONS`とDB`role_permissions`（10ロール/200ペア）を双方向比較し、不足・余剰ゼロを`verify_schema.py`で検証できる機構を追加した。DB参照方式への全面移行は行っていないが、乖離を検知できる状態になった（`verify_schema.py`を実行すれば検知できる、という意味であり、CIでの自動実行までは本タスクの範囲外）。 | LOW（検知機構により静的マップの更新漏れは`verify_schema.py`実行時に発見できる） | CI組み込みや、RBAC管理API/UIを作る際にDB参照方式への統一を再検討 | ✅ 解消（ドリフト検知機構を追加） |
| DEBT-009 | P1-T4 | notificationsテーブルにuser_id/recipient_idが存在せず、契約期限通知は「テナント内の全ユーザーが共有する通知」として実装されている（個人宛ではない）。そのため、あるユーザーが既読にすると同じテナントの他ユーザーからも既読として見える。MVPとしてテナント共通通知に割り切るのは許容範囲だが、将来「契約担当者・承認者・経理・法務」等への個別通知が必要になった場合は、recipient_user_id列の追加とAPIの見直しが必要。 | LOW（MVPとしては仕様として許容） | 個人宛通知の必要性が具体化したタイミングで対応（Phase 1後半〜Phase 2以降） | ℹ️ 受容済み境界として記録（P5-T4トリアージ） |
| DEBT-010 | P1-T5 | `general_requests`のPUT/DELETEが`general_request.edit`権限のみで判定されており、`created_by`（起票者本人）かどうかを確認していなかった。P5-T4-FIXで、Claudeが「起票者本人または管理者相当（owner/admin/legal_admin）のみ編集・削除可能」という仕様を正式に採用し、実装・確認した。さらに、`status !== draft`の場合は本人・管理者いずれであっても409を返すサービス層の制約と、DB側`fn_guard_general_request_transition()`による`active`状態のDELETE・重要列変更・不正な状態遷移の拒否を確認し、「主体判定」と「既存ステータス制約」の両方が矛盾なく多重防御されていることを実DB E2Eで確認した。 | 解消済み | - | ✅ 解消（起票者本人/管理者のみ編集可・ステータス制約との整合を確認） |
| DEBT-011 | P1-T6 | 契約書全文検索のembeddingは、外部embedding APIを呼ばず文字n-gramのハッシュによる疑似embedding（`pseudo-char-ngram-hash-v1`）で生成されている。MVPとしては許容範囲（model_nameも実態を正しく表しており、DEBT-003のような虚偽表示問題は回避できている）が、実運用での検索精度は限定的。将来的には実際のembeddingモデル（OpenAI/Anthropic/オープンソース等）への切り替えを検討する必要がある。 | LOW（検索精度の課題、セキュリティ上の問題ではない） | 契約書全文検索の実運用フィードバックを見て、精度不足が問題になった場合に対応 | ℹ️ 受容済み境界として記録（P5-T4トリアージ） |
| DEBT-012 | P1-T6-FIX | 契約書全文検索の対象は`status='active'`のみに限定されており、`terminated`（解約済み）・`expired`（満了）の過去契約は検索対象に含まれない。「過去契約も参照したい」という業務ニーズが将来生じた場合、`include_inactive`のような明示的なオプションを別タスクとして設計する必要がある。 | LOW（意図的な保守的設計、機能制約） | 過去契約検索の必要性が具体化したタイミングで別タスクとして対応 | ℹ️ 受容済み境界として記録（P5-T4トリアージ） |
| DEBT-013 | P2-T1 | `purchase_requests.request_no`の採番が「現存レコード数（COUNT）+1」方式になっており、advisory lockにより同時実行時の重複は防げるものの、厳密な連番カウンタではない。draftレコードが物理削除可能な設計と組み合わさると、削除されたレコードの番号が将来別の申請で再利用され得る。監査要件が厳格化した場合は、専用sequence/counterテーブル方式への変更を検討する。 | LOW（現仕様の範囲では実害なし） | 監査要件強化、またはrequest_noの一意性・不再利用が業務上必須になったタイミングで対応 | ℹ️ 受容済み境界として記録（P5-T4トリアージ） |
| DEBT-014 | P2-T3 | `purchase_requests`がactiveから`terminated`へ遷移した後も、`vendor_bills.purchase_request_id`によるリンクが自動解除されずに残る。発注取消後も請求書との紐付けが残存し得るため、発注終了・取消と請求書のライフサイクルの関係を厳密に扱う必要が生じた場合は、リンク解除ロジックまたは`terminated`への遷移自体の制限（未精算の紐付けがある場合の遷移拒否等）を別途検討する。 | LOW〜MEDIUM（今回のDoD範囲外、将来の業務要件次第） | 発注取消と請求書処理の関係が業務上重要になったタイミングで別タスクとして対応 | ℹ️ 受容済み境界として記録（P5-T4トリアージ） |
| DEBT-015 | P2-T4 | 購買ダッシュボードの今期集計は`fiscal_years`テーブルの年度設定に追従する設計だが、実DB E2Eでは単純な暦年（2026-01-01〜2026-12-31）のケースしか検証されていない。非暦年の会計年度（例: 4月始まり）や年度またぎのケースでの動作は未確認。 | LOW（現状の実装ロジック自体は妥当と評価されている） | 非暦年の会計年度を持つテナントでの利用実績が出たタイミングで追加検証 | ℹ️ 受容済み境界として記録（P5-T4トリアージ） |
| DEBT-016 | P3-T1 | 勤怠登録時に`break_minutes`（休憩時間）が実際の拘束時間（clock_out - clock_in）を超えないことのバリデーションがAPI/DBいずれにもない。例えば1時間の勤務に対して2時間の休憩を登録できてしまう（計算結果は0時間になるため実害は限定的だが、データとしては不整合）。 | LOW（計算結果への実害は限定的） | 勤怠データの品質チェック機能を追加するタイミングで対応 | ℹ️ 受容済み境界として記録（P5-T4トリアージ） |
| DEBT-017 | P3-T1 | 新規clock-in（新規勤怠レコード作成）では監査ログが記録されるが、既存の未退勤レコードへのclock-in更新では監査ログが記録されない分岐がある。勤怠は労務監査の対象になり得るため、将来的にはすべての変更経路で一貫して監査ログを記録するよう統一する必要がある。 | LOW〜MEDIUM（労務監査の観点で改善余地） | 監査ログの網羅性を見直すタイミングで対応 | ℹ️ 受容済み境界として記録（P5-T4トリアージ） |
| DEBT-018 | P3-T3 | approval_historyのapprover_idについて、DBトリガーは「対象target_typeの承認権限（role_permissions経由）を保有しているか」までは検証しているが、承認ルール（approval_rules）で明示的に指定された`approver_user_id`/`approver_role_id`と完全に一致するかまではDBトリガーで検証していない可能性がある（Service層のassertAssignedApprover()には依存）。承認エンジン全体の改修が必要になり得るため、payroll確定境界のスコープでは対応しなかった。 | MEDIUM（承認者「割当」の厳密性、権限保有チェックとは別軸） | 承認エンジン全体を見直すタイミングで、割当検証もDBトリガーへ移す方針を検討 | ℹ️ 受容済み境界として記録（P5-T4トリアージ） |
| DEBT-019 | P3-T3 | 「DBを最終防御とする」原則には、app_runtimeという単一の共有DBロールでアプリケーション全体がDB操作を行うという構造上の限界がある。app_runtimeの認証情報自体を奪取した攻撃者による生SQL実行時の本人性偽装（実在する権限保持者のUUIDを詐称する等）は、DBトリガーだけでは原理的に防げない。0.5節の受容境界として明文化し、正規API経路での防御（認証済みセッションからのユーザーID強制導出）で担保する方針とした。 | 情報共有（DEBTというより設計上の恒久的な境界の記録） | アーキテクチャの大幅変更（DB接続のユーザー単位分離等）を検討する場合のみ再評価 | ℹ️ 受容済み境界として記録（0.5節参照） |
| DEBT-020 | P3-T3-MERGE | P3-T3のmain反映時、開発環境のDocker Desktopが停止していたため、`verify_schema.py --use-docker`によるmain上でのクリーンDB実DB E2E（P3-T1〜P3-T3の給与計算・勤怠・料率マスタ全体を含む）が未実施。feature branchでのマージ前検証・main上でのJest/型チェック/buildはすべてPASS済みだが、mainブランチそのものでの実DB E2E再実行だけが未完了。**P3-T4でも同じくDocker停止により実DB E2Eが未実行という報告があり、環境側の問題が継続している可能性がある。** | MEDIUM（実DB検証はこのプロジェクトの中核ルールであるため早期解消が望ましい） | Docker Desktop復旧後に対応 | ✅ 解消（Docker復旧後、main上でverify_schema.py 154/154 PASSを確認済み） |
| DEBT-021 | P3-T4-FIX | 年末調整の簡略モデルは現時点でtax_year=2026のみをサポートし、それ以外の年度指定は明示的にエラーとする設計にスコープを限定した（令和7年分・令和8年分等、年度ごとに異なる基礎控除・給与所得控除への対応は今回見送り）。将来複数年度に対応する場合は、P3-T2のinsurance_rate_tablesと同様の有効期間付きマスタ化を検討する。 | MEDIUM（複数年度対応が必要になった時点で本格対応が必要） | 複数年度の年末調整需要が具体化したタイミングで対応 | ℹ️ 受容済み境界として記録（P5-T4トリアージ） |
| DEBT-022 | P4-T1〜T3 | P4-T1・P4-T2のマージ指示プロンプトを発行したが、mainへの実際のマージコミットSHAをGeminiから明示的な報告として受け取っていない。P4-T3の完了報告でmigration 030・P4-T1回帰57/57・P4-T2回帰51/51が確認されていることから、実質的にはP4-T1・P4-T2ともmain相当のブランチに反映されていると推測されるが、本計画書0.4節（コミットSHA明記の徹底）に照らすと記録として不十分。 | LOW（機能的な問題ではなく記録の正確性の問題） | P4-T4-FIXレビュー時にChatGPT(SO)がGitHub履歴から実際のマージコミットSHA（P4-T1:`7317b04`、P4-T2:`8227404`、P4-T3:`b67b356`）を確認 | 🟢 解消済み（SOがGitHub履歴で確認、P4-T4のbaseが`b67b356`であることも整合） |

---

## 9. 次のアクション

本ロードマップ（Phase 0〜Phase 5）の計画タスクはすべて完了した。現在は、運用検証の
一環としてドキュメント整備（7.5節）と全社シミュレーション（7.6節）を進めている。

1. 【指示プロンプト（7.5節）】をGeminiに渡し、README・要件定義書等のドキュメント整備を
   先に実施する（ユーザーの意向により、7.6節の全社シミュレーションより先行させる）。
2. ドキュメント整備完了後、【指示プロンプト（7.6節）】をGeminiに渡し、全社シミュレー
   ション（サンプルテナント作成・全10ロールのアカウント作成）を実施する。
3. 新しい機能要望・業務要件が生じた場合は、本文書に新しいPhase・タスクとして追記し、
   これまでと同じサイクル（指示プロンプト作成→Gemini実装→ChatGPT(SO)レビュー→
   完了/マージ）で進める。
4. DEBT-002, 007, 009, 011〜018, 021の個別の理由付けについて、より正確な記録が
   必要になった場合は、Geminiに再確認する。
5. 未解決DEBT（8節）は、記載された「対応予定」のタイミングが到来した際に都度解消する。

---

## 10. 変更履歴

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
| 7.1.0 | P3-T3-FIX4がSO判定REQUEST CHANGES（承認履歴の実在・権限保有・自己承認排除はDBで検証できているが「権限保持者IDへのなりすまし」は未証明）。Claudeの判断として、これはapp_runtime生SQL実行者の本人性検証というDBトリガーの原理的限界に該当すると結論。**0.5節「DBを最終防御とする原則の限界（受容する境界）」を新設**し、正規API経由での防御が完全であることの確認に方針転換。フォローアップ指示プロンプト（P3-T3-FIX5、API経路でのapprover_idなりすまし不可能性の確認）を追加し、SOへこの判断の妥当性について最終確認を依頼 |
| 7.2.0 | SOがClaudeの受容境界判断（0.5節）自体を妥当と承認。ただしFIX5の実装・テスト・文書化がまだ未提出のため最終PASSは保留。SOが最終確認する3点（4系統の承認APIでapprover_idが認証済みuserIdからのみ決まること／なりすまし攻撃E2Eの防御確認／受容境界のドキュメント化）を明確化 |
| 7.3.0 | P3-T3-FIX5が正式PASS（共通承認API・経費精算専用APIともに承認者IDが認証済みセッションから強制導出されることを確認、DB資格情報奪取時の受容境界をREADMEに文書化）。マージ指示プロンプト（P3-T3-MERGE）を追加しP3-T3を完了扱いに更新（6回の往復）。DEBT-018（承認者割当の厳密なDB検証は未実装）、DEBT-019（app_runtime資格情報奪取時の本人性偽装は受容境界として記録）を追加 |
| 7.4.0 | **計画書全体の整理と見直しを実施。** P3-T3-MERGE完了報告を反映（マージコミットa285721）。マージ時Docker停止によりmain上での実DB E2Eが未実施であることをDEBT-020として記録。冒頭に「エグゼクティブサマリー」を新設し、全Phaseの進捗・直近のフォローアップ事項・確立された恒久ルール・DEBT状況を一覧できるようにした。文書冒頭のバージョン表記を実際の変更履歴と一致させた（1.0.0→7.4.0）。DEBTログ・ロードマップ表・セクション番号の整合性を確認し、矛盾がないことを確認した |
| 7.5.0 | DEBT-020解消のためのフォローアップ指示プロンプト（DEBT-020-VERIFY、Docker復旧後のmain実DB E2E再実行）を追加。**P3-T4（給与明細発行・年末調整）の実装指示プロンプトを新規作成**（P3-T3で確立した確定境界のDB最終防御＋API認証境界パターンの踏襲、5.2節の簡略モデル原則の維持を明記）。これでPhase 3の全4タスクの指示プロンプトが出揃った |
| 7.6.0 | P3-T4がSO判定REQUEST CHANGES（applied_rate_idsが実計算根拠と不一致（LIMIT 1で無関係なレコードを記録）、年分に応じた計算根拠が未整理、Docker停止により実DB E2Eが未実行）。フォローアップ指示プロンプト（P3-T4-FIX）を追加。DEBT-020を更新し、Docker停止がP3-T3-MERGE・P3-T4の複数タスクで再発している環境側の問題である可能性を記録、ユーザー側でのDocker Desktop復旧確認を推奨事項として明記 |
| 7.7.0 | P3-T4-FIXがSO判定CONDITIONAL PASS（applied_rate_idsの実マッチング化・tax_year=2026への明示的限定・created_by tenant整合性の3点は解消、コード修正内容は全てPASS相当。残るはDocker復旧後の実DB E2E実行のみ）。DEBT-021（年末調整は現時点でtax_year=2026のみサポート、複数年度対応は意図的に見送り）を記録。フォローアップ指示プロンプト（P3-T4-VERIFY-AND-MERGE、DEBT-020とP3-T4のE2Eをまとめて実行しマージまで完了させる統合プロンプト）を追加 |
| 7.8.0 | P3-T4が正式PASS（Docker復旧後、main実DB E2E 154/154・P3-T4専用E2E 40/40・Jest 201/201を確認、マージコミット6be18a3）。DEBT-020を解消済みに更新。マージ指示内容を反映しP3-T4を完了扱いに更新。**Phase 3（人事労務）が全4タスク完了**。Phase 3クローズのサマリ（往復回数、確立された恒久ルール、DEBT棚卸し）を追加。ロードマップ表・エグゼクティブサマリーをPhase 3完了に更新 |
| 7.9.0 | **Phase 4（営業事務）のセクションを新設**。6.2節に本Phase特有の設計原則（確定済み見積の不変性、見積→受注の一方向・一度きりの変換、既存の請求書発行・契約管理との統合境界の明確化、AI提案+人間承認パターンの踏襲）を明記。タスク分解（P4-T1〜T4）とP4-T1（見積書：見積作成・確定・受注転換）の実装指示プロンプトを追加。ロードマップ表・エグゼクティブサマリーをPhase 4着手中に更新。以降のセクション番号（旧6〜8節）を1つずつ繰り下げ（7: 技術的負債、8: 次のアクション、9: 変更履歴） |
| 7.9.1 | P4-T1がSO判定REQUEST CHANGES（現時点・証跡未提示のため最終判定保留）。WORMトリガーと`superseded_by`更新処理の仕様矛盾をBLOCKER-01として最優先対応に指定。受注転換時のinvoice自動起票はP4-T1仕様の範囲内と確認（ただしdraft状態限定・設計意図の明記を条件）。同時実行時の二重転換耐性・invoice側tenant_id導出・send/convertエンドポイントの認証主体・WORM対象範囲の網羅性・PDFの日本語文字対応（ASCII化は業務要件と不整合の可能性）を確認事項として整理。フォローアップ指示プロンプト（P4-T1-FIX）を追加し、P4-T1を「要修正・再レビュー待ち」に更新 |
| 7.9.2 | P4-T1-FIXがSO判定REQUEST CHANGES継続。設計面（WORM/`superseded_by`例外/同時実行/invoice側tenant導出/JWT認証主体/日本語PDF）は方向性として妥当と確認され、新たな設計変更要求はなし。残課題はgit diff・実装コード全文・44項目E2Eの個別結果という証跡の未提出のみと整理。証跡提出専用のフォローアップ指示プロンプト（P4-T1-FIX2）を追加 |
| 7.9.3 | P4-T1-FIX2はSO判定REQUEST CHANGES（証跡不足はほぼ解消と評価されたが、実装コード確認により新規BLOCKERが発見された）。`superseded_by`のNULL→非NULL遷移時にDBトリガーがquote_no・version整合性を検証しておらず、無関係な同一tenant見積への直接SQLリンクが可能・UNIQUE制約も未設定であることが判明。DB最終防御原則（0.5節）に反するため、quote_no・version照合の追加検証とUNIQUE制約追加を求めるフォローアップ指示プロンプト（P4-T1-FIX3）を追加。付随して`converted_invoice_id`の参照先整合性を要確認事項として整理 |
| 7.9.4 | P4-T1-FIX3はSO判定REQUEST CHANGES（`superseded_by`の正当性BLOCKERは解消と評価・再掘り下げ不要）。一方、FIX3で新規追加した`invoices.source_quotation_id`について、初期設定時の整合性は確認できたが、設定後のUPDATE・NULL化を防ぐDB防御が未確認という新規BLOCKERを指摘。`invoices`側にも`quotations.superseded_by`と同水準のWORMトリガー・UNIQUE制約（NULL除外）を追加し、双方向リンクの両側を対称に不変化するよう求めるフォローアップ指示プロンプト（P4-T1-FIX4）を追加 |
| 7.9.5 | P4-T1-FIX4はSO判定CONDITIONAL PASS。設計上の主要な未解決点（`superseded_by`正当性、`invoices.source_quotation_id`の後発改変防止）は解消済みと評価され、新たなBLOCKERは報告内容からは見当たらないと明言。残るのは`converted_invoice_id`側の既存ガード（FIX3実装分）が双方向リンク設計下でも実際に機能していることの証跡（SQL全文・E2E個別結果）確認のみ。証跡提出のみを求めるフォローアップ指示プロンプト（P4-T1-VERIFY）を追加。証跡確認後、最終PASSであればマージ指示プロンプトの作成に進む方針を明記 |
| 7.10.0 | P4-T1-VERIFYがSO正式PASS（実DB E2E 57/57・Schema 169/169・clean DB 001〜028、`converted_invoice_id`/`source_quotation_id`双方向リンクの後発改変防止をテスト単位10.3b/10.3c/10.4/10.5/10.6で確認）。**P4-T1（見積書）が実装面で完了**。マージ指示プロンプトを追加（マージ手順・マージ後のmain実DB E2E再検証を指示）。P4-T1のマージを前提に、P4-T2（案件管理：商談パイプライン）のタスク詳細・実装指示プロンプトを追加。ロードマップ表・エグゼクティブサマリーをP4-T1 PASS（マージ待ち）に更新 |
| 7.10.1 | P4-T2はSO判定CONDITIONAL PASS（terminal状態のDB最終防御・tenant分離・`quotations.deal_id`連携・P4-T1回帰57/57等の主要設計は妥当、明確なBLOCKERなし）。非terminalステージ間の遷移順序についてClaudeが設計方針を確定（terminal以外は自由遷移）。`owner_user_id`のFK/tenant境界・認証actor実装・`closed_at`後発改変防止・git diffスコープの4点を証跡確認事項として整理し、フォローアップ指示プロンプト（P4-T2-VERIFY）を追加 |
| 7.11.0 | P4-T2-VERIFYがSO正式PASS（実DB E2E 51/51・Schema 176/176・P4-T1回帰57/57・clean DB 001〜029、非terminalステージの自由遷移設計・`owner_user_id`のFK/tenant境界・認証actor・`closed_at`後発改変防止・git diffスコープをすべて実DB証跡で確認）。**P4-T2（案件管理）が実装面で完了**。マージ指示プロンプトを追加（P4-T1のマージコミットSHA未確認分の確認も含む）。P4-T2のマージを前提に、P4-T3（契約更新連携）のタスク詳細・実装指示プロンプトを追加。ロードマップ表・エグゼクティブサマリーを更新 |
| 7.11.1 | P4-T3はSO判定CONDITIONAL PASS（明示操作によるdeal作成・自動確定なし・RLS/tenant整合性・RBAC等の基本設計は妥当、明確なBLOCKERなし）。`contract_renewal_links`の一意性・不変性・`quotation_id`の正当性・複数顧客候補時の扱い・RBAC権限構成・`deals.mapper.ts`変更の必要性・git diffスコープを要確認事項として指摘。Claudeが4点の設計を確定（1契約に複数リンク許可・1dealは1契約のみ・quotation_idは一度限りの遷移かつdeal_id一致要求・contract-renewal-link.create単独で機能利用可・顧客自動探索は完全一致のみでfail-closed）し、UNIQUE制約・WORMトリガー追加と証跡確認を求めるフォローアップ指示プロンプト（P4-T3-VERIFY）を追加。P4-T1・P4-T2のマージコミットSHA未確認をDEBT-022として記録 |
| 7.12.0 | P4-T3-VERIFYがSO正式PASS（regression 189/189、clean DB 001〜031、`contract_renewal_links`のUNIQUE制約・WORM・`quotation`↔`deal`正当性検証・顧客自動探索fail-closed化をすべて確認）。**P4-T3（契約更新連携）が実装面で完了**。マージ指示プロンプトを追加（DEBT-022解消のためP4-T1・P4-T2のマージコミットSHA確認も併せて指示）。P4-T3のマージを前提に、Phase 4最終タスクとなるP4-T4（営業ダッシュボード・レポート）のタスク詳細・実装指示プロンプトを追加。ロードマップ表・エグゼクティブサマリーを更新 |
| 7.12.1 | P4-T4はSO判定REQUEST CHANGES（実装コード・集計ロジック・RBAC・migration・git diffスコープは良好、作り直しではなく実質1点の修正）。実DB E2Eが`postgres`superuser接続のまま実行されておりRLSを実際には経由していないことが判明（PostgreSQLのsuperuserはFORCE RLSでも常にバイパスするため）。E2Eを既存の`DatabaseService.transaction()`（app_runtimeロール・tenant context経由）に修正するよう求めるフォローアップ指示プロンプト（P4-T4-FIX）を追加。併せて完了報告内のJest/schema verifier/E2E/clean DB migrationの数字の混同について報告表現の整理を指示 |
| 7.13.0 | P4-T4-FIXがSO正式PASS・mainマージ可能（`app_runtime`ロール・tenant context下でのRLS実DB検証、Tenant B直接不可視0件確認、実DB E2E 81/81・Jest 241/241・schema verifier 194/194）。SOがGitHub履歴からP4-T1〜T3の実際のマージコミットSHA（`7317b04`・`8227404`・`b67b356`）を確認し、**DEBT-022を解消済みに更新**。P4-T1〜T3の各タスク行にマージコミットSHAを反映。P4-T4のマージ指示プロンプトを追加（マージ完了でPhase 4全4タスク完了となる） |
| 7.14.0 | P4-T4のmainマージ完了報告を受領（マージコミット`f697778`、main上でclean DB 001〜032・実DB E2E 81/81・schema verifier 194/194・Backend Jest 28 suites/241 tests・Frontend buildすべて確認済み）。**Phase 4（営業事務）が全4タスク完了**。ロードマップ表・エグゼクティブサマリーをPhase 4完了に更新し、Phase 4クローズのサマリ（往復回数、確立された恒久ルール、DEBT棚卸し）を追加。**Phase 5（統合最適化）のセクションを新設**。7.2節に本Phase特有の設計原則（横断ダッシュボードは既存ドメインのRLS/RBACを迂回しない、AIレコメンドは提案に留め業務データを自動変更しない、根拠データは閲覧者の権限範囲に限定、監査可能性）を明記。タスク分解（P5-T1〜T4）とP5-T1（横断KPIダッシュボード基盤）の実装指示プロンプトを追加。以降のセクション番号（旧7〜9節）を1つずつ繰り下げ（8: 技術的負債、9: 次のアクション、10: 変更履歴） |
| 7.14.1 | P5-T1はSO判定REQUEST CHANGES（RLS実DB検証・tenant分離・二重認可・Git証跡は良好、明確なBLOCKERはDoD違反1点）。`ExecutiveDashboardService`が既存の`SalesDashboardService`（P4-T4）・`PurchaseDashboardService`（P2-T4）等を呼び出さず、独自SQLで集計ロジックを重複実装していたことが判明（P5-T1のDoD「既存ロジックを呼び出し、重複実装しない」への違反）。ExecutiveDashboardServiceを薄いレイヤー化し、不足メソッドは各ドメインのService側に追加した上で呼び出す方針の修正を求めるフォローアップ指示プロンプト（P5-T1-FIX）を追加 |
| 7.15.0 | P5-T1-FIXがSO正式PASS（`ExecutiveDashboardService`を各ドメインServiceへの委譲のみで構成する薄いオーケストレーターに再設計、委譲結果とドメインService直接呼出結果の実DB一致検証、RLS実DB検証・RBAC・ゼロ除算・WORM非破壊すべて確認）。**P5-T1（横断KPIダッシュボード基盤）が実装面で完了**。マージ指示プロンプトを追加。P5-T1のマージを前提に、P5-T2（AIレコメンドエンジン基盤）のタスク詳細・実装指示プロンプトを追加。「AIレコメンド」を外部LLM API不使用のルールベース推奨エンジンとする設計方針をClaudeが確定 |
| 7.15.1 | P5-T2はSO判定REQUEST CHANGES（既存Service委譲・業務テーブル非変更・RLS実DB検証・外部LLM不使用は良好、明確なBLOCKERは状態遷移モデルの整理不足1点）。`recommendations`の「WORM」と`accept`/`dismiss`によるstatus更新が矛盾している点が指摘され、Claudeが「完全WORMではなく`pending→accepted`/`pending→dismissed`の一度限りの遷移のみを許可するappend-only設計」という定義を確定。それ以外の状態遷移・status以外の列変更・DELETEをDBトリガーで一貫拒否する修正、`target_domain`未知値のfail-closed確認、RBACマトリクス確認、git diffによる既存テスト弱体化なしの確認を求めるフォローアップ指示プロンプト（P5-T2-FIX）を追加 |
| 7.16.0 | P5-T2-FIXがSO正式PASS（状態遷移モデル・不変列WORM・DELETE禁止・unknown target_domainのfail-closed・RBACマトリクス・Tenant B不可視をすべて実DB検証、既存テスト弱体化なしをgit diffで確認）。**P5-T2（AIレコメンドエンジン基盤）が実装面で完了**。マージ指示プロンプトを追加（P5-T1のマージ状況確認も併せて指示）。P5-T2のマージを前提に、P5-T3（レコメンドの業務画面への統合表示）のタスク詳細・実装指示プロンプトを追加 |
| 7.17.0 | P5-T3がSO正式PASS（`target_domain`+`target_id`による厳密な絞り込み、tenant境界、業務閲覧権限との連動、P5-T2 accept/dismiss基盤の再利用をすべて実DB検証、修正指示不要）。**P5-T3（レコメンドの業務画面への統合表示）が実装面で完了**。マージ指示プロンプトを追加（P5-T1・P5-T2のマージ状況確認も併せて指示）。P5-T3のマージを前提に、**P5-T4（技術的負債の棚卸し・解消とPhase 5クローズ）**——ロードマップ全体の最終タスク——のタスク詳細・実装指示プロンプトを追加。DEBT-001・008・010の解消を推奨し、それ以外は受容済み境界として整理する方針を明記 |
| 7.17.1 | P5-T4はSO判定REQUEST CHANGES（実装・検証量は十分、DEBT-008は現状の証跡でPASS相当）。DEBT-001を「解消」とした表現が不正確（実際はDB失敗時の補償削除による緩和であり真の原子性ではない）、DEBT-010が主体判定のみで既存ステータス制約との組み合わせ未確認、E2E件数表記の不整合、Phase全体クローズの表現の精度、の4点を指摘。ClaudeがDEBT-001を「部分解消（補償処理）、残存リスクを明示」する記録方針に確定し、DEBT-010のステータス別追加確認・数字整合・表現修正を求めるフォローアップ指示プロンプト（P5-T4-FIX）を追加 |
| 7.18.0 | P5-T4-FIXがSO正式PASS・マージ可能（DEBT-001の表現修正、DEBT-010のステータス制約[status!==draftで409＋DBトリガーでactive状態の変更拒否]確認、E2E件数261/261・93/93・209/209の整合、Phase全体クローズ表現の精度、すべて解消）。DEBT-001を「🟡部分解消」、DEBT-008・DEBT-010を「✅解消」に8節を更新。**本タスクはロードマップ（Phase 0〜5）の最終タスク**。マージ指示プロンプトを追加し、P5-T1〜T4すべてのマージコミットSHAの一括確認と、残りのDEBTトリアージ結果一覧の再提示を求めた。マージ完了後にPhase 5全4タスク完了・ロードマップ全体完了として計画書を更新する予定 |
| 7.19.0 | P5-T4のmainマージ完了報告を受領。P5-T1（`28c4f75`）・P5-T2（`0da4b87`）・P5-T3（`c63382f`）・P5-T4（`8d15cca`）すべてのマージコミットSHAをmainのコミット履歴で確認し、main上でclean DB 001〜035・実DB E2E 93/93・schema verifier 209/209・Backend Jest 261/261・Frontend buildをすべて確認済み。**Phase 5（統合最適化）が全4タスク完了し、ロードマップ全体（Phase 0〜Phase 5）が完了**。Phase 5クローズのサマリ・プロジェクト全体総括を7節に追加。DEBT-002, 007, 009, 011〜018, 021をGeminiのP5-T4トリアージ結果に基づき「対応しない・受容済み境界」に更新（個別の理由付け文章はDEBT番号との対応関係が一部判然としなかったため、既存の詳細記述を保持しつつ結論のみ反映）。ロードマップ表・タスク表を全Phase完了に更新し、次のアクション（9節）を「新規タスクはなし、追加要望が生じた場合に追記」に更新 |
| 7.19.1 | ロードマップ完了後の運用検証として、100人規模企業1年間シミュレーションの拡張・サンプルテナント作成・全ロールUI手動確認の活動を7.5節に追加。既存の`simulate-100-users-year.ts`が経理会計コア機能のみのスコープ（4/10ロール、Phase 1〜5未対応）であることを発見し、全10ロールのアカウント作成とPhase 1〜5の全ドメインを含むデータ生成を求める指示プロンプトを作成 |
| 7.19.2 | 外部レビュー（Qwenによるリポジトリ評価）を受け、README・要件定義書等の主要ドキュメントがPhase 0〜5拡張前（経理会計コアのみ）の内容のままであることが判明。ドキュメント整備タスクを7.5節として新設し（全社シミュレーションは7.6節に繰り下げ）、README・01_requirements・02_architecture・03_database_design・04_technical_reference・PROJECT_HISTORYの6ファイルについて、既存記述を削除せず拡張後の実態（Phase 1〜5のスコープ、確立された設計原則、実際のテスト規模）を追記する指示プロンプトを作成。ユーザーの意向によりドキュメント整備を全社シミュレーションより先行させる方針とした |
| 7.19.3 | 7.5節ドキュメント整備の完了報告（コミット`9ce9803`）に対し、Claude（進行管理）が実際にリポジトリをクローンして確認した結果、実在しないロール名（`legal_officer`, `procurement_manager`, `hr_admin`, `sales_manager`）と実在しない関数名（`fn_guard_recommendation_state_machine`）を含む事実誤りを4箇所発見。既存記述の削除・Jest件数・E2Eスクリプト一覧・migration対応関係等、その他の記載内容は正確であることも確認済み。該当4箇所の訂正指示プロンプトを追加 |
