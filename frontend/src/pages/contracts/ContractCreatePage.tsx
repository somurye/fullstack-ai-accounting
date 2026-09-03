import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Loader2,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import type { components } from '../../types/api.generated';

type ContractCreate = components['schemas']['ContractCreate'];
type ContractType = components['schemas']['ContractType'];
type AiSuggestionDto = components['schemas']['AiSuggestion'];

const CONTRACT_TYPES: { value: ContractType; label: string }[] = [
  { value: 'outsourcing', label: '業務委託契約' },
  { value: 'nda', label: '秘密保持契約 (NDA)' },
  { value: 'lease', label: '賃貸借契約' },
  { value: 'sales', label: '売買契約' },
  { value: 'service', label: 'サービス利用規約・保守契約' },
  { value: 'license', label: 'ライセンス・知的財産' },
  { value: 'employment', label: '雇用・労働契約' },
  { value: 'other', label: 'その他契約' },
];

export function ContractCreatePage() {
  const navigate = useNavigate();

  // フォームステート
  const [formData, setFormData] = useState<ContractCreate>({
    title: '',
    counterparty_name: '',
    contract_type: 'outsourcing',
    contract_amount: null,
    currency: 'JPY',
    start_date: new Date().toISOString().slice(0, 10),
    end_date: null,
    auto_renewal: false,
    renewal_notice_days: 30,
    attachment_id: null,
    description: '',
  });

  // 添付ファイル & AI抽出ステート
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestionDto | null>(null);

  // ファイルアップロードハンドラー
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const uploadFormData = new FormData();
      uploadFormData.append('file', file);
      uploadFormData.append('document_category', 'contract');

      const uploadRes = await apiClient.post<{ data: { id: string; file_name: string } }>(
        '/attachments',
        uploadFormData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
        },
      );

      const attachment = uploadRes.data.data;
      setUploadedFileName(attachment.file_name);
      setFormData((prev) => ({ ...prev, attachment_id: attachment.id }));
      toast.success(`契約書「${attachment.file_name}」をアップロードしました`);

      // 自動でAI条項抽出を実行
      await runAiExtraction(attachment.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'アップロードに失敗しました';
      toast.error(msg);
    } finally {
      setIsUploading(false);
    }
  };

  // AI条項抽出ハンドラー (Core API への直接書き込みは行わず ai_suggestions に隔離保存)
  const runAiExtraction = async (attachmentId: string) => {
    setIsExtracting(true);
    try {
      const res = await apiClient.post<{ data: AiSuggestionDto }>('/contracts/extract-terms', {
        attachment_id: attachmentId,
      });
      const suggestion = res.data.data;
      setAiSuggestion(suggestion);

      // 抽出フィールドからフォーム初期値を補完 (人間が編集可能)
      const fields = (suggestion.payload as { suggested_fields?: Record<string, { value: unknown }> })
        ?.suggested_fields;

      if (fields) {
        setFormData((prev) => {
          const updated = { ...prev };
          if (typeof fields.contract_title?.value === 'string' && fields.contract_title.value) {
            updated.title = fields.contract_title.value;
          }
          if (typeof fields.contract_parties?.value === 'string') {
            const rawParties = fields.contract_parties.value;
            const otsuMatch = rawParties.match(/乙[：:\s]+([^\n/]+)/);
            if (otsuMatch) {
              updated.counterparty_name = otsuMatch[1].trim();
            } else {
              updated.counterparty_name = rawParties;
            }
          }
          if (typeof fields.contract_start_date?.value === 'string') {
            updated.start_date = fields.contract_start_date.value;
          }
          if (typeof fields.contract_end_date?.value === 'string') {
            updated.end_date = fields.contract_end_date.value;
          }
          if (typeof fields.contract_amount?.value === 'number') {
            updated.contract_amount = fields.contract_amount.value;
          }
          if (typeof fields.auto_renewal?.value === 'boolean') {
            updated.auto_renewal = fields.auto_renewal.value;
          }
          if (typeof fields.notice_period_days?.value === 'number') {
            updated.renewal_notice_days = fields.notice_period_days.value;
          }
          return updated;
        });
      }
      toast.success('AIによる条項の抽出が完了しました。内容を確認してください。');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'AI条項抽出に失敗しました';
      toast.error(msg);
    } finally {
      setIsExtracting(false);
    }
  };

  // 確定操作 (人間が確認・修正した値で Core API である POST /contracts を呼出)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) {
      toast.error('契約書タイトルを入力してください');
      return;
    }
    if (!formData.counterparty_name.trim()) {
      toast.error('相手先名を入力してください');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiClient.post<{ data: { id: string; contract_no: string } }>(
        '/contracts',
        formData,
      );
      const created = res.data.data;
      toast.success(`契約書「${formData.title}」(${created.contract_no})を下書き保存しました`);
      navigate('/contracts');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '契約書の保存に失敗しました';
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // AI信頼度バッジコンポーネント
  const renderConfidenceBadge = (fieldName: string) => {
    const fields = (aiSuggestion?.payload as { suggested_fields?: Record<string, { confidence: number; rationale?: string }> })
      ?.suggested_fields;
    const field = fields?.[fieldName];
    if (!field) return null;

    const percentage = Math.round(field.confidence * 100);
    const badgeColor =
      percentage >= 85
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : 'bg-amber-50 text-amber-700 border-amber-200';

    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border ${badgeColor}`}
        title={field.rationale ?? `AI信頼度: ${percentage}%`}
      >
        <Sparkles className="w-3 h-3" />
        AI抽出: {percentage}%
      </span>
    );
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* ナビゲーションバー */}
      <div className="flex items-center justify-between border-b pb-4">
        <div className="flex items-center gap-3">
          <Link
            to="/contracts"
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">契約書の新規作成</h1>
            <p className="text-sm text-slate-500">
              PDFをアップロードしてAIによる条項自動抽出を行うか、直接入力してください
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左カラム: PDFアップロード & AI抽出パネル */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <UploadCloud className="w-5 h-5 text-indigo-600" />
              1. 契約書PDFのアップロード
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed">
              契約書PDFを選択すると、AIゲートウェイが条項（タイトル、期間、金額、自動更新等）を自動抽出し、右側の入力フォームに候補を入力します。
            </p>

            <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 hover:border-indigo-500 rounded-lg p-6 cursor-pointer bg-slate-50 hover:bg-indigo-50/30 transition-colors">
              <FileText className="w-10 h-10 text-slate-400 mb-2" />
              <span className="text-sm font-medium text-slate-700">PDFファイルを選択</span>
              <span className="text-xs text-slate-400 mt-1">またはドラッグ＆ドロップ</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={handleFileUpload}
                disabled={isUploading || isExtracting}
              />
            </label>

            {/* アップロード・抽出状況 */}
            {isUploading && (
              <div className="flex items-center gap-2 text-sm text-indigo-600">
                <Loader2 className="w-4 h-4 animate-spin" />
                アップロード中...
              </div>
            )}

            {isExtracting && (
              <div className="flex items-center gap-2 text-sm text-purple-600">
                <Loader2 className="w-4 h-4 animate-spin" />
                AI条項抽出エンジン実行中...
              </div>
            )}

            {uploadedFileName && !isUploading && (
              <div className="p-3 bg-slate-100 rounded-lg flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700 truncate max-w-[200px]">
                  {uploadedFileName}
                </span>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              </div>
            )}

            {/* AI提案の隔離原則注記 */}
            <div className="p-3 bg-amber-50/60 rounded-lg border border-amber-200/60 text-xs text-amber-800 space-y-1">
              <div className="font-semibold flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                AI提案の隔離原則
              </div>
              <p>
                AI抽出結果は確認用の一時提案です。右側のフォームで人間が内容を確認・修正し、「下書き保存」を押すまで契約データベースには確定保存されません。
              </p>
            </div>
          </div>
        </div>

        {/* 右カラム: 人間確認・編集フォーム */}
        <div className="lg:col-span-2">
          <form
            onSubmit={handleSubmit}
            className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-6"
          >
            <div className="border-b pb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                2. 条項の確認と編集
              </h2>
              {aiSuggestion && (
                <span className="text-xs text-slate-400">
                  抽出モデル: {aiSuggestion.model_name}
                </span>
              )}
            </div>

            {/* 契約書タイトル */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-700">
                  契約書件名・タイトル <span className="text-rose-500">*</span>
                </label>
                {renderConfidenceBadge('contract_title')}
              </div>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="例: 業務委託基本契約書"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* 相手先 & 契約種別 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-700">
                    相手先企業・個人名 <span className="text-rose-500">*</span>
                  </label>
                  {renderConfidenceBadge('contract_parties')}
                </div>
                <input
                  type="text"
                  required
                  value={formData.counterparty_name}
                  onChange={(e) =>
                    setFormData({ ...formData, counterparty_name: e.target.value })
                  }
                  placeholder="例: 株式会社ABCパートナーズ"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">
                  契約種別 <span className="text-rose-500">*</span>
                </label>
                <select
                  value={formData.contract_type}
                  onChange={(e) =>
                    setFormData({ ...formData, contract_type: e.target.value as ContractType })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {CONTRACT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 契約金額 & 通貨 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-700">
                    契約金額 (税込)
                  </label>
                  {renderConfidenceBadge('contract_amount')}
                </div>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={formData.contract_amount ?? ''}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      contract_amount: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  placeholder="例: 500000 (NDA等は空欄可)"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-700">通貨</label>
                <input
                  type="text"
                  maxLength={3}
                  value={formData.currency}
                  onChange={(e) => setFormData({ ...formData, currency: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* 契約期間 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-700">
                    契約開始日 <span className="text-rose-500">*</span>
                  </label>
                  {renderConfidenceBadge('contract_start_date')}
                </div>
                <input
                  type="date"
                  required
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-700">
                    契約満了日 (終了日)
                  </label>
                  {renderConfidenceBadge('contract_end_date')}
                </div>
                <input
                  type="date"
                  value={formData.end_date ?? ''}
                  onChange={(e) =>
                    setFormData({ ...formData, end_date: e.target.value ? e.target.value : null })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* 自動更新 & 更新通知期限 */}
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.auto_renewal}
                    onChange={(e) => setFormData({ ...formData, auto_renewal: e.target.checked })}
                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                  />
                  <span className="text-sm font-medium text-slate-800">
                    自動更新条項あり
                  </span>
                </label>
                {renderConfidenceBadge('auto_renewal')}
              </div>

              {formData.auto_renewal && (
                <div className="flex items-center gap-3 pt-2">
                  <label className="text-xs text-slate-600 whitespace-nowrap">
                    解約申入期限 (満了日前):
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={formData.renewal_notice_days}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        renewal_notice_days: Number(e.target.value) || 30,
                      })
                    }
                    className="w-20 px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <span className="text-xs text-slate-500">日前まで</span>
                  {renderConfidenceBadge('notice_period_days')}
                </div>
              )}
            </div>

            {/* 概要・特記事項 */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">概要・特記事項</label>
              <textarea
                rows={3}
                value={formData.description ?? ''}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="契約の概要や注意事項を入力してください"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* 確定アクションボタン */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t">
              <Link
                to="/contracts"
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                キャンセル
              </Link>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-6 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    保存中...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    確認して下書き保存
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
