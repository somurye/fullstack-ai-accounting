import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, ChevronDown, LogOut, User as UserIcon } from 'lucide-react';
import { type ChangeEvent, useState } from 'react';
import { logout as logoutRequest } from '../../pages/auth/api';
import { fetchNotifications, markNotificationAsRead } from '../../pages/notifications/api';
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
  const queryClient = useQueryClient();

  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  const { data: notificationsData } = useQuery({
    queryKey: ['notifications', currentTenantId],
    queryFn: () => fetchNotifications({ status: 'unread', limit: 10 }),
    enabled: Boolean(currentTenantId),
    refetchInterval: 60_000,
  });

  const markReadMutation = useMutation({
    mutationFn: markNotificationAsRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications', currentTenantId] });
    },
  });

  const unreadCount = notificationsData?.unread_count ?? 0;
  const notifications = notificationsData?.items ?? [];

  const currentTenantName =
    availableTenants.find((t) => t.tenant_id === currentTenantId)?.tenant_name ?? '未選択';

  const handleTenantChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const nextTenantId = event.target.value;
    // 空値(未選択option等)や、選択肢が確定する前の中途半端なイベントは無視する。
    if (!nextTenantId || nextTenantId === currentTenantId) return;
    setCurrentTenant(nextTenantId);
    // 新しいテナントIDを伴ったヘッダーで各種データを再取得させる。
    void queryClient.invalidateQueries();
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
        {/* 通知ベルアイコン & ドロップダウン */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsNotificationsOpen((prev) => !prev)}
            className="btn-secondary relative !px-2.5 !py-1.5"
            aria-label="通知一覧"
            title="通知一覧"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-bold text-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {isNotificationsOpen && (
            <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-surface-700 bg-surface-900 p-3 shadow-2xl z-50">
              <div className="flex items-center justify-between border-b border-surface-800 pb-2 mb-2">
                <span className="text-xs font-semibold text-surface-200">通知 ({unreadCount})</span>
                {unreadCount > 0 && (
                  <span className="text-[10px] text-surface-400">未読のみ表示</span>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto space-y-2">
                {notifications.length === 0 ? (
                  <p className="py-4 text-center text-xs text-surface-400">新しい通知はありません</p>
                ) : (
                  notifications.map((notif) => (
                    <div
                      key={notif.id}
                      className="rounded-lg border border-surface-800 bg-surface-850 p-2.5 transition-colors hover:border-surface-700"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-xs font-medium text-surface-100 leading-snug">{notif.title}</h4>
                        <button
                          type="button"
                          onClick={() => markReadMutation.mutate(notif.id)}
                          className="shrink-0 rounded p-1 text-surface-400 hover:bg-surface-750 hover:text-surface-100"
                          title="既読にする"
                          aria-label="既読にする"
                        >
                          <Check className="h-3 w-3" />
                        </button>
                      </div>
                      <p className="mt-1 text-[11px] text-surface-300 leading-relaxed whitespace-pre-wrap">{notif.body}</p>
                      <span className="mt-1.5 block text-[10px] text-surface-500">
                        {new Date(notif.created_at).toLocaleDateString('ja-JP')}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

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
