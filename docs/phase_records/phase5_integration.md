# Phase 5: 統合最適化（全社ダッシュボード・AIレコメンド）詳細記録

> [← 計画書本体に戻る](../backoffice_expansion_plan.md) | [サマリを見る](../backoffice_expansion_summary.md)

本ドキュメントは、`docs/backoffice_expansion_plan.md` から分割された Phase 5 の全実装指示プロンプト、SOレビュー結果、FIXプロンプト、マージ指示の完全な全文記録です（要約・省略なし）。

---

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

