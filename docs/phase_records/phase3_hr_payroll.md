# Phase 3: 人事労務（勤怠管理・給与計算・社保）詳細記録

> [← 計画書本体に戻る](../backoffice_expansion_plan.md) | [サマリを見る](../backoffice_expansion_summary.md)

本ドキュメントは、`docs/backoffice_expansion_plan.md` から分割された Phase 3 の全実装指示プロンプト、SOレビュー結果、FIXプロンプト、マージ指示の完全な全文記録です（要約・省略なし）。

---

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
