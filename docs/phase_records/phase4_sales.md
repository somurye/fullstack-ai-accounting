# Phase 4: 営業事務（見積書・契約更新アラート・案件管理）詳細記録

> [← 計画書本体に戻る](../backoffice_expansion_plan.md) | [サマリを見る](../backoffice_expansion_summary.md)

本ドキュメントは、`docs/backoffice_expansion_plan.md` から分割された Phase 4 の全実装指示プロンプト、SOレビュー結果、FIXプロンプト、マージ指示の完全な全文記録です（要約・省略なし）。

---

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

