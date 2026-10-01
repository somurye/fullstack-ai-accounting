# keiri-kaikei 全社バックオフィス統合SaaS 拡張サマリ（Phase 0〜5 総括）

> [← 拡張計画書 本体 (backoffice_expansion_plan.md)](backoffice_expansion_plan.md)

## 本ドキュメントの目的・位置づけ

本ドキュメントは、`keiri-kaikei` における全社バックオフィス統合SaaS拡張プロジェクト（Phase 0〜Phase 5、ドキュメント整備、全社シミュレーション）の**各フェーズ完了時点におけるサマリ、確立された恒久ルール、主な成果、およびプロジェクト全体の総括**を集約したサマリドキュメントです。

人間や外部AIによるプロジェクト全体像の把握、設計原則・セキュリティ防壁の確認の際には、まず本ドキュメントを参照してください。

各タスクごとの詳細な実装指示プロンプト、ChatGPT(SO)によるレビュー往復記録（REQUEST CHANGES / FIX / VERIFY / PASS / マージ指示）の全文は、[`docs/phase_records/`](phase_records/) 配下の各詳細ファイルに完全に保存されています。

---

## 1. Phase 0: 基盤汎用化 サマリ & 引継ぎ事項

- **目的**: 経理会計専用だった承認エンジン・添付ファイル基盤・AIゲートウェイを全社業務向けに汎用化。
- **完了タスク**: P0-T1（汎用承認ターゲット拡張）、P0-T2（電帳法対応添付ファイル基盤拡張）、P0-T3（AI提案ゲートウェイ抽象化）、P0-T4（法務ロール基盤追加）、P0-T5（開発環境psql整備・実DB migration検証）。
- **主要成果**:
  - 承認ターゲットを `target_type IN ('journal_entry', 'expense_report', 'vendor_bill', 'contract', 'purchase_request')` に拡張。
  - `contracts` や `purchase_requests` の業務テーブルを承認エンジンから直接更新しない「責務分離（承認基盤は承認ステータスのみ管理）」原則を確立。
  - 法務ロール（`legal_admin`, `legal_viewer`）をRBACマトリクスに正式追加。
  - Dockerコンテナ経由の実DBスキーマ検証環境（`verify_schema.py`）を確立。
- **詳細記録**: [`phase0_foundation.md`](phase_records/phase0_foundation.md)

---

## 2. Phase 1: 総務・法務（契約管理・稟議ワークフロー）サマリ

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


- **詳細記録**: [`phase1_legal.md`](phase_records/phase1_legal.md)

---

## 3. Phase 2: 購買・調達（発注申請・サプライヤー管理）サマリ

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


- **詳細記録**: [`phase2_procurement.md`](phase_records/phase2_procurement.md)

---

## 4. Phase 3: 人事労務（勤怠管理・給与計算・社保）サマリ


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


- **詳細記録**: [`phase3_hr_payroll.md`](phase_records/phase3_hr_payroll.md)

---

## 5. Phase 4: 営業事務（見積書・契約更新アラート・案件管理）サマリ

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


- **詳細記録**: [`phase4_sales.md`](phase_records/phase4_sales.md)

---

## 6. Phase 5: 統合最適化（全社ダッシュボード・AIレコメンド）サマリ

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


- **詳細記録**: [`phase5_integration.md`](phase_records/phase5_integration.md)

---

## 7. 運用検証フェーズ（ドキュメント整備・全社シミュレーション・RBAC是正）サマリ

- **7.5節 ドキュメント整備**:
  - Phase 0〜5の全拡張内容を踏まえ、README、要件定義書、アーキテクチャ設計書、DB設計書、技術リファレンス、プロジェクトヒストリーの6大ドキュメントを整合。
  - 実在するロール名（10ロール）およびDBトリガー・関数の完全一致を確認。
- **7.6節 全社シミュレーション & migration 036**:
  - サンプルテナント（全10ロールのログインアカウント）を作成し、100名規模・12ヶ月分の全社バックオフィス業務シミュレーションを実行。
  - 実行過程で、Phase 0初期マイグレーション以来見落とされていた初期パーミッション欠落（`journal_entry.*`, `expense_report.approve` 等）および `payslips`/`year_end_adjustments` のGRANT漏れを発見。
  - **`sql/036_role_permissions_and_grants_fix.sql`**（append-only、事前・事後厳密チェック付き fail-closed構造）を投入し、DB 225組 ＝ PermissionsGuard 225組（差分ゼロ）を完全実証。
  - 専用E2Eテスト（`verify-role-permissions-fix-e2e.ts`）により、036適用前（42501拒否）→ 適用後（正常承認成功）の実DB証跡を取得。
- **詳細記録**: [`phase_simulation.md`](phase_records/phase_simulation.md)

---

## 8. 詳細記録ファイル一覧

| Phase | 詳細記録ファイル | 主な収録内容 |
|---|---|---|
| Phase 0 | [`docs/phase_records/phase0_foundation.md`](phase_records/phase0_foundation.md) | 承認ターゲット拡張、添付ファイル基盤拡張、AI提案ゲートウェイ、法務ロール基盤、psql検証環境整備 |
| Phase 1 | [`docs/phase_records/phase1_legal.md`](phase_records/phase1_legal.md) | 契約書テーブル設計、PDF本文AI抽出、契約RBAC強制、更新期限アラート、汎用稟議WF、契約全文検索 |
| Phase 2 | [`docs/phase_records/phase2_procurement.md`](phase_records/phase2_procurement.md) | 購買申請多段階承認、サプライヤーT番号検証、納品受領書・仕入請求書・発注書の3点照合WORM、購買ダッシュボード |
| Phase 3 | [`docs/phase_records/phase3_hr_payroll.md`](phase_records/phase3_hr_payroll.md) | 従業員台帳、Web勤怠打刻・所定外集計、有効期間付き料率マスタ（EXCLUDE制約）、給与計算エンジン、Web給与明細PDF、年末調整 |
| Phase 4 | [`docs/phase_records/phase4_sales.md`](phase_records/phase4_sales.md) | 見積書ライフサイクル・WORM改訂リンク、商談パイプライン、契約更新リンクWORM保護、営業ダッシュボード |
| Phase 5 | [`docs/phase_records/phase5_integration.md`](phase_records/phase5_integration.md) | 横断KPIエグゼクティブダッシュボード、AIレコメンド状態遷移マシン、業務画面連動、技術的負債棚卸し（DEBT-001/008/010） |
| シミュレーション | [`docs/phase_records/phase_simulation.md`](phase_records/phase_simulation.md) | ドキュメント整備、100名規模全社シミュレーション、migration 036、Before/After認可実証E2E |
