import { Check, ExternalLink, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAcceptAiSuggestion, useAiSuggestions, useRejectAiSuggestion } from './hooks';
import {
  SUGGESTION_TYPE_LABEL,
  TARGET_LINK,
  TARGET_TYPE_LABEL,
  type AiSuggestion,
  type AiSuggestionTargetType,
  type AiSuggestionType,
} from './types';

type StatusTab = 'pending' | 'accepted' | 'rejected';

const STATUS_TABS: { value: StatusTab; label: string }[] = [
  { value: 'pending', label: '未判定(インボックス)' },
  { value: 'accepted', label: '採用済み' },
  { value: 'rejected', label: '不採用' },
];

function confidenceColor(score: number): string {
  if (score >= 0.7) return 'bg-positive';
  if (score >= 0.4) return 'bg-amber-400';
  return 'bg-negative';
}

function SuggestionCard({ suggestion }: { suggestion: AiSuggestion }) {
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [reason, setReason] = useState('');
  const acceptMutation = useAcceptAiSuggestion();
  const rejectMutation = useRejectAiSuggestion();

  const targetType = suggestion.target_type as AiSuggestionTargetType | undefined;
  const suggestionType = suggestion.suggestion_type as AiSuggestionType | undefined;
  const score = suggestion.confidence_score ?? 0;
  const candidates = suggestion.payload?.candidates ?? [];
  const isDecided = suggestion.accepted !== null && suggestion.accepted !== undefined;
  const linkBuilder = targetType ? TARGET_LINK[targetType] : undefined;

  const isBusy = acceptMutation.isPending || rejectMutation.isPending;

  return (
    <div className="card space-y-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand-400" />
            <span className="text-sm font-semibold text-surface-50">
              {targetType ? TARGET_TYPE_LABEL[targetType] : suggestion.target_type}
            </span>
            <span className="badge-draft">
              {suggestionType ? SUGGESTION_TYPE_LABEL[suggestionType] : suggestion.suggestion_type}
            </span>
            {isDecided && (
              <span className={suggestion.accepted ? 'badge-posted' : 'badge-rejected'}>
                {suggestion.accepted ? '採用済み' : '不採用'}
              </span>
            )}
          </div>
          <p className="font-mono text-xs text-surface-500">target_id: {suggestion.target_id}</p>
        </div>
        {linkBuilder && suggestion.target_id && (
          <Link
            to={linkBuilder(suggestion.target_id)}
            className="inline-flex items-center gap-1 text-xs text-brand-300 hover:text-brand-200"
          >
            対象を確認
            <ExternalLink className="h-3 w-3" />
          </Link>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-surface-400">
          <span>信頼度スコア</span>
          <span className="tabular-nums font-medium text-surface-200">
            {(score * 100).toFixed(1)}%
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-800">
          <div
            className={`h-full rounded-full ${confidenceColor(score)}`}
            style={{ width: `${Math.round(score * 100)}%` }}
          />
        </div>
      </div>

      {candidates.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-surface-400">候補科目</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {candidates.map((c, i) => (
              <div
                key={`${c.code}-${i}`}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  i === 0
                    ? 'border-brand-500/60 bg-brand-500/10 text-brand-200'
                    : 'border-surface-800 bg-surface-900 text-surface-300'
                }`}
              >
                <p className="font-medium">
                  候補{i + 1}: {c.code} {c.name ?? ''}
                </p>
                <p className="tabular-nums text-surface-400">
                  score {((c.score ?? 0) * 100).toFixed(1)}%
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {suggestion.payload?.rejection_reason && (
        <p className="text-xs text-surface-500">不採用理由: {suggestion.payload.rejection_reason}</p>
      )}

      {!isDecided && (
        <div className="flex items-center justify-end gap-2 border-t border-surface-800 pt-3">
          {showRejectInput ? (
            <>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="不採用理由(任意)"
                className="w-56 rounded-lg border border-surface-700 bg-surface-850 px-3 py-1.5 text-xs text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
              />
              <button
                type="button"
                className="btn-secondary !py-1.5 text-xs"
                disabled={isBusy}
                onClick={() => setShowRejectInput(false)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="btn-secondary !py-1.5 text-xs !text-negative"
                disabled={isBusy}
                onClick={() =>
                  rejectMutation.mutate({ id: suggestion.id as string, reason: reason || undefined })
                }
              >
                <X className="h-3.5 w-3.5" />
                不採用を確定
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn-secondary !py-1.5 text-xs"
                disabled={isBusy}
                onClick={() => setShowRejectInput(true)}
              >
                <X className="h-3.5 w-3.5" />
                不採用
              </button>
              <button
                type="button"
                className="btn-primary !py-1.5 text-xs"
                disabled={isBusy}
                onClick={() => acceptMutation.mutate(suggestion.id as string)}
              >
                <Check className="h-3.5 w-3.5" />
                採用
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function AiSuggestionListPage() {
  const [tab, setTab] = useState<StatusTab>('pending');
  const [targetType, setTargetType] = useState<AiSuggestionTargetType | ''>('');
  const [suggestionType, setSuggestionType] = useState<AiSuggestionType | ''>('');

  const { data, isLoading } = useAiSuggestions({
    target_type: targetType || undefined,
    suggestion_type: suggestionType || undefined,
    accepted: tab === 'pending' ? undefined : tab === 'accepted',
    page_size: 100,
  });

  const suggestions = data?.suggestions ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-surface-50">AI提案インボックス</h1>
        <p className="mt-1 text-sm text-surface-400">
          過去の確定仕訳との類似度検索(pgvector)により自動生成された勘定科目候補です。確定データとは
          物理的に分離された領域(ai_suggestions)に保存されており、採用して初めて対象の草案レコードへ反映されます。
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-2 border-b border-surface-800">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.value
                  ? 'border-brand-400 text-brand-300'
                  : 'border-transparent text-surface-400 hover:text-surface-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-3">
          <select
            value={targetType}
            onChange={(e) => setTargetType(e.target.value as AiSuggestionTargetType | '')}
            className="rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="">対象: すべて</option>
            {Object.entries(TARGET_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={suggestionType}
            onChange={(e) => setSuggestionType(e.target.value as AiSuggestionType | '')}
            className="rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="">種別: すべて</option>
            {Object.entries(SUGGESTION_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading && <p className="text-sm text-surface-400">読み込み中…</p>}

      {!isLoading && suggestions.length === 0 && (
        <div className="card p-8 text-center text-sm text-surface-500">
          該当するAI提案はありません
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {suggestions.map((s) => (
          <SuggestionCard key={s.id} suggestion={s} />
        ))}
      </div>
    </div>
  );
}
