# Phase 1: 総務・法務（契約管理・稟議ワークフロー）詳細記録

> [← 計画書本体に戻る](../backoffice_expansion_plan.md) | [サマリを見る](../backoffice_expansion_summary.md)

本ドキュメントは、`docs/backoffice_expansion_plan.md` から分割された Phase 1 の全実装指示プロンプト、SOレビュー結果、FIXプロンプト、マージ指示の完全な全文記録です（要約・省略なし）。

---

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

