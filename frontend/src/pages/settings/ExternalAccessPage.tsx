import { ShieldAlert, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCreateExternalAccessGrant, useExternalAccessGrants, useRevokeExternalAccessGrant } from './hooks';
import { GRANT_STATUS_LABEL, grantStatus, type ExternalAccessGrant } from './types';

const dateTimeFormatter = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });

function formatCountdown(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `残り ${days}日${hours}時間`;
  if (hours > 0) return `残り ${hours}時間${minutes}分`;
  return `残り ${minutes}分`;
}

/** 有効期限までの残り時間を1分ごとに再計算して表示するカウントダウン表示 */
function ExpiryCountdown({ grant }: { grant: ExternalAccessGrant }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const status = grantStatus(grant);
  if (status !== 'active' || !grant.valid_until) return null;

  const remainingMs = new Date(grant.valid_until).getTime() - now;
  if (remainingMs <= 0) return null;

  const isUrgent = remainingMs <= 24 * 60 * 60 * 1000;
  return (
    <p className={`mt-0.5 text-xs ${isUrgent ? 'text-negative' : 'text-surface-500'}`}>
      {formatCountdown(remainingMs)}
    </p>
  );
}

function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const STATUS_BADGE = {
  active: 'badge-posted',
  pending: 'badge-draft',
  expired: 'badge-rejected',
} as const;

export function ExternalAccessPage() {
  const { data, isLoading } = useExternalAccessGrants();
  const createMutation = useCreateExternalAccessGrant();
  const revokeMutation = useRevokeExternalAccessGrant();

  const [userId, setUserId] = useState('');
  const [validFrom, setValidFrom] = useState(toDatetimeLocalValue(new Date()));
  const [validUntil, setValidUntil] = useState(
    toDatetimeLocalValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)),
  );
  const [canExport, setCanExport] = useState(false);

  const grants = data?.grants ?? [];
  const canSubmit = Boolean(userId) && Boolean(validFrom) && Boolean(validUntil);

  const handleSubmit = async (): Promise<void> => {
    await createMutation.mutateAsync({
      user_id: userId,
      valid_from: new Date(validFrom).toISOString(),
      valid_until: new Date(validUntil).toISOString(),
      can_export: canExport,
    });
    setUserId('');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-surface-50">
          <ShieldAlert className="h-5 w-5 text-brand-400" />
          外部アクセス管理(税理士・監査人)
        </h1>
        <p className="mt-1 text-sm text-surface-400">
          viewer_externalロールのユーザーに対し、期間限定の閲覧アクセス許可を発行・失効します。発行は
          owner / accounting_manager ロールのみ実行できます。有効期間外のアクセスはDBレベル(RLS)でも
          遮断されます。
        </p>
      </div>

      <div className="card space-y-4 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-surface-100">
          <UserPlus className="h-4 w-4" />
          時限アクセス許可を発行
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-1">
            <label className="mb-1 block text-xs font-medium text-surface-400">対象ユーザーID(UUID)</label>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="viewer_externalロールのユーザーID"
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">有効開始(valid_from)</label>
            <input
              type="datetime-local"
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">有効終了(valid_until)</label>
            <input
              type="datetime-local"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 text-sm text-surface-300">
              <input
                type="checkbox"
                checked={canExport}
                onChange={(e) => setCanExport(e.target.checked)}
                className="h-4 w-4 rounded border-surface-700 bg-surface-850"
              />
              エクスポート許可
            </label>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            className="btn-primary"
            disabled={!canSubmit || createMutation.isPending}
            onClick={() => void handleSubmit()}
          >
            {createMutation.isPending ? '発行中…' : '発行する'}
          </button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-surface-400">読み込み中…</p>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-4 py-3 font-medium">対象ユーザー</th>
              <th className="px-4 py-3 font-medium">有効期間</th>
              <th className="px-4 py-3 font-medium">エクスポート</th>
              <th className="px-4 py-3 font-medium">状態</th>
              <th className="px-4 py-3 font-medium">発行者</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {grants.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-surface-500">
                  発行済みの外部アクセス許可はありません
                </td>
              </tr>
            )}
            {grants.map((grant) => {
              const status = grantStatus(grant);
              return (
                <tr key={grant.id} className="border-b border-surface-800/60">
                  <td className="px-4 py-3 font-mono text-xs text-surface-300">{grant.user_id}</td>
                  <td className="px-4 py-3 text-xs text-surface-300">
                    {grant.valid_from ? dateTimeFormatter.format(new Date(grant.valid_from)) : '—'}
                    {' 〜 '}
                    {grant.valid_until ? dateTimeFormatter.format(new Date(grant.valid_until)) : '—'}
                  </td>
                  <td className="px-4 py-3 text-surface-300">{grant.can_export ? '可' : '不可'}</td>
                  <td className="px-4 py-3">
                    <span className={STATUS_BADGE[status]}>{GRANT_STATUS_LABEL[status]}</span>
                    <ExpiryCountdown grant={grant} />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-surface-400">{grant.granted_by}</td>
                  <td className="px-4 py-3 text-right">
                    {status !== 'expired' && (
                      <button
                        type="button"
                        className="btn-secondary !py-1 text-xs"
                        disabled={revokeMutation.isPending}
                        onClick={() => revokeMutation.mutate(grant.id as string)}
                      >
                        即時失効
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
