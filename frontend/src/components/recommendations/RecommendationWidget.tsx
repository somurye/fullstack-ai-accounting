import { useEffect, useState } from 'react';
import {
  Sparkles,
  ArrowRight,
  X,
  Clock,
  FileText,
  Calendar,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  recommendationsApi,
  type Recommendation,
  type RecommendationDomain,
} from '../../pages/recommendations/recommendationsApi';
import { useAuthStore } from '../../stores/authStore';
import { hasPermission } from '../../lib/permissions';

export interface RecommendationWidgetProps {
  /** 対象ドメイン（contracts, approval_requests, quotations） */
  targetDomain?: RecommendationDomain;
  /** 対象レコードID (UUID) */
  targetId?: string;
  /** 表示先の業務レコード閲覧に必要な権限 (例: 'contract.view', 'quotation.view') */
  requiredPermission?: string;
  /** 表示バリアント: 'banner' (画面上部目立つバナー), 'card' (標準カード), 'compact' (行内/小型) */
  variant?: 'banner' | 'card' | 'compact';
  /** アクション完了時のコールバック */
  onActionComplete?: () => void;
}

export function RecommendationWidget({
  targetDomain,
  targetId,
  requiredPermission,
  variant = 'card',
  onActionComplete,
}: RecommendationWidgetProps) {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const navigate = useNavigate();

  const userRoles = useAuthStore((state) => state.user?.roles);

  // 1. 閲覧権限チェック（recommendation.view + 業務レコード自体の閲覧権限 requiredPermission）
  const canViewRecommendations = hasPermission(userRoles, 'recommendation.view');
  const canViewTargetRecord = requiredPermission
    ? hasPermission(userRoles, requiredPermission)
    : true;

  // 2. アクション権限チェック (recommendation.act)
  const canActRecommendation = hasPermission(userRoles, 'recommendation.act');

  const isContextual = Boolean(targetDomain && targetId);

  const fetchRecommendations = async () => {
    // 権限がない場合はAPIリクエスト自体を行わない
    if (!canViewRecommendations || !canViewTargetRecord) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const data = await recommendationsApi.list({
        target_domain: targetDomain,
        target_id: targetId,
      });
      setRecommendations(data);
    } catch (err) {
      console.error('Failed to load recommendations', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRecommendations();
  }, [targetDomain, targetId, canViewRecommendations, canViewTargetRecord]);

  // 権限がない場合はウィジェット自体を描画しない (fail-closed)
  if (!canViewRecommendations || !canViewTargetRecord) {
    return null;
  }

  const handleAccept = async (rec: Recommendation) => {
    if (!canActRecommendation) return;
    try {
      setActionLoadingId(rec.id);
      const res = await recommendationsApi.accept(rec.id);
      setRecommendations((prev) => prev.filter((item) => item.id !== rec.id));
      onActionComplete?.();

      if (res.next_action_url) {
        navigate(res.next_action_url);
      }
    } catch (err) {
      console.error('Failed to accept recommendation', err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDismiss = async (rec: Recommendation) => {
    if (!canActRecommendation) return;
    try {
      setActionLoadingId(rec.id);
      await recommendationsApi.dismiss(rec.id);
      setRecommendations((prev) => prev.filter((item) => item.id !== rec.id));
      onActionComplete?.();
    } catch (err) {
      console.error('Failed to dismiss recommendation', err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const getTypeBadge = (type: Recommendation['type']) => {
    switch (type) {
      case 'contract_renewal_pending':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-300">
            <Calendar className="w-3 h-3 text-amber-700" />
            契約更新提案
          </span>
        );
      case 'approval_stale':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-900 border border-rose-300">
            <Clock className="w-3 h-3 text-rose-700" />
            承認滞留アラート
          </span>
        );
      case 'quotation_follow_up':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-900 border border-blue-300">
            <FileText className="w-3 h-3 text-blue-700" />
            見積フォロー推奨
          </span>
        );
      default:
        return null;
    }
  };

  if (loading) {
    // コンテキスト指定時（詳細画面など）はローディング中に画面のレイアウト崩れを防ぐため控えめに表示
    if (isContextual) {
      return null;
    }
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <div className="animate-pulse space-y-4">
          <div className="h-5 bg-gray-200 rounded w-1/4"></div>
          <div className="h-16 bg-gray-100 rounded"></div>
        </div>
      </div>
    );
  }

  // レコメンドが0件の場合:
  // - コンテキスト指定（特定レコード）の場合は何も表示せず画面をすっきり保つ
  // - 全体ダッシュボード等の場合は安心メッセージを表示
  if (recommendations.length === 0) {
    if (isContextual) {
      return null;
    }
    return (
      <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-xl border border-emerald-200 p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-100 text-emerald-700 rounded-lg">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-emerald-900">
              AI / 業務提案・レコメンド
            </h3>
            <p className="text-xs text-emerald-700 mt-0.5">
              現在、対応が必要な滞留・更新アラートはありません。業務は順調に進行しています。
            </p>
          </div>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // バリアント: 'banner' (業務詳細画面の上部に強調表示するバナー形式)
  // --------------------------------------------------------------------------
  if (variant === 'banner') {
    return (
      <div className="space-y-3 mb-6">
        {recommendations.map((rec) => (
          <div
            key={rec.id}
            className="bg-gradient-to-r from-amber-500/10 via-indigo-500/10 to-blue-500/10 rounded-2xl border-2 border-amber-400/80 p-5 shadow-lg backdrop-blur-sm relative overflow-hidden"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5 min-w-0">
                <div className="p-2.5 bg-gradient-to-br from-amber-500 to-indigo-600 text-white rounded-xl shadow-md shrink-0 mt-0.5 sm:mt-0">
                  <Sparkles className="w-5 h-5 animate-pulse" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {getTypeBadge(rec.type)}
                    <span className="text-xs font-bold text-indigo-700 font-mono">
                      RECOMMENDATION
                    </span>
                  </div>
                  <h4 className="text-base font-bold text-slate-900 leading-snug">
                    {rec.title}
                  </h4>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    {rec.message}
                  </p>
                </div>
              </div>

              {canActRecommendation && (
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    disabled={actionLoadingId === rec.id}
                    onClick={() => handleAccept(rec)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md hover:shadow-indigo-500/20 transition-all disabled:opacity-50"
                  >
                    <span>推奨アクションを実行</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    disabled={actionLoadingId === rec.id}
                    onClick={() => handleDismiss(rec)}
                    className="inline-flex items-center gap-1 px-3 py-2 bg-white/80 hover:bg-white text-slate-600 text-xs font-medium rounded-xl border border-slate-200 shadow-sm transition-all disabled:opacity-50"
                    title="この提案を見送る"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>見送り</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // バリアント: 'compact' (行内やモーダル等の省スペース用)
  // --------------------------------------------------------------------------
  if (variant === 'compact') {
    return (
      <div className="space-y-2">
        {recommendations.map((rec) => (
          <div
            key={rec.id}
            className="p-3 bg-amber-50/80 rounded-xl border border-amber-200/90 text-xs text-slate-800 space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-bold text-amber-900">
                <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                <span>{rec.title}</span>
              </div>
              {getTypeBadge(rec.type)}
            </div>
            <p className="text-slate-600 text-[11px] leading-relaxed">{rec.message}</p>
            {canActRecommendation && (
              <div className="flex items-center justify-end gap-1.5 pt-1">
                <button
                  type="button"
                  disabled={actionLoadingId === rec.id}
                  onClick={() => handleAccept(rec)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-semibold rounded-lg shadow-sm"
                >
                  <span>採用</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  disabled={actionLoadingId === rec.id}
                  onClick={() => handleDismiss(rec)}
                  className="inline-flex items-center gap-0.5 px-2 py-1 bg-white hover:bg-slate-100 text-slate-600 text-[11px] rounded-lg border border-slate-200"
                >
                  <X className="w-3 h-3" />
                  <span>見送り</span>
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // バリアント: 'card' (標準カード、全体ダッシュボード等)
  // --------------------------------------------------------------------------
  return (
    <div className="bg-gradient-to-r from-indigo-50/50 via-purple-50/30 to-blue-50/50 rounded-xl border border-indigo-200/80 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-indigo-600 text-white rounded-lg shadow-sm">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-gray-900">
                業務最適化 AIレコメンド
              </h3>
              <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-full">
                {recommendations.length}件の提案
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              横断データ相関から検出された推奨アクションです。業務データの自動変更は行われません。
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {recommendations.map((rec) => (
          <div
            key={rec.id}
            className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm hover:border-indigo-300 transition-all"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  {getTypeBadge(rec.type)}
                  <h4 className="text-sm font-semibold text-gray-900 truncate">
                    {rec.title}
                  </h4>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed">
                  {rec.message}
                </p>
              </div>

              {canActRecommendation && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={actionLoadingId === rec.id}
                    onClick={() => handleAccept(rec)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-md shadow-sm transition-colors disabled:opacity-50"
                  >
                    <span>採用・移動</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={actionLoadingId === rec.id}
                    onClick={() => handleDismiss(rec)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-md transition-colors disabled:opacity-50"
                    title="この提案を見送る"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>見送り</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
