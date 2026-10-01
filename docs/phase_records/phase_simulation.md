# 全社シミュレーション・ドキュメント整備・RBAC是正 詳細記録

> [← 計画書本体に戻る](../backoffice_expansion_plan.md) | [サマリを見る](../backoffice_expansion_summary.md)

本ドキュメントは、`docs/backoffice_expansion_plan.md` から分割された 7.5節 ドキュメント整備、7.6節 全社シミュレーション、migration 036レビュー依頼および実DB Before/After実証指示プロンプト・往復全記録です（要約・省略なし）。

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

### Claude（進行管理）による訂正の検証結果：確認済み・7.5節クローズ

訂正完了報告（コミット`39b42e9`）を受け、Claudeが再度リポジトリをフェッチし、
修正差分を直接確認した。
- 対象4箇所（`01_requirements.md`§8.2、`03_database_design.md`付録の
  `008a_legal_roles_enum.sql`説明、`04_technical_reference.md`のE2Eスクリプト表・
  トリガー関数名）が、いずれも実ファイル（`permissions.guard.ts`,
  `008a_legal_roles_enum.sql`, `verify-contract-rbac-e2e.ts`,
  `035_recommendation_state_machine_guards.sql`）の内容と正確に一致する記述に
  修正されていることを確認した。
- `verify-contract-rbac-e2e.ts`の実コードを直接確認し、`legal_admin`・
  `legal_viewer`の両ロールが実際にテストされていることも裏取りした。
- リポジトリ全体を`legal_officer`, `procurement_manager`, `hr_admin`,
  `sales_manager`, `fn_guard_recommendation_state_machine`で検索し、
  ヒットがゼロであることを確認した（修正漏れなし）。
- 差分は指示した対象ファイルのみに限定されており、スコープ逸脱はなかった。

**7.5節（ドキュメント整備）はこれで完了・クローズとする。** 次は7.6節
（全社シミュレーション）に進む。

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

### Claude（進行管理）による確認結果：環境の信頼性に懸念、再実行を指示

完了報告（コミット`1f378b9`、ブランチ`feature/full-enterprise-simulation`）を受け、
実際にブランチをフェッチして差分・作業ログを確認した。

**評価できる点**：`backend/src/modules/suppliers/suppliers.module.ts`に
`AuditLogsModule`のimportが欠落しているという、Phase 2（P2-T2）から見過ごされていた
実在するモジュール配線バグを発見・修正した。`AuditLogsModule`は`@Global()`ではなく、
`SuppliersService`が直接`AuditLogsService`を注入しているため、これは正規のNestJS DI
コンテナ経由では解決できない状態だったはずである。既存の`verify-suppliers-e2e.ts`が
Serviceを手動インスタンス化する方式であるため検出されず、今回のシミュレーションが
初めてNestJSの正規DIコンテナ経由での起動を実際に検証したことで発見できたと考えられる。
この修正はコード差分として正しくコミットされている。

**懸念点**：作業ログを見ると、Geminiは新規`apply-pending-migrations.js`を作成し、
「001〜007は適用済みと推測」して`schema_migrations`テーブルを手動整備した上で、
以下を素のSQLで直接パッチしている。
- `role_permissions`への`INSERT`（`expense_report.approve`等、Phase 0由来のはずの
  基本権限）
- `roles.name`への`UPDATE`（法務ロールの表示名変更）
- `app_runtime`への`GRANT`文の再実行

これらは新規migrationファイルとして記録されておらず、コミット差分にも含まれていない。
使用したローカルDockerコンテナが、リポジトリの`sql/001〜035`を順番に適用した
「クリーンな検証済みスキーマ」ではなく、長期間の開発作業で中途半端にしか移行されて
いなかった環境であった可能性が高い（P5-T4の正式SOレビューでは、クリーンDBで
`role_permissions`が「DB 200組↔Guard 200組、差分ゼロ」と確認済みであり、正しく
移行されたDBであれば本来このような欠落は起きないはずである）。また、
`suppliers.module.ts`のコード変更後に、既存のBackend Jest（261件想定）・
`verify_schema.py`（209件想定）の再実行結果が報告に含まれていない。

これらを解消してから、シミュレーション結果・サンプルテナントを正式なものとして
扱うため、以下の訂正・再実行を指示する。

#### 【訂正・再実行指示プロンプト】クリーン環境での100人シミュレーション再実行

```
# 背景・目的
今回の100人シミュレーションは、長期間使われてきたローカルDockerコンテナ（移行が
中途半端で、手動SQLパッチを要した環境）に対して実行された疑いがある。サンプル
テナント・全ロールアカウントを正式な検証成果として扱うため、クリーンな環境で
再実行し、結果の信頼性を担保する。

# 前提となる既存実装
- `docker-compose.yml`（開発用PostgreSQLコンテナ定義）
- `sql/001〜035`（すべてのmigrationファイル。app_runtimeへのGRANT等、必要な権限設定は
  本来これらのファイル内で完結しているはずである）
- 修正済みの`backend/src/modules/suppliers/suppliers.module.ts`（AuditLogsModule
  importの追加）

# やってはいけないこと
- 今回のように、migrationの適用漏れや権限不足を素のSQL（`docker exec ... psql`での
  直接INSERT/UPDATE/GRANT）でその場しのぎに埋めない。スキーマ・データ上の変更が
  必要な場合は、必ず新規migrationファイルとして追加し、コミットする。
- 「おそらく適用済み」といった推測でmigration適用状態を判断しない。クリーンな状態から
  確実に検証する。

# 実施手順
1. 既存のローカルDocker PostgreSQLコンテナ（`keiri_kaikei_pg`等）を停止・削除し、
   ボリュームも含めて完全に破棄する。
2. 新しいコンテナを起動し、まっさらな状態から`sql/001〜035`を、リポジトリの
   `scripts/db-migrate.js`（または`verify_schema.py`が内部で使っている正規の手順）で
   順番に適用する。手動で作成した`apply-pending-migrations.js`は、正規の移行手順が
   別に存在するのであればこの機会に削除するか、正式なツールとして整備するかを
   判断し、理由とともに完了報告に明記する。
3. `python scripts/verify_schema.py --use-docker`を実行し、209件（またはこの間の
   ドキュメント整備・suppliers.module.ts修正を反映した最新件数）がすべてPASSする
   ことを確認する。**この時点で`role_permissions`・`roles`テーブルの内容が、手動
   パッチなしで正しい状態（Guard静的マップと200組完全一致）になっているかを確認する。**
   - もし一致していれば、前回の「欠落」は今回破棄した古い環境固有の問題であったと
     確定できる。前回の手動パッチ（INSERT/UPDATE/GRANT）は不要だったことになる。
   - もし依然として欠落が再現する場合は、これは本物の製品バグである。その場合は
     新規migrationファイル（例: `sql/036_role_permissions_fix.sql`）を作成して
     appendonly原則に従って追加し、根本原因（該当permissionやrole_permissions行が
     そもそもどの既存migrationにも存在しない等）を完了報告に明記すること。
4. `npm test`（Backend Jest）を実行し、`suppliers.module.ts`の修正を含めて全件PASSする
   ことを確認する（既存261件からの増減があれば理由を明記する）。
5. 上記すべてがPASSした、正真正銘クリーンな環境に対して、7.6節の元の指示プロンプト
   （全社シミュレーション拡張）を再実行する。
6. 実行中に作成された中間テナント（スモークテスト用ドメイン等）が、最終的な
   サンプルテナント以外すべて削除されていることを、SQLクエリの実行結果とともに
   完了報告に明記する。

# 受け入れ基準（Definition of Done）
- [ ] クリーンな（過去の手動パッチを含まない）Dockerコンテナで一連の作業を実施した
      ことを明記する
- [ ] `verify_schema.py --use-docker`が全件PASSし、`role_permissions`の欠落が
      再現するかしないかの結論が明記されている
- [ ] 欠落が再現した場合、新規migrationファイルとして追加され、既存ファイルの書き換えが
      ないことを確認する
- [ ] `suppliers.module.ts`の修正を含めてBackend Jestが全件PASSする
- [ ] 中間テナントがすべて削除され、最終サンプルテナントのみが残っていることを確認する
- [ ] 上記を満たした上で、サンプルテナントID・全ロールのログイン情報一覧・生成データ
      件数のサマリを完了報告に明記する
- [ ] コミットSHA・ブランチ名を明記する（本計画書0.4節）
```

### Claude（進行管理）による確認結果：本物の製品バグと確定、修正を検証済み

完了報告（コミット`bb954ec`、ブランチ`feature/full-enterprise-simulation`）を受け、
実際にブランチをフェッチして修正内容を検証した。

**確定した事実**：クリーンに再構築したDocker環境でも同じ欠落が再現したことから、
これは環境の汚れではなく**Phase 0の初期migration（`001_initial_schema_all_in_one.sql`）
の時点から存在していた本物の製品バグ**であったことが確定した。`journal_entry.create/
post/void`, `invoice.issue`, `vendor_bill.approve`, `payment_batch.export`,
`expense_report.approve`, `payroll.import`, `tax_return.finalize`という、経理業務の
根幹に関わる9個のpermissionが、`owner`・`accounting_manager`等の主要ロールの
`role_permissions`に一度も紐付けられていなかった。

**なぜ今まで発見されなかったか**：DEBT-008のRBACドリフト検知は、`PermissionsGuard`の
静的マップとDBの`role_permissions`を**相互に比較して差分を検出する**方式である。
今回のケースは両者が「揃って同じ欠落を持っていた」ため、差分がゼロとなり、
ドリフト検知は正しく機能していたにもかかわらず検出できなかった。これはドリフト検知
方式に内在する盲点であり、実際の業務フローを通しで動かす大規模シミュレーションのような
検証でしか発見できない種類の不具合だったと言える。

**修正内容の検証**：Claudeが実際にリポジトリをフェッチし、以下を直接確認した。
- `sql/036_role_permissions_and_grants_fix.sql`は新規ファイルとして追加されており、
  既存の`001〜035`は一切変更されていない（append-only原則を遵守）
- 追加された25個のrole-permissionペア（owner 9件、accounting_manager 9件、
  accountant 3件、approver 2件、bookkeeper 1件、payroll_admin 1件）が、
  `permissions.guard.ts`の`ROLE_PERMISSIONS`静的マップへの追加と**完全に一致**して
  いることを確認した（200+25=225組、報告と一致）
- `scripts/verify_schema.py`の変更は、新規migration 036の適用を検証パイプラインに
  正しく組み込む追加のみであり、既存の検証ロジックを弱めるような変更ではないことを
  確認した
- `scripts/db-migrate.js`が`sql/`ディレクトリを動的にスキャンする実装であるため、
  036は今後のクリーンな移行で自動的に適用されることを確認した
- Claude自身の環境で`npx tsc --noEmit`と`npx jest`を実行し、**Backend Jest
  30 suites/261 tests全件PASS**を独立に再現・確認した（実DB接続を要するE2Eスクリプト
  自体は本環境では実行できないが、ユニット/統合テスト層は完全に再現できた）
- `apply-pending-migrations.js`が削除され、正規の`scripts/db-migrate.js`に一本化
  されたことを確認した

**この発見から追加する恒久ルール**：DEBT-008のようなドリフト検知（2つのソース間の
差分検出）は、両ソースが同時に同じ欠落を持つケースを検出できないという構造的な盲点が
ある。これを補うため、定期的に実際の業務フローを通しで動かす大規模シミュレーション
（本節のようなもの）を実施し、コードレビューだけでは発見できない類の不具合を
炙り出すことが有効である、という教訓を記録する。

**7.6節（全社シミュレーション）は、この検証をもって完了・クローズとする。**
サンプルテナント（テナントID`c697a583-57e8-4a55-9380-86c31d205f0c`、全10ロール分の
ログインアカウント）はUI手動確認に使用してよい状態にある。

なお、今回発見された修正（migration 036・PermissionsGuardの変更）は経理業務の根幹に
関わるRBAC修正であるため、念のためChatGPT(SO)による形式的なレビューを推奨する
（必須ではないが、この規模の修正には見合う価値がある）。

#### 【レビュー依頼】migration 036・PermissionsGuard修正（P0由来のRBAC欠落の是正）

ユーザーの意向により、mainへのマージ前にChatGPT(SO)のレビューを挟む。以下を
ChatGPT(SO)にそのまま提示すること。

```
# レビュー依頼：sql/036_role_permissions_and_grants_fix.sql ＋ PermissionsGuard修正

対象リポジトリ: somurye/fullstack-ai-accounting
対象ブランチ: feature/full-enterprise-simulation
対象コミット: bb954ec（直前のsuppliers.module.ts修正コミットも含む）
比較元: main（8d15cca）

# 背景
Phase 0〜5のロードマップ完了後、100人規模・1年間の全社シミュレーションを実施した
ところ、経理業務の根幹に関わる9個のpermission
（journal_entry.create/post/void, invoice.issue, vendor_bill.approve,
payment_batch.export, expense_report.approve, payroll.import,
tax_return.finalize）が、owner・accounting_manager等の主要ロールの
role_permissionsに一度も紐付けられていないことが判明した。クリーンに再構築した
Dockerコンテナでも再現したため、Phase 0の`001_initial_schema_all_in_one.sql`
時点から存在していた本物の欠落と確定している。

この欠落は、既存のDEBT-008 RBACドリフト検知（PermissionsGuardの静的マップと
DBのrole_permissionsを相互比較する方式）では検出できなかった。両ソースが
「揃って」同じ欠落を持っていたため、差分がゼロとなり検知をすり抜けていたためである。

# 今回の修正内容
1. `sql/036_role_permissions_and_grants_fix.sql`（新規migration、001〜035は無変更）
   - owner: 9件、accounting_manager: 9件、accountant: 3件、approver: 2件、
     bookkeeper: 1件、payroll_admin: 1件、計25件のrole-permissionペアを
     role_permissionsテーブルへ追加
   - `payslips`・`year_end_adjustments`テーブルへの`app_runtime`向けGRANT文
     （sql/025で記載漏れだったもの）を追加
2. `backend/src/common/guards/permissions.guard.ts`
   - `ROLE_PERMISSIONS`静的マップに、上記25件と完全に一致する権限を追加
   （viewer_externalは仕様通り空配列のまま）
3. 併せて、`backend/src/modules/suppliers/suppliers.module.ts`に
   `AuditLogsModule`のimport漏れ（Phase 2から存在、AuditLogsModuleは@Global()では
   ないため正規のDIコンテナ経由では解決できない状態だった）を修正するコミットが
   直前に含まれている。

# 依頼したいレビュー観点
1. **追加された25件のrole-permissionペアの妥当性**：各ロールに対して、経理業務の
   実務上、本当にそのpermissionを持つべきかを判断してほしい（例:
   owner/accounting_manager/accountantへのjournal_entry.*系権限付与は妥当と思われるが、
   過剰な権限付与になっていないかも含めて確認してほしい）。
2. **migration 036が既存のWORM・tenant整合性トリガー・既存のrole_permissions行に
   悪影響を与えていないか**（INSERT文がON CONFLICT DO NOTHING等で安全に冪等か、
   既存行を書き換えていないか）。
3. **実DB E2Eでの確認**：可能であれば、今回追加した9個のpermissionのうち代表的な
   もの（例: owner/accounting_managerによるexpense_report.approve実行、
   journal_entry.post実行）が、修正後は実際に成功し、修正前は
   `does not hold required permission`エラーで拒否されていたことを、実DBで
   再現・確認してほしい。
4. **DEBT-008ドリフト検知の200→225組への変更が正しく反映されているか**
   （`verify_schema.py`の該当セクションが225組一致を正しく検証しているか）。
5. **`suppliers.module.ts`のAuditLogsModule import追加が、他のモジュールの循環
   依存等を引き起こしていないか**。

# 判定基準
本計画書のこれまでのレビュー基準（実DB検証、fail-closed、append-only、tenant整合性）
に準じて、PASS / CONDITIONAL PASS / REQUEST CHANGESで判定してほしい。
```

### SOレビュー結果：CONDITIONAL PASS（実DB証跡の追加が必要）

ChatGPT(SO)より、migration 036・PermissionsGuard修正の**設計自体は妥当**（25件の
role-permissionペアは最小権限・職務分掌の観点で自然、append-only・冪等性・WORM/RLSへの
非干渉も確認済み、`suppliers.module.ts`のDI修正も問題なし）と評価された。一方、
「実DBで欠落が実際に解消されたことの直接証拠」が不足していること、migrationの
fail-closed性に改善余地があること、ドキュメントの「200組」表記が更新されていない
ことが指摘された。特にDEBT-008については、今回のケース（DBとGuardが両方揃って
同じ欠落を持つ）は今後も検知できないという構造的限界がある点をSOも確認しており、
これは既に本計画書のDEBT-008記録・恒久ルール10番に反映済みである。

#### 【フォローアップ指示プロンプト】実DB証跡の追加・migrationのfail-closed化・ドキュメント更新

```
# 背景・目的
ChatGPT(SO)よりmigration 036・PermissionsGuard修正はCONDITIONAL PASSと判定された。
設計自体への修正要求ではなく、実DBでの効果の実証と、migrationの堅牢化、ドキュメントの
更新が中心である。

# 対応事項

## 1. 修正前→修正後の実DB証跡（最重要）
クリーンなDocker PostgreSQL環境で、以下を実DBで確認し、完了報告に明記すること。
- 036適用前（001〜035のみ適用した状態）で、`accounting_manager`ロールのユーザーが
  `expense_report.approve`相当の操作（経費申請承認）を実行すると、DBトリガーにより
  `42501 / does not hold required permission`相当のエラーで拒否されることを確認する
- 同様に、`owner`または`accounting_manager`による`journal_entry.post`相当の操作
  （仕訳確定）も、036適用前は拒否されることを確認する
- 036適用後、上記2つの操作がいずれも成功することを確認する
- 上記のBefore/After比較を、専用のE2Eテスト（例:
  `backend/src/scripts/verify-role-permissions-fix-e2e.ts`）として追加し、
  再現可能な形で残す

## 2. migration 036のfail-closed化
現在のmigration 036は、対象のrole/permissionがDBに存在しない場合でも
`INSERT 0件`のままmigration自体は成功してしまう構造になっている。以下のいずれかの
方法で、想定通りの行が挿入されたことをmigration自身が保証する形に修正すること。
- INSERT文の実行後に、期待される行数（25件）が実際に存在するかを検証し、一致しない
  場合は例外を発生させてmigrationを失敗させる
- または、対象のrole/permissionがすべて存在することを事前にチェックし、存在しない
  場合はfail-closedで停止する
既存のmigration（026〜031等の一度限りの遷移パターン等）で確立した「想定と異なる
状態を検知したら止まる」という設計思想を踏襲すること。

## 3. `role_permissions`・`PermissionsGuard`件数（225組）の実DB確認
クリーンDB上で、`role_permissions`が225組、`PermissionsGuard.ROLE_PERMISSIONS`も
225組であり、両者が完全一致することを、`verify_schema.py`の実行結果として改めて
明記すること。

## 4. `payslips`・`year_end_adjustments`のGRANT確認
`app_runtime`ロールで、実際に`payslips`・`year_end_adjustments`テーブルへの
SELECT/INSERT/UPDATE/DELETEが可能であることを実DBで確認すること。

## 5. ドキュメントの225組への更新
README・`docs/04_technical_reference.md`等、7.5節のドキュメント整備で「200組」と
記載した箇所を、225組（036適用後の状態）に更新すること。あわせて、7.5節・7.6節で
Claudeが記録したDEBT-008の構造的限界（両ソースが同時に同じ欠落を持つケースは検出
できない）についても、`docs/04_technical_reference.md`の該当箇所に簡潔に追記する
ことが望ましい。

# やってはいけないこと
- 25件のrole-permissionペアの内容自体は妥当と評価されているため、不必要に変更しない。
- 既存のmigration（001〜035）・既存のrole_permissions行を書き換えない。

# 受け入れ基準（Definition of Done）
- [ ] 修正前（001〜035のみ）で対象操作が42501相当のエラーで拒否されることを実DBで
      確認する
- [ ] 修正後（036適用済み）で対象操作が成功することを実DBで確認する
- [ ] 上記のBefore/AfterがE2Eテストとして再現可能な形で追加されている
- [ ] migration 036が、想定と異なる状態（行数不一致等）を検知した場合にfail-closed
      で停止する構造に修正されている
- [ ] `role_permissions`・`PermissionsGuard`双方が225組で完全一致することを実DBで
      確認する
- [ ] `payslips`・`year_end_adjustments`への`app_runtime`のGRANTが実際に機能する
      ことを確認する
- [ ] README・技術リファレンス等の「200組」表記が225組に更新されている
- [ ] 既存のBackend Jest・schema verifierが引き続き全件PASSする（回帰確認）
- [ ] コミットSHA・ブランチ名を明記する（本計画書0.4節）
```

---

