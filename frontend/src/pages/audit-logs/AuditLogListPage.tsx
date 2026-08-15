import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { AuditLogDetailModal } from './AuditLogDetailModal';
import { useAuditLogs } from './hooks';
import {
  actionSeverity,
  AUDIT_TARGET_TYPE_OPTIONS,
  dateTimeFormatter,
  formatAction,
  formatTargetType,
  SEVERITY_BADGE,
  type AuditLog,
} from './types';

export function AuditLogListPage() {
  const [targetType, setTargetType] = useState('');
  const [actorName, setActorName] = useState('');
  const [keyword, setKeyword] = useState('');
  const [occurredFrom, setOccurredFrom] = useState('');
  const [occurredTo, setOccurredTo] = useState('');
  const [detailLog, setDetailLog] = useState<AuditLog | null>(null);

  const { data, isLoading } = useAuditLogs({
    target_type: targetType || undefined,
    actor_name: actorName || undefined,
    keyword: keyword || undefined,
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

      <div className="card grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">対象種別</label>
          <select
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="">すべての対象種別</option>
            {AUDIT_TARGET_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label} ({opt.value})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">操作者</label>
          <input
            type="text"
            value={actorName}
            onChange={(e) => setActorName(e.target.value)}
            placeholder="操作者名で検索(例: 代表 太郎)"
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">キーワード検索</label>
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="対象名・ID・内容で検索"
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
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
      </div>

      {isLoading && <p className="text-sm text-surface-400">読み込み中…</p>}
      {!isLoading && logs.length === 0 && (
        <div className="card p-8 text-center text-sm text-surface-500">該当する監査ログはありません</div>
      )}

      <div className="relative space-y-3 border-l border-surface-800 pl-6">
        {logs.map((log) => (
          <div key={log.id} className="relative">
            <span className="absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500" />
            <div className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-surface-100">{formatAction(log.action ?? '')}</span>
                  <span className={SEVERITY_BADGE[actionSeverity(log.action ?? '')]}>
                    {formatTargetType(log.target_type ?? '')}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-surface-500">
                    {log.occurred_at ? dateTimeFormatter.format(new Date(log.occurred_at)) : '—'}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary !py-1 text-xs"
                    onClick={() => setDetailLog(log)}
                  >
                    詳細を見る
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-surface-400">
                <span>
                  操作者: <span className="text-surface-300">{log.actor_user_name ?? 'システム'}</span>
                </span>
                {log.target_id && (
                  <span title={log.target_id}>
                    対象: <span className="text-surface-300">{log.target_name ?? '(詳細を参照)'}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {detailLog && <AuditLogDetailModal log={detailLog} onClose={() => setDetailLog(null)} />}
    </div>
  );
}
