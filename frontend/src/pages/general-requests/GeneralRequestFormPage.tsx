import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  FileText,
  ArrowLeft,
  UploadCloud,
  Paperclip,
  Trash2,
  Send,
  Save,
  Loader2,
} from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { toast } from '../../stores/toastStore';
import {
  GENERAL_REQUEST_CATEGORIES,
  type CreateGeneralRequestInput,
  type GeneralRequest,
} from './types';

export function GeneralRequestFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [formData, setFormData] = useState<CreateGeneralRequestInput>({
    title: '',
    description: '',
    category: 'general',
    amount: null,
    attachment_id: null,
  });

  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  useEffect(() => {
    if (isEdit && id) {
      (async () => {
        try {
          const res = await apiClient.get<{ data: GeneralRequest }>(
            `/general-requests/${id}`,
          );
          const req = res.data.data;
          if (req.status !== 'draft') {
            toast.error('下書き以外の稟議は編集できません');
            navigate(`/general-requests/${id}`);
            return;
          }
          setFormData({
            title: req.title,
            description: req.description,
            category: req.category,
            amount: req.amount !== null && req.amount !== undefined ? Number(req.amount) : null,
            attachment_id: req.attachment_id,
          });
          if (req.attachment_id) {
            setUploadedFileName('添付ファイル登録済み');
          }
        } catch (err: any) {
          toast.error('稟議データの取得に失敗しました');
          navigate('/general-requests');
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [id, isEdit, navigate]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const uploadFormData = new FormData();
      uploadFormData.append('file', file);
      uploadFormData.append('document_category', 'general_request');

      const res = await apiClient.post<{ data: { id: string; file_name: string } }>(
        '/attachments',
        uploadFormData,
        {
          headers: { 'Content-Type': 'multipart/form-data' },
        },
      );

      const attachment = res.data.data;
      setUploadedFileName(attachment.file_name);
      setFormData((prev) => ({ ...prev, attachment_id: attachment.id }));
      toast.success(`添付ファイル「${attachment.file_name}」をアップロードしました`);
    } catch (err: any) {
      toast.error('ファイルのアップロードに失敗しました');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveAttachment = () => {
    setFormData((prev) => ({ ...prev, attachment_id: null }));
    setUploadedFileName(null);
  };

  const handleSubmit = async (shouldSubmitApproval: boolean) => {
    if (!formData.title.trim()) {
      toast.error('タイトルを入力してください');
      return;
    }
    if (!formData.description.trim()) {
      toast.error('説明・理由を入力してください');
      return;
    }

    setIsSubmitting(true);
    try {
      let savedId = id;
      if (isEdit && id) {
        await apiClient.put(`/general-requests/${id}`, formData);
        toast.success('稟議を下書き保存しました');
      } else {
        const createRes = await apiClient.post<{ data: GeneralRequest }>(
          '/general-requests',
          formData,
        );
        savedId = createRes.data.data.id;
        toast.success('稟議を下書き保存しました');
      }

      if (shouldSubmitApproval && savedId) {
        const approvalRes = await apiClient.post<{ data: GeneralRequest }>(
          `/general-requests/${savedId}/submit-approval`,
        );
        const updated = approvalRes.data.data;
        if (updated.status === 'active') {
          toast.success('自動承認ルールが適用され、稟議が即時承認されました！');
        } else {
          toast.success('承認申請を提出しました！');
        }
      }

      navigate(savedId ? `/general-requests/${savedId}` : '/general-requests');
    } catch (err: any) {
      toast.error(err.message || '保存または申請処理に失敗しました');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* 戻るリンク */}
      <div className="mb-6">
        <Link
          to="/general-requests"
          className="inline-flex items-center gap-1.5 text-sm text-surface-400 transition-colors hover:text-surface-200"
        >
          <ArrowLeft className="h-4 w-4" />
          稟議一覧へ戻る
        </Link>
      </div>

      {/* フォームカード */}
      <div className="rounded-2xl border border-surface-800 bg-surface-900/70 p-6 shadow-xl backdrop-blur sm:p-8">
        <div className="border-b border-surface-800 pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600/20 text-brand-400">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-surface-50">
                {isEdit ? '稟議申請の編集' : '新規稟議の起票'}
              </h1>
              <p className="mt-1 text-xs text-surface-400">
                備品購入、規程改定、出張申請など、申請内容を入力してください。
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-6">
          {/* カテゴリ */}
          <div>
            <label className="block text-sm font-medium text-surface-200">
              申請カテゴリ <span className="text-rose-400">*</span>
            </label>
            <select
              value={formData.category}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, category: e.target.value }))
              }
              className="mt-1.5 w-full rounded-lg border border-surface-700 bg-surface-800 px-3.5 py-2.5 text-sm text-surface-100 transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {GENERAL_REQUEST_CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          {/* タイトル */}
          <div>
            <label className="block text-sm font-medium text-surface-200">
              稟議件名・タイトル <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              required
              value={formData.title}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, title: e.target.value }))
              }
              placeholder="例: テレワーク用ディスプレイ購入の件、就業規則第12条改定案"
              className="mt-1.5 w-full rounded-lg border border-surface-700 bg-surface-800 px-3.5 py-2.5 text-sm text-surface-100 placeholder-surface-500 transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* 申請金額 (任意) */}
          <div>
            <label className="block text-sm font-medium text-surface-200">
              概算金額 (税込・任意)
            </label>
            <div className="relative mt-1.5">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-surface-400">
                ¥
              </span>
              <input
                type="number"
                min="0"
                value={formData.amount ?? ''}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    amount: e.target.value === '' ? null : Number(e.target.value),
                  }))
                }
                placeholder="0"
                className="w-full rounded-lg border border-surface-700 bg-surface-800 py-2.5 pl-8 pr-3 text-sm text-surface-100 placeholder-surface-500 transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <p className="mt-1 text-xs text-surface-500">
              金銭の支出を伴わない稟議（規程変更等）の場合は空欄で構いません。
            </p>
          </div>

          {/* 説明・理由 */}
          <div>
            <label className="block text-sm font-medium text-surface-200">
              申請理由・詳細内容 <span className="text-rose-400">*</span>
            </label>
            <textarea
              required
              rows={6}
              value={formData.description}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, description: e.target.value }))
              }
              placeholder="申請の目的、必要性、選定理由、想定される効果などを詳細に記載してください。"
              className="mt-1.5 w-full rounded-lg border border-surface-700 bg-surface-800 p-3.5 text-sm text-surface-100 placeholder-surface-500 transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {/* 添付ファイル (任意) */}
          <div>
            <label className="block text-sm font-medium text-surface-200">
              添付ファイル (見積書・規程案・資料等、任意)
            </label>
            {uploadedFileName ? (
              <div className="mt-2 flex items-center justify-between rounded-lg border border-surface-700 bg-surface-800/80 p-3 text-sm">
                <div className="flex items-center gap-2 text-surface-200">
                  <Paperclip className="h-4 w-4 text-brand-400" />
                  <span>{uploadedFileName}</span>
                </div>
                <button
                  type="button"
                  onClick={handleRemoveAttachment}
                  className="rounded p-1 text-surface-400 hover:text-rose-400"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="mt-2 flex justify-center rounded-lg border-2 border-dashed border-surface-700 px-6 py-6 transition-colors hover:border-surface-600">
                <div className="text-center">
                  <UploadCloud className="mx-auto h-8 w-8 text-surface-400" />
                  <div className="mt-2 flex text-xs text-surface-400">
                    <label className="relative cursor-pointer rounded font-medium text-brand-400 hover:underline">
                      <span>ファイルを選択</span>
                      <input
                        type="file"
                        className="sr-only"
                        disabled={isUploading}
                        onChange={handleFileUpload}
                      />
                    </label>
                    <p className="pl-1">またはドラッグ＆ドロップ</p>
                  </div>
                  <p className="mt-1 text-xs text-surface-500">PDF, 画像, Word, Excel (最大 20MB)</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ボタンアクション */}
        <div className="mt-8 flex flex-col-reverse gap-3 border-t border-surface-800 pt-6 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={isSubmitting || isUploading}
            onClick={() => handleSubmit(false)}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-surface-700 bg-surface-800 px-5 py-2.5 text-sm font-medium text-surface-200 transition-colors hover:bg-surface-700 focus:outline-none focus:ring-2 focus:ring-surface-600 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            下書き保存
          </button>
          <button
            type="button"
            disabled={isSubmitting || isUploading}
            onClick={() => handleSubmit(true)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            保存して承認申請
          </button>
        </div>
      </div>
    </div>
  );
}
