import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

/**
 * ProtectedRoute
 * ==============
 * `authStore` にアクセストークン・選択中テナントの両方が揃っていない場合、
 * `/login` へリダイレクトする(遷移元パスは `state.from` として渡し、
 * ログイン成功後に呼び出し元へ戻れるようにする)。
 */
export function ProtectedRoute() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const currentTenantId = useAuthStore((state) => state.currentTenantId);
  const location = useLocation();

  const authenticated = Boolean(accessToken && currentTenantId);

  if (!authenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
