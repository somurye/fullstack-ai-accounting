import { Navigate, Outlet } from 'react-router-dom';
import { hasAnyRole } from '../lib/rbac';
import { useAuthStore } from '../stores/authStore';

interface RequireRoleProps {
  /** このいずれかのロールを保有していればアクセスを許可する */
  roles: string[];
}

/**
 * RequireRole
 * ===========
 * `ProtectedRoute`(認証済みかどうか)の内側で使う、職務分掌(SoD)RBAC用の
 * ルートガード。現在のユーザーが `roles` のいずれも保有していない場合は
 * `/forbidden` へリダイレクトする(例: 経理担当(BOOKKEEPER)が財務諸表画面へ
 * 直接アクセスした場合)。
 *
 * バックエンド側の `RolesGuard` が最終防御であり、本コンポーネントはあくまで
 * UI上の誘導(原則2「DB/API制約による最終防御、フロントは操作性のための補助」)。
 */
export function RequireRole({ roles }: RequireRoleProps) {
  const userRoles = useAuthStore((state) => state.user?.roles);

  if (!hasAnyRole(userRoles, roles)) {
    return <Navigate to="/forbidden" replace />;
  }

  return <Outlet />;
}
