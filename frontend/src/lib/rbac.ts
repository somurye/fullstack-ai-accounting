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
} as const;

/** 現在のユーザーが保有するロールのいずれかが、許可ロール一覧に含まれるか */
export function hasAnyRole(userRoles: string[] | undefined, allowedRoles: string[]): boolean {
  return (userRoles ?? []).some((role) => allowedRoles.includes(role));
}
