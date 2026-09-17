import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Calendar,
  User,
  CheckCircle2,
  XCircle,
  Edit3,
  Trash2,
  FileSpreadsheet,
  Plus,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import { useDeal, useCloseDeal, useDeleteDeal } from './hooks';
import { useQuotations } from '../quotations/hooks';
import { StatusBadge } from './StatusBadge';
import { StatusBadge as QuotationStatusBadge } from '../quotations/StatusBadge';
import { DEAL_STAGES, DEAL_STAGE_LABELS, type DealStage } from './types';

export function DealDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: deal, isLoading, isError, error } = useDeal(id);
  const closeMutation = useCloseDeal(id || '');
  const deleteMutation = useDeleteDeal();

  // 紐づく見積一覧 (既存の見積一覧APIを deal_id 指定で再利用)
  const { data: quoteData, isLoading: isLoadingQuotes } = useQuotations({
    deal_id: id,
    limit: 50,
  });
  const quotations = quoteData?.quotations ?? [];

  // 失注モーダル状態
  const [isLostModalOpen, setIsLostModalOpen] = useState(false);
  const [lostReason, setLostReason] = useState('');
  const [lostError, setLostError] = useState<string | null>(null);

  // 受注確認モーダル状態
  const [isWonModalOpen, setIsWonModalOpen] = useState(false);

  // 削除確認モーダル状態
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="p-12 text-center text-slate-500">
        <div className="inline-block animate-spin w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full mb-2" />
        <p className="text-sm">案件データを読み込み中...</p>
      </div>
    );
  }

  if (isError || !deal) {
    return (
      <div className="p-8 text-center text-rose-600">
        <p className="text-sm font-semibold">案件データの取得に失敗しました</p>
        <p className="text-xs mt-1 text-slate-500">{(error as Error)?.message}</p>
        <Link to="/deals" className="mt-4 inline-block text-xs text-indigo-600 underline">
          案件一覧へ戻る
        </Link>
      </div>
    );
  }

  const isTerminal = deal.is_terminal;

  const handleWonSubmit = async () => {
    try {
      await closeMutation.mutateAsync({ stage: 'won' });
      setIsWonModalOpen(false);
    } catch {
      // hook側でtoast表示
    }
  };

  const handleLostSubmit = async () => {
    setLostError(null);
    if (!lostReason.trim()) {
      setLostError('失注理由を入力してください');
      return;
    }
    try {
      await closeMutation.mutateAsync({
        stage: 'lost',
        lost_reason: lostReason.trim(),
      });
      setIsLostModalOpen(false);
      setLostReason('');
    } catch {
      // hook側でtoast表示
    }
  };

  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(deal.id);
      navigate('/deals');
    } catch {
      // hook側でtoast表示
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* 戻るリンク */}
      <div className="flex items-center gap-4">
        <Link
          to="/deals"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          案件一覧に戻る
        </Link>
      </div>

      {/* 案件ヘッダーカード */}
      <div className="p-6 bg-white rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900">{deal.title}</h1>
              <StatusBadge stage={deal.stage} />
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Building2 className="w-4 h-4 text-slate-400" />
              <span className="font-semibold text-slate-800">{deal.customer_name}</span>
              {deal.customer_code && (
                <span className="text-xs text-slate-400 font-mono">({deal.customer_code})</span>
              )}
            </div>
          </div>

          {/* アクションボタン */}
          <div className="flex items-center gap-2">
            {!isTerminal && (
              <>
                <button
                  type="button"
                  onClick={() => setIsWonModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg shadow-sm hover:bg-emerald-700 transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  受注確定 (Won)
                </button>
                <button
                  type="button"
                  onClick={() => setIsLostModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-rose-50 text-rose-700 border border-rose-200 text-xs font-semibold rounded-lg hover:bg-rose-100 transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                  失注終了 (Lost)
                </button>
                <Link
                  to={`/deals/${deal.id}/edit`}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white text-slate-700 border border-slate-300 text-xs font-semibold rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <Edit3 className="w-4 h-4 text-slate-500" />
                  編集
                </Link>
                <button
                  type="button"
                  onClick={() => setIsDeleteModalOpen(true)}
                  className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100 transition-colors"
                  title="削除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* パイプライン進行バー */}
        <div className="pt-2">
          <p className="text-xs font-semibold text-slate-500 mb-2">商談パイプライン進捗</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {DEAL_STAGES.map((stg: DealStage, index: number) => {
              const isActive = deal.stage === stg;
              const isPassed =
                !deal.is_terminal &&
                ['lead', 'qualified', 'proposal', 'negotiation'].indexOf(deal.stage) >= index;

              return (
                <div
                  key={stg}
                  className={`px-3 py-2 rounded-lg border text-center text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : isPassed
                      ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                      : 'bg-slate-50 text-slate-400 border-slate-200'
                  }`}
                >
                  <div className="text-[10px] opacity-70">Step {index + 1}</div>
                  <div className="truncate">{DEAL_STAGE_LABELS[stg]}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 終端状態メッセージ・失注理由 */}
        {deal.stage === 'lost' && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 space-y-1">
            <span className="font-semibold">【失注理由】</span>
            <p className="whitespace-pre-wrap">{deal.lost_reason || '記載なし'}</p>
          </div>
        )}
        {deal.stage === 'won' && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            この商談は受注成約(Won)としてクローズされています
          </div>
        )}
      </div>

      {/* 案件詳細メタ情報 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm space-y-1">
          <span className="text-xs font-semibold text-slate-500">予想売上金額</span>
          <div className="text-xl font-bold font-mono text-slate-900">
            {deal.expected_amount.toLocaleString()} {deal.currency_code}
          </div>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm space-y-1">
          <span className="text-xs font-semibold text-slate-500 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            受注予定日
          </span>
          <div className="text-base font-semibold font-mono text-slate-800">
            {deal.expected_close_date || '未設定'}
          </div>
        </div>

        <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm space-y-1">
          <span className="text-xs font-semibold text-slate-500 flex items-center gap-1">
            <User className="w-3.5 h-3.5 text-slate-400" />
            案件担当者
          </span>
          <div className="text-base font-semibold text-slate-800">
            {deal.owner_name || '未割当'}
          </div>
        </div>
      </div>

      {/* 紐づく見積書一覧セクション (要件6) */}
      <div className="p-6 bg-white rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-md">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">紐づく見積書一覧</h2>
              <p className="text-xs text-slate-500">
                この案件（商談）に関連付けて作成された見積書（quotations）
              </p>
            </div>
          </div>

          <Link
            to={`/quotations/new?deal_id=${deal.id}&customer_id=${deal.customer_id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg shadow-sm hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            この案件で見積作成
          </Link>
        </div>

        {isLoadingQuotes ? (
          <div className="p-6 text-center text-xs text-slate-400">見積データを読み込み中...</div>
        ) : quotations.length === 0 ? (
          <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-lg text-slate-400">
            <FileSpreadsheet className="w-8 h-8 mx-auto mb-2 text-slate-300 stroke-[1.5]" />
            <p className="text-xs font-medium text-slate-600">この案件に紐づく見積書はまだありません</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              「この案件で見積作成」ボタンから見積を発行してください
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left text-xs text-slate-700 divide-y divide-slate-200">
              <thead className="bg-slate-50 text-slate-500 font-semibold uppercase">
                <tr>
                  <th className="px-3 py-2.5">見積番号 (v)</th>
                  <th className="px-3 py-2.5">件名</th>
                  <th className="px-3 py-2.5">状態</th>
                  <th className="px-3 py-2.5 text-right">合計金額</th>
                  <th className="px-3 py-2.5">発行日</th>
                  <th className="px-3 py-2.5 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {quotations.map((q) => (
                  <tr key={q.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 py-2.5 font-mono font-semibold text-indigo-600 whitespace-nowrap">
                      <Link to={`/quotations/${q.id}`} className="hover:underline">
                        {q.quote_no} <span className="text-[10px] text-slate-400">(v{q.version})</span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-slate-900 max-w-xs truncate">
                      {q.title}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <QuotationStatusBadge status={q.status} />
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {q.total_amount.toLocaleString()} {q.currency_code}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-mono text-slate-500">
                      {q.issue_date}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <Link
                        to={`/quotations/${q.id}`}
                        className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium"
                      >
                        詳細 <ChevronRight className="w-3.5 h-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 受注確認モーダル */}
      {isWonModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-3 text-emerald-600">
              <CheckCircle2 className="w-6 h-6" />
              <h3 className="text-lg font-bold text-slate-900">受注成約(Won)の確定</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              この案件を「受注成約 (won)」としてクローズします。確定後は不可変保護(WORM)が適用され、
              ステージの変更や商談情報の編集はできなくなります。よろしいですか？
            </p>
            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsWonModalOpen(false)}
                className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={closeMutation.isPending}
                onClick={handleWonSubmit}
                className="px-4 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                受注確定を実行
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 失注理由入力モーダル */}
      {isLostModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <XCircle className="w-6 h-6" />
              <h3 className="text-lg font-bold text-slate-900">失注終了(Lost)の確定</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              この案件を「失注終了 (lost)」としてクローズします。確定後は不可変保護(WORM)が適用されます。
              失注理由を入力してください（必須）。
            </p>

            {lostError && (
              <div className="p-2 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-md">
                {lostError}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                失注理由 <span className="text-rose-500">*</span>
              </label>
              <textarea
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
                placeholder="例: 予算超過、他社競合敗退、案件凍結 等"
                rows={3}
                required
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsLostModalOpen(false)}
                className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={closeMutation.isPending}
                onClick={handleLostSubmit}
                className="px-4 py-2 bg-rose-600 text-white text-xs font-semibold rounded-lg hover:bg-rose-700 disabled:opacity-50"
              >
                失注確定を実行
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 削除確認モーダル */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-lg font-bold text-slate-900">案件の削除確認</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              案件「{deal.title}」を削除します。この操作は元に戻せません。
              ※紐づく見積書が存在する場合は削除できません。
            </p>
            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(false)}
                className="px-4 py-2 border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={handleDelete}
                className="px-4 py-2 bg-rose-600 text-white text-xs font-semibold rounded-lg hover:bg-rose-700 disabled:opacity-50"
              >
                削除を実行
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
