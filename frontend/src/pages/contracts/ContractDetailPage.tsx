import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  Building2,
  AlertCircle,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { apiClient } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import type { components } from '../../types/api.generated';
import { RecommendationWidget } from '../../components/recommendations/RecommendationWidget';
import { RenewalDealModal } from './RenewalDealModal';

type Contract = components['schemas']['Contract'];

const STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; text: string; border: string }
> = {
  draft: {
    label: '下書き',
    bg: 'bg-slate-100',
    text: 'text-slate-700',
    border: 'border-slate-300',
  },
  pending_approval: {
    label: '承認申請中',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-300',
  },
  active: {
    label: '有効',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-300',
  },
  expired: {
    label: '期間満了',
    bg: 'bg-zinc-100',
    text: 'text-zinc-600',
    border: 'border-zinc-300',
  },
  terminated: {
    label: '中途解約済',
    bg: 'bg-rose-50',
    text: 'text-rose-700',
    border: 'border-rose-300',
  },
};

export function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [contract, setContract] = useState<Contract | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRenewalModalOpen, setIsRenewalModalOpen] = useState<boolean>(false);

  const fetchContract = async () => {
    if (!id) return;
    try {
      setIsLoading(true);
      const res = await apiClient.get<{ data: Contract }>(`/contracts/${id}`);
      setContract(res.data.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '契約情報の取得に失敗しました';
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchContract();
  }, [id]);

  if (isLoading) {
    return (
      <div className="p-12 text-center text-slate-500 flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        <span className="text-sm">契約書詳細を読み込み中...</span>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="p-12 text-center text-rose-500 space-y-3">
        <AlertCircle className="w-10 h-10 mx-auto text-rose-400" />
        <p className="text-base font-semibold">指定された契約書が見つかりませんでした</p>
        <Link
          to="/contracts"
          className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline"
        >
          <ArrowLeft className="w-4 h-4" /> 契約書一覧に戻る
        </Link>
      </div>
    );
  }

  const statusInfo = STATUS_CONFIG[contract.status] ?? {
    label: contract.status,
    bg: 'bg-slate-100',
    text: 'text-slate-700',
    border: 'border-slate-300',
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* ページ上部ヘッダー・アクションバー */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to="/contracts"
            className="p-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 shadow-sm transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold text-slate-900">{contract.title}</h1>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusInfo.bg} ${statusInfo.text} ${statusInfo.border}`}
              >
                {statusInfo.label}
              </span>
            </div>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              契約番号: {contract.contract_no}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsRenewalModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>更新商談を作成</span>
          </button>
        </div>
      </div>

      {/* AIレコメンド統合表示（P5-T3: 契約更新推奨アラート） */}
      <RecommendationWidget
        targetDomain="contracts"
        targetId={contract.id}
        requiredPermission="contract.view"
        variant="banner"
      />

      {/* 契約書詳細情報カード */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 基本情報 */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
              基本情報
            </h3>
            <div className="space-y-2.5 text-sm">
              <div className="flex items-start justify-between">
                <span className="text-slate-500 text-xs">相手先名称:</span>
                <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-slate-400" />
                  {contract.counterparty_name}
                </span>
              </div>
              <div className="flex items-start justify-between">
                <span className="text-slate-500 text-xs">契約種別:</span>
                <span className="px-2 py-0.5 bg-slate-100 rounded text-xs text-slate-700 font-medium">
                  {contract.contract_type}
                </span>
              </div>
              <div className="flex items-start justify-between">
                <span className="text-slate-500 text-xs">契約金額:</span>
                <span className="font-mono font-bold text-slate-900">
                  {contract.contract_amount != null
                    ? `¥${contract.contract_amount.toLocaleString()}`
                    : '-'}
                </span>
              </div>
            </div>
          </div>

          {/* 期間および更新設定 */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
              契約期間・更新規定
            </h3>
            <div className="space-y-2.5 text-sm">
              <div className="flex items-start justify-between">
                <span className="text-slate-500 text-xs">開始日:</span>
                <span className="font-mono text-slate-800">{contract.start_date}</span>
              </div>
              <div className="flex items-start justify-between">
                <span className="text-slate-500 text-xs">終了日:</span>
                <span className="font-mono text-slate-800">
                  {contract.end_date ?? '期間の定めなし'}
                </span>
              </div>
              <div className="flex items-start justify-between">
                <span className="text-slate-500 text-xs">自動更新:</span>
                <span className="text-xs font-semibold">
                  {contract.auto_renewal ? (
                    <span className="text-indigo-600">あり (通知 {contract.renewal_notice_days}日前)</span>
                  ) : (
                    <span className="text-slate-500">なし</span>
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 契約更新商談作成モーダル */}
      {isRenewalModalOpen && (
        <RenewalDealModal
          contract={contract}
          onClose={() => setIsRenewalModalOpen(false)}
          onSuccess={() => {
            setIsRenewalModalOpen(false);
            toast.success('更新提案商談を作成しました');
            void fetchContract();
          }}
        />
      )}
    </div>
  );
}
