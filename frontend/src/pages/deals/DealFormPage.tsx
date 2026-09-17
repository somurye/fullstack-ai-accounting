import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, Save, Briefcase, AlertCircle } from 'lucide-react';
import { useDeal, useCreateDeal, useUpdateDeal, useCustomers, useUsers } from './hooks';
import { type DealStage, DEAL_STAGES, DEAL_STAGE_LABELS } from './types';

export function DealFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const { data: existingDeal, isLoading: isLoadingDeal } = useDeal(id);
  const { data: customerData } = useCustomers();
  const { data: userData } = useUsers();

  const customers = customerData ?? [];
  const users = userData ?? [];

  const createMutation = useCreateDeal();
  const updateMutation = useUpdateDeal(id || '');

  const [customerId, setCustomerId] = useState('');
  const [title, setTitle] = useState('');
  const [stage, setStage] = useState<DealStage>('lead');
  const [expectedAmount, setExpectedAmount] = useState<number>(0);
  const [currencyCode, setCurrencyCode] = useState('JPY');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (existingDeal) {
      setCustomerId(existingDeal.customer_id);
      setTitle(existingDeal.title);
      setStage(existingDeal.stage);
      setExpectedAmount(existingDeal.expected_amount);
      setCurrencyCode(existingDeal.currency_code);
      setExpectedCloseDate(existingDeal.expected_close_date || '');
      setOwnerUserId(existingDeal.owner_user_id || '');
    }
  }, [existingDeal]);

  const isTerminal = existingDeal?.is_terminal ?? false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!customerId) {
      setFormError('顧客を選択してください');
      return;
    }
    if (!title.trim()) {
      setFormError('案件名を入力してください');
      return;
    }

    try {
      if (isEdit && id) {
        await updateMutation.mutateAsync({
          customer_id: customerId,
          title: title.trim(),
          stage,
          expected_amount: Number(expectedAmount) || 0,
          currency_code: currencyCode,
          expected_close_date: expectedCloseDate || null,
          owner_user_id: ownerUserId || null,
        });
        navigate(`/deals/${id}`);
      } else {
        const created = await createMutation.mutateAsync({
          customer_id: customerId,
          title: title.trim(),
          stage,
          expected_amount: Number(expectedAmount) || 0,
          currency_code: currencyCode,
          expected_close_date: expectedCloseDate || null,
          owner_user_id: ownerUserId || null,
        });
        navigate(`/deals/${created.id}`);
      }
    } catch {
      // エラーは hook 側の onError (toast) で通知
    }
  };

  if (isEdit && isLoadingDeal) {
    return (
      <div className="p-12 text-center text-slate-500">
        <div className="inline-block animate-spin w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full mb-2" />
        <p className="text-sm">案件データを読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* ナビゲーション戻る */}
      <div className="flex items-center gap-4">
        <Link
          to={isEdit ? `/deals/${id}` : '/deals'}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {isEdit ? '詳細に戻る' : '一覧に戻る'}
        </Link>
      </div>

      {/* タイトルヘッダー */}
      <div className="flex items-center gap-3 pb-2 border-b border-slate-200">
        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
          <Briefcase className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {isEdit ? '案件の編集' : '新規案件作成'}
          </h1>
          <p className="text-sm text-slate-500">商談の基本情報・顧客・ステージ・予想売上を設定します</p>
        </div>
      </div>

      {/* 終端状態警告 */}
      {isTerminal && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3 text-amber-800 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0 text-amber-600 mt-0.5" />
          <div>
            <p className="font-semibold">この案件は既にクローズ(受注または失注)しています</p>
            <p className="text-xs text-amber-700 mt-0.5">
              終端状態に達した案件レコードは不可変保護(WORM)の対象となり、内容の変更はできません。
            </p>
          </div>
        </div>
      )}

      {/* フォームエラー */}
      {formError && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 font-medium">
          {formError}
        </div>
      )}

      {/* メインフォーム */}
      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-5">
        <fieldset disabled={isTerminal} className="space-y-5">
          {/* 顧客選択 */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              顧客 <span className="text-rose-500">*</span>
            </label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
            >
              <option value="">顧客を選択してください</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* 案件名 */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              案件名・商談タイトル <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: 基幹システム刷新プロジェクト提案"
              required
              maxLength={200}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          {/* ステージ & 通貨 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                商談ステージ
              </label>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value as DealStage)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
              >
                {DEAL_STAGES.filter((s: DealStage) => s !== 'won' && s !== 'lost').map((stg: DealStage) => (
                  <option key={stg} value={stg}>
                    {DEAL_STAGE_LABELS[stg]}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400 mt-1">
                ※ 受注・失注へのクローズ確定は詳細画面のクローズアクションから行います
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                予想売上金額 (円)
              </label>
              <input
                type="number"
                min={0}
                step={1}
                value={expectedAmount}
                onChange={(e) => setExpectedAmount(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono"
              />
            </div>
          </div>

          {/* 受注予定日 & 担当者 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                受注予定日
              </label>
              <input
                type="date"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                案件担当者
              </label>
              <select
                value={ownerUserId}
                onChange={(e) => setOwnerUserId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
              >
                <option value="">担当者を選択 (未割当)</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display_name} ({u.email})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>

        {/* ボタン操作 */}
        {!isTerminal && (
          <div className="pt-4 border-t border-slate-200 flex justify-end gap-3">
            <Link
              to={isEdit ? `/deals/${id}` : '/deals'}
              className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
            >
              キャンセル
            </Link>
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg shadow-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              <Save className="w-4 h-4" />
              {isEdit ? '変更を保存' : '案件を作成'}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
