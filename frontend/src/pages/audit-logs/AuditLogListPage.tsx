import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useAuditLogs } from './hooks';
import { actionSeverity } from './types';

const dateTimeFormatter = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'medium',
  timeStyle: 'medium',
});

const SEVERITY_BADGE: Record<ReturnType<typeof actionSeverity>, string> = {
  positive: 'badge-posted',
  warning: 'badge-rejected',
  neutral: 'badge-draft',
};

function DiffView({ before, after }: { before: unknown; after: unknown }) {
  if (!before && !after) return null;
  return (
    <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
      {before !== null && before !== undefined && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-surface-500">変更前</p>
          <pre className="max-h-40 overflow-auto rounded-md bg-surface-950 p-2 text-[11px] text-surface-300">
            {JSON.stringify(before, null, 2)}
          </pre>
        </div>
      )}
      {after !== null && after !== undefined && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-surface-500">変更後</p>
          <pre className="max-h-40 overflow-auto rounded-md bg-surface-950 p-2 text-[11px] text-surface-300">
            {JSON.stringify(after, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function AuditLogListPage() {
  const [targetType, setTargetType] = useState('');
  const [targetId, setTargetId] = useState('');
  const [actorUserId, setActorUserId] = useState('');
  const [occurredFrom, setOccurredFrom] = useState('');
  const [occurredTo, setOccurredTo] = useState('');

  const { data, isLoading } = useAuditLogs({
    target_type: targetType || undefined,
    target_id: targetId || undefined,
    actor_user_id: actorUserId || undefined,
    occurred_from: occurredFrom || undefined,
    occurred_to: occurredTo || undefined,
    page_size: 100,
  });

  const logs = data?.logs ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-surface-50">
          <ShieldCheck className="h-5 w-5 text-brand-400" />
          監査ログ
        </h1>
        <p className="mt-1 text-sm text-surface-400">
          仕訳確定・承認・FBデータ出力・税務申告確定 等の主要な操作は追記専用(改ざん不可)で記録されます。
        </p>
      </div>

      <div className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">対象種別(target_type)</label>
          <input
            type="text"
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
            placeholder="例: journal_entry"
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">対象ID(target_id)</label>
          <input
            type="text"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            placeholder="UUID"
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">操作者(actor_user_id)</label>
          <input
            type="text"
            value={actorUserId}
            onChange={(e) => setActorUserId(e.target.value)}
            placeholder="UUID"
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">期間(from)</label>
          <input
            type="datetime-local"
            value={occurredFrom}
            onChange={(e) => setOccurredFrom(e.target.value)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">期間(to)</label>
          <input
            type="datetime-local"
            value={occurredTo}
            onChange={(e) => setOccurredTo(e.target.value)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
      </div>

      {isLoading && <p className="text-sm text-surface-400">読み込み中…</p>}
      {!isLoading && logs.length === 0 && (
        <div className="card p-8 text-center text-sm text-surface-500">該当する監査ログはありません</div>
      )}

      <div className="relative space-y-4 border-l border-surface-800 pl-6">
        {logs.map((log) => (
          <div key={log.id} className="relative">
            <span className="absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500" />
            <div className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-surface-100">{log.action}</span>
                  <span className={SEVERITY_BADGE[actionSeverity(log.action ?? '')]}>
                    {log.target_type}
                  </span>
                </div>
                <span className="text-xs text-surface-500">
                  {log.occurred_at ? dateTimeFormatter.format(new Date(log.occurred_at)) : '—'}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-surface-400">
                <span>
                  操作者: <span className="font-mono text-surface-300">{log.actor_user_id ?? 'system'}</span>
                </span>
                {log.target_id && (
                  <span>
                    対象ID: <span className="font-mono text-surface-300">{log.target_id}</span>
                  </span>
                )}
                {log.ip_address && (
                  <span>
                    IP: <span className="font-mono text-surface-300">{log.ip_address}</span>
                  </span>
                )}
              </div>
              <DiffView before={log.before_data} after={log.after_data} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
