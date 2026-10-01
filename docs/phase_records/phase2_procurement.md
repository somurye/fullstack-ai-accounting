# Phase 2: 購買・調達（発注申請・サプライヤー管理）詳細記録

> [← 計画書本体に戻る](../backoffice_expansion_plan.md) | [サマリを見る](../backoffice_expansion_summary.md)

本ドキュメントは、`docs/backoffice_expansion_plan.md` から分割された Phase 2 の全実装指示プロンプト、SOレビュー結果、FIXプロンプト、マージ指示の完全な全文記録です（要約・省略なし）。

---

### 4.3 Phase 2 実装指示プロンプト（Gemini向け）

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
