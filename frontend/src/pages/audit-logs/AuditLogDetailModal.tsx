import { Copy } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { toast } from '../../stores/toastStore';
import {
  actionSeverity,
  dateTimeFormatter,
  formatAction,
  formatTargetType,
  formatValue,
  SEVERITY_BADGE,
  type AuditLog,
} from './types';

/**
 * `before_data`/`after_data` の差分を項目ごとの表として表示する。両方揃っている場合は
 * 変更前後を比較し、値が変わった行を強調する。片方のみの場合は単純な項目一覧にする。
 */
function DiffTable({ before, after }: { before: unknown; after: unknown }) {
  const beforeObj = before && typeof before === 'object' ? (before as Record<string, unknown>) : null;
  const afterObj = after && typeof after === 'object' ? (after as Record<string, unknown>) : null;
  if (!beforeObj && !afterObj) {
    return <p className="text-xs text-surface-500">変更データはありません</p>;
  }

  const keys = Array.from(
    new Set([...(afterObj ? Object.keys(afterObj) : []), ...(beforeObj ? Object.keys(beforeObj) : [])]),
  );
  if (keys.length === 0) {
    return <p className="text-xs text-surface-500">変更データはありません</p>;
  }

  if (beforeObj && afterObj) {
    return (
      <div className="overflow-x-auto rounded-md border border-surface-800">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-surface-800 bg-surface-900/60 text-surface-500">
              <th className="px-3 py-1.5 text-left font-medium">項目</th>
              <th className="px-3 py-1.5 text-left font-medium">変更前</th>
              <th className="px-3 py-1.5 text-left font-medium">変更後</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => {
              const beforeVal = formatValue(beforeObj[key]);
              const afterVal = formatValue(afterObj[key]);
              const changed = beforeVal !== afterVal;
              return (
                <tr key={key} className="border-b border-surface-800/60 last:border-b-0">
                  <td className="px-3 py-1.5 font-mono text-surface-500">{key}</td>
                  <td className={`px-3 py-1.5 ${changed ? 'text-negative' : 'text-surface-400'}`}>{beforeVal}</td>
                  <td className={`px-3 py-1.5 ${changed ? 'font-medium text-positive' : 'text-surface-400'}`}>
                    {afterVal}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const singleObj = (afterObj ?? beforeObj) as Record<string, unknown>;
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-md border border-surface-800 p-3 text-xs sm:grid-cols-2">
      {keys.map((key) => (
        <div key={key} className="flex items-baseline justify-between gap-2">
          <dt className="font-mono text-surface-500">{key}</dt>
          <dd className="text-right text-surface-300">{formatValue(singleObj[key])}</dd>
        </div>
      ))}
    </dl>
  );
}

function RawJsonBlock({ label, data }: { label: string; data: unknown }) {
  const handleCopy = async (): Promise<void> => {
    await navigator.clipboard.writeText(JSON.stringify(data ?? null, null, 2));
    toast.success(`${label}をコピーしました`);
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wide text-surface-500">{label}</p>
        <button
          type="button"
          className="btn-secondary !py-0.5 !px-2 text-[11px]"
          onClick={() => void handleCopy()}
        >
          <Copy className="mr-1 inline h-3 w-3" />
          コピー
        </button>
      </div>
      {data === null || data === undefined ? (
        <p className="rounded-md bg-surface-950 p-3 text-[11px] text-surface-500">データがありません</p>
      ) : (
        <pre className="max-h-52 overflow-auto rounded-md bg-surface-950 p-3 text-[11px] text-surface-300">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function AuditLogDetailModal({ log, onClose }: { log: AuditLog; onClose: () => void }) {
  const [view, setView] = useState<'diff' | 'json'>('diff');

  return (
    <Modal title="監査ログの詳細" onClose={onClose}>
      <div className="space-y-5">
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-surface-500">基本情報</h3>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-surface-500">操作</dt>
              <dd className="text-surface-100">
                {formatAction(log.action ?? '')}
                <span className="ml-1.5 font-mono text-[10px] text-surface-600">{log.action}</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-surface-500">操作日時</dt>
              <dd className="text-surface-100">
                {log.occurred_at ? dateTimeFormatter.format(new Date(log.occurred_at)) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-surface-500">操作者</dt>
              <dd className="text-surface-100">
                {log.actor_user_name ?? 'システム'}
                {log.actor_user_id && (
                  <span className="ml-1.5 font-mono text-[10px] text-surface-600">{log.actor_user_id}</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-surface-500">クライアントIP</dt>
              <dd className="font-mono text-surface-100">{log.ip_address ?? '—'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-surface-500">User-Agent</dt>
              <dd className="break-all font-mono text-[11px] text-surface-300">{log.user_agent ?? '—'}</dd>
            </div>
          </dl>
        </section>

        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-surface-500">対象エンティティ</h3>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-surface-500">対象種別</dt>
              <dd>
                <span className={SEVERITY_BADGE[actionSeverity(log.action ?? '')]}>
                  {formatTargetType(log.target_type ?? '')}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-surface-500">対象名</dt>
              <dd className="text-surface-100">{log.target_name ?? '—'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-surface-500">対象ID</dt>
              <dd className="font-mono text-[11px] text-surface-400">{log.target_id ?? '—'}</dd>
            </div>
          </dl>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-surface-500">変更データ詳細</h3>
            <div className="flex gap-0.5 rounded-lg bg-surface-900 p-0.5 text-[11px]">
              <button
                type="button"
                className={`rounded-md px-2 py-1 transition-colors ${
                  view === 'diff' ? 'bg-surface-700 text-surface-100' : 'text-surface-400 hover:text-surface-200'
                }`}
                onClick={() => setView('diff')}
              >
                差分テーブル
              </button>
              <button
                type="button"
                className={`rounded-md px-2 py-1 transition-colors ${
                  view === 'json' ? 'bg-surface-700 text-surface-100' : 'text-surface-400 hover:text-surface-200'
                }`}
                onClick={() => setView('json')}
              >
                生JSON
              </button>
            </div>
          </div>
          {view === 'diff' ? (
            <DiffTable before={log.before_data} after={log.after_data} />
          ) : (
            <div className="space-y-3">
              <RawJsonBlock label="変更前データ (before_data)" data={log.before_data} />
              <RawJsonBlock label="変更後データ (after_data)" data={log.after_data} />
            </div>
          )}
        </section>

        <div className="flex justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </Modal>
  );
}
