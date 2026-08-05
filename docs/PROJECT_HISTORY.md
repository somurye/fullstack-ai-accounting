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
