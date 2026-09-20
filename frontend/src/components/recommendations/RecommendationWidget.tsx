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
} from '../../pages/recommendations/recommendationsApi';

export function RecommendationWidget() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const navigate = useNavigate();

  const fetchRecommendations = async () => {
    try {
      setLoading(true);
      const data = await recommendationsApi.list({ status: 'new' });
      setRecommendations(data);
    } catch (err) {
      console.error('Failed to load recommendations', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecommendations();
  }, []);

  const handleAccept = async (rec: Recommendation) => {
    try {
      setActionLoadingId(rec.id);
      const res = await recommendationsApi.accept(rec.id);
      // 一覧から削除
      setRecommendations((prev) => prev.filter((item) => item.id !== rec.id));

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
    try {
      setActionLoadingId(rec.id);
      await recommendationsApi.dismiss(rec.id);
      setRecommendations((prev) => prev.filter((item) => item.id !== rec.id));
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
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">
            <Calendar className="w-3 h-3" />
            契約更新提案
          </span>
        );
      case 'approval_stale':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800 border border-rose-200">
            <Clock className="w-3 h-3" />
            承認滞留
          </span>
        );
      case 'quotation_follow_up':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">
            <FileText className="w-3 h-3" />
            見積フォロー
          </span>
        );
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <div className="animate-pulse space-y-4">
          <div className="h-5 bg-gray-200 rounded w-1/4"></div>
          <div className="h-16 bg-gray-100 rounded"></div>
        </div>
      </div>
    );
  }

  if (recommendations.length === 0) {
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
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
