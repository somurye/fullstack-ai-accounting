import { History, LogOut, Receipt } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { logout as logoutRequest } from '../../pages/auth/api';
import { useAuthStore } from '../../stores/authStore';
import { ToastContainer } from '../ui/ToastContainer';

const TABS = [
  { to: '/mobile/expense-apply', label: '経費申請', icon: Receipt },
  { to: '/mobile/my-applications', label: '申請履歴', icon: History },
];

/**
 * MobileLayout
 * ============
 * PC用の`AppLayout`(サイドバー+ヘッダー)とは別系統の、スマホ専用シェル。
 * 一般社員(EMPLOYEE)は経理・会計のPC向け管理画面を操作する必要が無いため、
 * サイドバーを持たずヘッダー+ボトムナビゲーションのみの縦1カラム構成にする。
 * タブは「経費申請」「申請履歴」の2つのみで、ヘッダー・ボトムナビの両方から
 * 到達できるようにする(親指の届く範囲での操作を優先しつつ、現在地もヘッダーで分かるように)。
 */
export function MobileLayout() {
  const tenantName = useAuthStore((state) => state.availableTenants.find((t) => t.tenant_id === state.currentTenantId)?.tenant_name);
  const userName = useAuthStore((state) => state.user?.name);
  const logout = useAuthStore((state) => state.logout);

  const handleLogout = (): void => {
    logoutRequest()
      .catch(() => undefined)
      .finally(() => logout());
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-950 text-surface-100">
      <header className="shrink-0 border-b border-surface-800 bg-surface-950/80 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-surface-50">{tenantName ?? '経理・会計オールインワン'}</p>
            <p className="truncate text-xs text-surface-400">{userName ?? ''}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-surface-400 transition-colors hover:bg-surface-850 hover:text-surface-100"
            aria-label="ログアウト"
            title="ログアウト"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex gap-1 px-3 pb-2 text-sm">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `flex-1 rounded-lg px-3 py-2 text-center font-medium transition-colors ${
                  isActive ? 'bg-brand-600/15 text-brand-300' : 'text-surface-400 hover:bg-surface-850 hover:text-surface-100'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4">
        <Outlet />
      </main>

      <nav className="grid shrink-0 grid-cols-2 border-t border-surface-800 bg-surface-950/95 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `flex min-h-[48px] flex-col items-center justify-center gap-1 text-xs font-medium transition-colors ${
                isActive ? 'text-brand-300' : 'text-surface-500 hover:text-surface-200'
              }`
            }
          >
            <tab.icon className="h-5 w-5" />
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <ToastContainer />
    </div>
  );
}
