/**
 * 職務分掌(SoD)RBACで使用するアプリケーション共通ロール。
 * 各メンバーの値は `role_code_enum`(`sql/001_initial_schema_all_in_one.sql` /
 * `sql/004_rbac_bookkeeper_role.sql`)のDB上のロールコード文字列と1:1で対応し、
 * JWTクレーム `roles: string[]`(`backend/src/common/guards/tenant-auth.guard.ts`)
 * にそのまま格納される値と同一である。
 *
 * `accounting_manager` / `payroll_admin` / `viewer_external` / `system_service` は
 * このSoDモデルの対象外(それぞれ設定編集・給与連携・外部時限アクセス・
 * システム間連携という別軸の権限であり、既存の個別権限チェック・
 * `ExternalAccessGuard` が引き続き扱う)。
 */
export enum Role {
  /** システム管理者。すべての権限を持つ(既存の`owner`ロールコードに対応) */
  ADMIN = 'owner',
  /** 会計担当。仕訳・総勘定元帳・決算・財務諸表の閲覧/編集。出納・消込は閲覧のみ */
  ACCOUNTANT = 'accountant',
  /** 経理担当。レシート承認・銀行消込・出納の閲覧/編集。GL/財務諸表の直接改ざんは不可 */
  BOOKKEEPER = 'bookkeeper',
  /** 承認者。自部署の経費申請承認・閲覧 */
  APPROVER = 'approver',
  /** 一般社員。自身の申請作成・閲覧のみ */
  EMPLOYEE = 'employee',
}
