import {
  FileCheck,
  FileSearch,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiClient } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import type { components } from '../../types/api.generated';
import { RenewalDealModal } from './RenewalDealModal';

type Contract = components['schemas']['Contract'];
type SimilarContract = components['schemas']['SimilarContract'];

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

export function ContractListPage() {
  // 契約書一覧ステート
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [isLoadingContracts, setIsLoadingContracts] = useState(true);

  // 自然文類似検索ステート (P1-T6)
  const [searchQuery, setSearchQuery] = useState('');
  const [threshold, setThreshold] = useState(0.4);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SimilarContract[] | null>(null);

  // 契約ID指定の類似契約モーダルステート (P1-T6)
  const [selectedContractForSimilar, setSelectedContractForSimilar] = useState<Contract | null>(
    null,
  );
  const [similarToContract, setSimilarToContract] = useState<SimilarContract[] | null>(null);
  const [isLoadingSimilarToContract, setIsLoadingSimilarToContract] = useState(false);

  // 契約更新商談作成モーダルステート (P4-T3)
  const [selectedContractForRenewal, setSelectedContractForRenewal] = useState<Contract | null>(
    null,
  );
  const [searchParams] = useSearchParams();

  // 契約一覧取得
  const fetchContracts = async () => {
    setIsLoadingContracts(true);
    try {
      const res = await apiClient.get<{ data: Contract[] }>('/contracts', {
        params: { page_size: 50 },
      });
      setContracts(res.data.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '契約一覧の取得に失敗しました';
      toast.error(msg);
    } finally {
      setIsLoadingContracts(false);
    }
  };

  useEffect(() => {
    void fetchContracts();
  }, []);

  // URLパラメータで renew_contract_id が渡された場合に自動でモーダルを開く
  useEffect(() => {
    const renewId = searchParams.get('renew_contract_id');
    if (renewId && contracts.length > 0) {
      const target = contracts.find((c) => c.id === renewId);
      if (target) {
        setSelectedContractForRenewal(target);
      }
    }
  }, [searchParams, contracts]);

  // 自然文類似検索実行 (GET /contracts/search/similar)
  const handleTextSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      toast.error('検索キーワードまたは条項の自然文を入力してください');
      return;
    }

    setIsSearching(true);
    try {
      const res = await apiClient.get<{ data: SimilarContract[] }>(
        '/contracts/search/similar',
        {
          params: {
            q: searchQuery.trim(),
            threshold,
            limit: 10,
          },
        },
      );
      setSearchResults(res.data.data);
      if (res.data.data.length === 0) {
        toast.info('類似する契約条項は見つかりませんでした（閾値を下げると見つかる場合があります）');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '類似契約検索に失敗しました';
      toast.error(msg);
    } finally {
      setIsSearching(false);
    }
  };

  // 契約ID指定の類似検索モーダルを開く (GET /contracts/:id/similar)
  const handleOpenSimilarModal = async (contract: Contract) => {
    setSelectedContractForSimilar(contract);
    setIsLoadingSimilarToContract(true);
    try {
      const res = await apiClient.get<{ data: SimilarContract[] }>(
        `/contracts/${contract.id}/similar`,
        {
          params: {
            threshold: 0.3,
            limit: 10,
          },
        },
      );
      setSimilarToContract(res.data.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '類似契約の取得に失敗しました';
      toast.error(msg);
    } finally {
      setIsLoadingSimilarToContract(false);
    }
  };

  const handleCloseSimilarModal = () => {
    setSelectedContractForSimilar(null);
    setSimilarToContract(null);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* ページ上部ヘッダー */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <FileCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                契約書管理 & 全文条項検索
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                pgvector を活用した類似条項探索・契約書ライフサイクル管理 (Phase 1)
              </p>
            </div>
          </div>
        </div>

        <Link
          to="/contracts/new"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          契約書を新規作成
        </Link>
      </div>

      {/* AI類似条項・全文検索パネル (pgvector) */}
      <div className="bg-gradient-to-br from-indigo-900 via-indigo-950 to-slate-900 rounded-2xl p-6 text-white shadow-lg border border-indigo-800/40 relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-10 -translate-y-10 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-400" />
              <h2 className="text-base font-semibold tracking-wide">
                契約条項 AI ベクトル類似検索 (pgvector)
              </h2>
            </div>
            <span className="text-xs px-2.5 py-1 bg-indigo-500/20 text-indigo-200 rounded-full border border-indigo-400/30">
              テナント完全隔離 (RLS + アプリ層二重防御)
            </span>
          </div>
          <p className="text-xs text-indigo-200/80 max-w-3xl leading-relaxed">
            キーワードだけでなく、「秘密保持義務違反時の違約金」「SLA 99.9% 稼働率保証」「解約予告期間」など、自然文や条項の意図から過去の確定契約書を類似度順に検索できます。
          </p>

          <form onSubmit={handleTextSearch} className="space-y-3">
            <div className="flex flex-col md:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-300" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="検索したい条項内容やキーワードを入力してください（例: 秘密保持 損害賠償、再委託の事前承諾、中途解約）"
                  className="w-full pl-10 pr-4 py-2.5 text-sm bg-indigo-950/60 text-white placeholder-indigo-300/50 rounded-xl border border-indigo-700/60 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition-all"
                />
              </div>

              <div className="flex items-center gap-2 bg-indigo-950/60 px-3 py-1.5 rounded-xl border border-indigo-700/60 text-xs">
                <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-300" />
                <span className="text-indigo-200 whitespace-nowrap">類似度閾値:</span>
                <input
                  type="range"
                  min="0.2"
                  max="0.9"
                  step="0.05"
                  value={threshold}
                  onChange={(e) => setThreshold(parseFloat(e.target.value))}
                  className="w-20 accent-indigo-400 cursor-pointer"
                />
                <span className="font-mono text-amber-300 w-8">
                  {Math.round(threshold * 100)}%
                </span>
              </div>

              <button
                type="submit"
                disabled={isSearching}
                className="px-5 py-2.5 text-sm font-medium bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white rounded-xl shadow transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isSearching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    探索中...
                  </>
                ) : (
                  <>
                    <FileSearch className="w-4 h-4" />
                    類似条項を検索
                  </>
                )}
              </button>
            </div>
          </form>

          {/* 検索結果表示 */}
          {searchResults && (
            <div className="pt-3 border-t border-indigo-800/60 space-y-3">
              <div className="flex items-center justify-between text-xs text-indigo-200">
                <span>
                  検索結果: <strong className="text-white">{searchResults.length}</strong> 件の類似条項が見つかりました
                </span>
                <button
                  type="button"
                  onClick={() => setSearchResults(null)}
                  className="hover:text-white underline"
                >
                  結果を閉じる
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-1">
                {searchResults.map((item) => (
                  <div
                    key={`${item.id}-${item.matched_chunk_index}`}
                    className="p-4 bg-slate-900/80 rounded-xl border border-indigo-700/50 hover:border-indigo-500/80 transition-all space-y-2.5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-mono text-indigo-300">
                          {item.contract_no}
                        </div>
                        <h4 className="text-sm font-bold text-white line-clamp-1">
                          {item.title}
                        </h4>
                        <div className="text-xs text-slate-400">
                          相手先: {item.counterparty_name}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-xs font-bold text-amber-400 font-mono">
                          類似度 {Math.round(item.similarity_score * 100)}%
                        </div>
                        <div className="w-16 bg-slate-800 h-1.5 rounded-full mt-1 overflow-hidden">
                          <div
                            className="bg-gradient-to-r from-amber-400 to-emerald-400 h-full rounded-full"
                            style={{ width: `${Math.min(100, item.similarity_score * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* マッチした条項チャンク抜粋 */}
                    <div className="p-2.5 bg-slate-950/70 rounded-lg border border-slate-800 text-xs text-indigo-100/90 font-mono leading-relaxed line-clamp-3">
                      {item.matched_chunk_text}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 契約書一覧テーブル */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">確定契約書一覧</h2>
            <p className="text-xs text-slate-500">
              全 {contracts.length} 件の契約書が登録されています
            </p>
          </div>
        </div>

        {isLoadingContracts ? (
          <div className="p-12 text-center text-slate-500 flex flex-col items-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
            <span className="text-sm">契約書一覧を読み込み中...</span>
          </div>
        ) : contracts.length === 0 ? (
          <div className="p-12 text-center text-slate-500 space-y-3">
            <FileText className="w-10 h-10 mx-auto text-slate-400" />
            <p className="text-sm">登録されている契約書はありません</p>
            <Link
              to="/contracts/new"
              className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline font-medium"
            >
              <Plus className="w-4 h-4" /> 契約書を新規登録する
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-600 text-xs font-semibold border-b border-slate-200">
                  <th className="px-5 py-3.5">契約番号</th>
                  <th className="px-5 py-3.5">タイトル / 相手先</th>
                  <th className="px-5 py-3.5">契約種別</th>
                  <th className="px-5 py-3.5">契約金額</th>
                  <th className="px-5 py-3.5">有効期間</th>
                  <th className="px-5 py-3.5">ステータス</th>
                  <th className="px-5 py-3.5 text-right">アクション</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {contracts.map((contract) => {
                  const statusInfo = STATUS_CONFIG[contract.status] ?? {
                    label: contract.status,
                    bg: 'bg-slate-100',
                    text: 'text-slate-700',
                    border: 'border-slate-300',
                  };

                  return (
                    <tr
                      key={contract.id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="px-5 py-4 font-mono text-xs font-semibold text-slate-700">
                        {contract.contract_no}
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-semibold text-slate-900">{contract.title}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {contract.counterparty_name}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-700">
                        <span className="px-2.5 py-1 bg-slate-100 rounded-md text-slate-600 font-medium">
                          {contract.contract_type}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-mono text-sm text-slate-900 font-medium">
                        {contract.contract_amount != null
                          ? `¥${contract.contract_amount.toLocaleString()}`
                          : '-'}
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-600">
                        <div>{contract.start_date} 〜 {contract.end_date ?? '期間の定めなし'}</div>
                        {contract.auto_renewal && (
                          <div className="text-indigo-600 text-[11px] font-medium mt-0.5">
                            自動更新あり (通知 {contract.renewal_notice_days}日前)
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${statusInfo.bg} ${statusInfo.text} ${statusInfo.border}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedContractForRenewal(contract)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg transition-colors border border-emerald-200"
                            title="この契約の更新提案商談（案件）を作成"
                          >
                            <RefreshCw className="w-3.5 h-3.5 text-emerald-600" />
                            更新商談作成
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenSimilarModal(contract)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors border border-indigo-200"
                            title="この契約書に類似する契約書をベクトル探索"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                            類似契約
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 類似契約表示モーダル (GET /contracts/:id/similar) */}
      {selectedContractForSimilar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] shadow-2xl flex flex-col border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    「{selectedContractForSimilar.title}」の類似契約
                  </h3>
                  <p className="text-xs text-slate-500 font-mono">
                    {selectedContractForSimilar.contract_no} / {selectedContractForSimilar.counterparty_name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseSimilarModal}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              {isLoadingSimilarToContract ? (
                <div className="py-12 text-center flex flex-col items-center gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
                  <span className="text-sm text-slate-600">
                    pgvector によるコサイン類似度近傍探索を実行中...
                  </span>
                </div>
              ) : !similarToContract || similarToContract.length === 0 ? (
                <div className="py-12 text-center text-slate-500 space-y-2">
                  <FileText className="w-10 h-10 mx-auto text-slate-400" />
                  <p className="text-sm font-medium">類似する契約書は見つかりませんでした</p>
                  <p className="text-xs text-slate-400">
                    本文が登録されていないか、類似度基準（閾値 30%）を満たす他の契約が存在しません
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-xs text-slate-500">
                    ベクトル空間上で類似度が高い順に最大 10 件表示しています（自テナント内のみ）:
                  </div>
                  {similarToContract.map((sim) => (
                    <div
                      key={`${sim.id}-${sim.matched_chunk_index}`}
                      className="p-4 rounded-xl border border-slate-200 hover:border-indigo-300 bg-slate-50/50 space-y-2.5 transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span className="text-xs font-mono text-indigo-600 font-semibold">
                            {sim.contract_no}
                          </span>
                          <h4 className="text-sm font-bold text-slate-900">
                            {sim.title}
                          </h4>
                          <div className="text-xs text-slate-500">
                            相手先: {sim.counterparty_name} / 種別: {sim.contract_type}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-300">
                            類似度 {Math.round(sim.similarity_score * 100)}%
                          </span>
                        </div>
                      </div>

                      {/* マッチした類似条項テキスト抜粋 */}
                      <div className="p-3 bg-white rounded-lg border border-slate-200 text-xs text-slate-700 font-mono leading-relaxed">
                        <div className="text-[10px] text-slate-400 font-semibold mb-1">
                          マッチした条項抜粋 (Chunk #{sim.matched_chunk_index}):
                        </div>
                        {sim.matched_chunk_text}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
              <button
                type="button"
                onClick={handleCloseSimilarModal}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 契約更新商談作成モーダル (P4-T3) */}
      {selectedContractForRenewal && (
        <RenewalDealModal
          contract={selectedContractForRenewal}
          onClose={() => setSelectedContractForRenewal(null)}
          onSuccess={() => {
            setSelectedContractForRenewal(null);
          }}
        />
      )}
    </div>
  );
}
