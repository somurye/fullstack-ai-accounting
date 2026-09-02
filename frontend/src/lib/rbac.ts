/**
 * 職務分掌(SoD)RBACで使用するアプリケーション共通ロール。
 * バックエンドの `backend/src/common/enums/role.enum.ts` とミラーする(値は
 * `role_code_enum` のDBロールコード文字列と1:1)。
 *
 * `accounting_manager` / `payroll_admin` / `viewer_external` / `system_service` は
 * このSoDモデルの対象外(既存の`canEditSettings`等、個別の権限チェックで扱う)。
 */
export const Role = {
  ADMIN: 'owner',
  ACCOUNTANT: 'accountant',
  BOOKKEEPER: 'bookkeeper',
  APPROVER: 'approver',
  EMPLOYEE: 'employee',
  LEGAL_ADMIN: 'legal_admin',
  LEGAL_VIEWER: 'legal_viewer',
} as const;

/** 現在のユーザーが保有するロールのいずれかが、許可ロール一覧に含まれるか */
export function hasAnyRole(userRoles: string[] | undefined, allowedRoles: string[]): boolean {
  return (userRoles ?? []).some((role) => allowedRoles.includes(role));
}

/**
 * ログイン後の遷移先を決定する。PC用の管理画面(試算表・仕訳・各種マスタ等)を
 * 使う理由が無い「EMPLOYEE専任」ユーザー(経理・承認・法務いずれの権限も持たない一般社員)は、
 * スマホ特化の経費申請ウィザードを起点にする。ADMIN/ACCOUNTANT/BOOKKEEPER/APPROVER/LEGAL_ADMIN/LEGAL_VIEWERの
 * いずれかを1つでも保有していれば、従来どおりPCダッシュボードへ遷移する。
 */
export function resolveHomePath(userRoles: string[] | undefined): string {
  const isEmployeeOnly =
    hasAnyRole(userRoles, [Role.EMPLOYEE]) &&
    !hasAnyRole(userRoles, [
      Role.ADMIN,
      Role.ACCOUNTANT,
      Role.BOOKKEEPER,
      Role.APPROVER,
      Role.LEGAL_ADMIN,
      Role.LEGAL_VIEWER,
    ]);
  return isEmployeeOnly ? '/mobile/expense-apply' : '/dashboard';
}
