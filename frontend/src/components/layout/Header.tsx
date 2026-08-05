import { ChevronDown, LogOut, User as UserIcon } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { logout as logoutRequest } from '../../pages/auth/api';
import { useAuthStore } from '../../stores/authStore';

/**
 * Header
 * ======
 * テナント切替ドロップダウンとログインユーザー情報を表示するトップバー。
 * テナント切替は `authStore.setCurrentTenant()` を通じて即座に
 * `apiClient` の `X-Tenant-ID` ヘッダーへ反映される
 * (axiosリクエストインターセプターがストアの最新値を都度参照するため)。
 */
export function Header() {
  const user = useAuthStore((state) => state.user);
  const availableTenants = useAuthStore((state) => state.availableTenants);
  const currentTenantId = useAuthStore((state) => state.currentTenantId);
  const setCurrentTenant = useAuthStore((state) => state.setCurrentTenant);
  const logout = useAuthStore((state) => state.logout);

  const currentTenantName =
    availableTenants.find((t) => t.tenant_id === currentTenantId)?.tenant_name ?? '未選択';

  const handleTenantChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    setCurrentTenant(event.target.value);
  };

  const handleLogout = (): void => {
    // サーバー側のリフレッシュトークン失効はベストエフォート。
    // ネットワークエラー等で失敗してもローカルセッションは必ず破棄する。
    logoutRequest()
      .catch(() => undefined)
      .finally(() => logout());
  };

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-surface-800 bg-surface-950/80 px-6 backdrop-blur">
      <div className="flex items-center gap-3">
        {availableTenants.length > 0 ? (
          <div className="relative">
            <select
              aria-label="テナント切替"
              value={currentTenantId ?? ''}
              onChange={handleTenantChange}
              className="appearance-none rounded-lg border border-surface-700 bg-surface-850 py-1.5 pl-3 pr-8 text-sm font-medium text-surface-100 outline-none transition-colors hover:bg-surface-800 focus:ring-2 focus:ring-brand-400"
            >
              {availableTenants.map((tenant) => (
                <option key={tenant.tenant_id} value={tenant.tenant_id}>
                  {tenant.tenant_name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" />
          </div>
        ) : (
          <span className="text-sm text-surface-400">{currentTenantName}</span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {user && (
          <div className="flex items-center gap-2 text-sm text-surface-200">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-800 text-surface-300">
              <UserIcon className="h-4 w-4" />
            </span>
            <div className="hidden flex-col leading-tight sm:flex">
              <span className="font-medium text-surface-50">{user.name}</span>
              <span className="text-xs text-surface-500">{user.roles?.join(' / ')}</span>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleLogout}
          className="btn-secondary !px-2.5 !py-1.5"
          aria-label="ログアウト"
          title="ログアウト"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
