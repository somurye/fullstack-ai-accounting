# 開発経緯・シミュレーション報告

## 1. プロダクトのスコープ

[01_requirements.md](01_requirements.md) に定義される5領域（A: 入出金・決済・資金管理／B: フロントオフィス・経費精算／C: 年次決算・資産管理・税務／D: 人事労務・給与連携／E: ガバナンス・外部監査対応）を、単一の統合データモデル上で実装。

`backend/src/modules/` 配下には現時点で以下29の機能モジュールが存在する。

```
accounts, ai-suggestions, approval-requests, attachments, audit-logs, auth,
auto-journal-rules, bank-accounts, bank-transactions, consumption-tax-returns,
customers, departments, expense-categories, expense-reports,
external-access-grants, fiscal-periods, fixed-assets, invoices,
journal-entries, payment-batches, payroll-import-mappings, payroll-imports,
reports, settings, tax-categories, tenants, users, vendor-bills, vendors
```

設計原則（AIは提案のみ・確定処理は決定的ロジック、DB制約による最終防御、RLSによる完全テナント分離、ORM不使用の生SQL駆動）の詳細は [01_requirements.md](01_requirements.md) §0 を参照。

## 2. シミュレーション結果

`scripts/` 配下のシミュレーションスクリプトにより、単一テナント・101ユーザー規模で12ヶ月分の業務データを生成し、会計整合性を検証した（`simulation-report.json` 生成日時: 2026-08-05T10:54:37Z、総実行時間 約183秒）。

### 処理件数

| 項目 | 件数 |
|---|---|
| 経費精算申請 | 1,985（承認 1,875 / 却下 110） |
| AI仕訳提案 | 752（採用 639 / 却下 113） |
| 売上請求書 | 505（完全消込 326 / 一部消込 79 / 取消 11） |
| 仕入請求書（買掛金） | 610（銀行明細消込 507） |
| 給与連携実行 | 12回 |
| 減価償却バッチ実行 | 9回 |
| 仕訳（journal_entries） | 4,035 |
| 監査ログ（audit_logs） | 3,952 |

### 会計整合性チェック（reconciliation）

| チェック項目 | 差分 |
|---|---|
| 貸借対照表 資産・負債・純資産の一致 | 0 |
| PL純利益とBS未処分利益の一致 | 0 |
| CF期末残高とBS現金・預金残高の一致 | 0 |

すべての整合性チェックが一致（`allPass: true`）、エラー件数0件で完走した。月次では季節性（閑散期・繁忙期・賞与月・決算調整月）を模したシナリオを含む。

> 生の `simulation-report.json` はシミュレーション実行のたびに更新される一時的な出力のため `.gitignore` で除外している。最新の数値を再現するにはシミュレーションスクリプトを再実行すること。

---

## 3. Phase 0〜5 バックオフィス拡張の経緯と成果

### 3.1 拡張の背景と経緯
2026年8月に実施された経理・会計コア（領域A〜E）のシミュレーション完了後、企業のバックオフィス実務において不可欠な前工程業務（契約締結、購買発注・検収、勤怠打刻・給与計算、見積作成・商談管理）を統合するため、バックオフィス拡張ロードマップ（Phase 0〜Phase 5）が策定・実行されました。

単一のPostgreSQL基盤・統一RBAC・RLSマルチテナント隔離の下、厳格な多層防御とWORM不変性を徹底しながら各ドメインを実装し、ChatGPT(SO)による厳格なレビューサイクル（コード差分確認、実DB E2E検証、回帰ゼロ確認）を経て、2026年9月にロードマップの全計画タスクが正式完了しました。

### 3.2 モジュール数の進化（29モジュール → 47モジュール / 実質49モジュール）
初期の経理会計コア（29モジュール）に対し、全社バックオフィス拡張を通じて以下の新モジュール群が追加され、`backend/src/modules/` 配下は計49モジュールへと進化しました。

- **総務・法務・契約管理**: `contracts`, `notifications`, `general-requests`
- **購買・調達管理**: `purchase-requests`, `suppliers`, `purchase-dashboard`
- **人事労務・給与内製化**: `employees`, `attendance`, `rate-masters`, `payroll-calculations`, `payslips`, `year-end-adjustments`
- **営業事務・商流管理**: `quotations`, `deals`, `contract-renewal-links`, `sales-dashboard`
- **統合最適化・AI**: `executive-dashboard`, `recommendations`
- **基盤連携・ダッシュボード**: `bank-integration`, `dashboard`

### 3.3 各フェーズの成果サマリー
1. **Phase 0（土台確立）**: 全10ロールのRBACマトリクス策定、監査ログ検索機能の強化、電帳法対応添付ファイル基盤の拡張。
2. **Phase 1（総務・法務・契約管理）**: 契約書ライフサイクル管理、PDF条項AI抽出、更新期限自動アラート通知、`pg_trgm` 全文検索、社内稟議・汎用申請ワークフロー。
3. **Phase 2（購買・調達管理）**: 購買申請多段階承認、サプライヤーT番号CHECK制約、納品受領書・仕入請求書・発注書の「3点照合」、受領書WORM不変性、購買KPIダッシュボード。
4. **Phase 3（人事労務・給与内製化）**: 従業員台帳、Web勤怠打刻・所定外労働時間自動集計、有効期間付き料率マスタ（EXCLUDE制約・WORM不変性）、給与計算エンジン、Web給与明細PDF出力、2026年分年末調整計算エンジン。
5. **Phase 4（営業事務・商流管理）**: 見積書ライフサイクル（自動採番・改訂リンク・WORM不変性・PDF出力）、案件パイプライン（won/lost終端ロック）、契約更新リンク連携（契約書↔案件↔見積書の対称的保護）、営業KPIダッシュボード。
6. **Phase 5（統合最適化）**: 財務・購買・人事・営業の4領域を統合する横断エグゼクティブダッシュボード（サービス委譲型）、文脈連動型ルールベースAIレコメンドエンジン、技術的負債棚卸し（DEBT-001/008/010解決）、RBACドリフト自動検知（DB 200組 vs Guard 200組 完全一致）。

> 各フェーズの詳細な実装指示・レビュー往復の全記録・各マージコミットSHAは [docs/backoffice_expansion_plan.md](backoffice_expansion_plan.md) を参照してください。

### 3.4 次のステップ: 全社バックオフィス統合シミュレーション（計画中）
第2節に記載のシミュレーション（2026-08-05実施）は経理会計コア機能のみ（4ロール使用）を対象としたものでした。
現在、Phase 0〜5で追加された全10ロールのアカウント作成、および全ドメイン（契約・購買・勤怠・給与・見積・案件・レコメンド）の業務データを包含する「100名規模企業1年間・全社バックオフィス統合シミュレーション」（計画書7.6節）の実施が計画されています（未実施・準備段階）。

