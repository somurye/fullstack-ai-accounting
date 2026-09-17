import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  Edit,
  ExternalLink,
  FileCheck,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from '../../stores/toastStore';
import { StatusBadge } from './StatusBadge';
import { downloadQuotationPdf } from './api';
import {
  useAcceptQuotation,
  useConvertQuotation,
  useDeleteQuotation,
  useQuotation,
  useRejectQuotation,
  useReviseQuotation,
  useSendQuotation,
} from './hooks';

const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

export function QuotationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: quotation, isLoading, isError } = useQuotation(id);

  const sendMutation = useSendQuotation();
  const acceptMutation = useAcceptQuotation();
  const rejectMutation = useRejectQuotation();
  const reviseMutation = useReviseQuotation();
  const convertMutation = useConvertQuotation();
  const deleteMutation = useDeleteQuotation();

  const [isReviseModalOpen, setIsReviseModalOpen] = useState(false);
  const [reviseNotes, setReviseNotes] = useState('');
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  if (isLoading) {
    return <div className="p-8 text-center text-surface-400">読み込み中...</div>;
  }

  if (isError || !quotation) {
    return (
      <div className="p-8 text-center text-rose-400">
        指定された見積書が見つかりませんでした。
      </div>
    );
  }

  // PDFダウンロード
  const handleDownloadPdf = async () => {
    try {
      setIsDownloadingPdf(true);
      const filename = `quotation_${quotation.quote_no}_v${quotation.version}.pdf`;
      await downloadQuotationPdf(quotation.id, filename);
      toast.success('見積書PDFをダウンロードしました');
    } catch (e) {
      toast.error('PDFのダウンロードに失敗しました');
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  // 送付確定 (draft -> sent)
  const handleSend = async () => {
    if (!window.confirm('見積書を提示・送付確定しますか？\n確定後は金額・明細の直接編集ができなくなります。')) {
      return;
    }
    await sendMutation.mutateAsync(quotation.id);
  };

  // 受注確定 (sent -> accepted)
  const handleAccept = async () => {
    if (!window.confirm('この見積書を受注確定しますか？')) return;
    await acceptMutation.mutateAsync(quotation.id);
  };

  // 却下 (sent -> rejected)
  const handleReject = async () => {
    if (!window.confirm('この見積書を失注・却下としますか？')) return;
    await rejectMutation.mutateAsync(quotation.id);
  };

  // 改訂版発行 (Revise)
  const handleRevise = async () => {
    await reviseMutation.mutateAsync(
      { id: quotation.id, notes: reviseNotes.trim() || null },
      {
        onSuccess: (newQ) => {
          setIsReviseModalOpen(false);
          navigate(`/quotations/${newQ.id}`);
        },
      },
    );
  };

  // 受注転換 (accepted -> invoices 起票)
  const handleConvert = async () => {
    if (
      !window.confirm(
        'この見積書を受注転換し、売上請求書を下書き起票しますか？\n同一見積からの多重転換はできません。',
      )
    ) {
      return;
    }
    await convertMutation.mutateAsync(quotation.id);
  };

  // 削除 (draftのみ)
  const handleDelete = async () => {
    if (!window.confirm('下書き見積書を削除しますか？この操作は取り消せません。')) return;
    await deleteMutation.mutateAsync(quotation.id, {
      onSuccess: () => navigate('/quotations'),
    });
  };

  return (
    <div className="space-y-6">
      {/* ページ上部・アクションボタンバー */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/quotations"
            className="rounded-lg border border-surface-700 bg-surface-800 p-2 text-surface-400 hover:text-surface-200"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-surface-100">
                {quotation.quote_no}
              </h1>
              <span className="rounded bg-surface-800 px-2 py-0.5 text-xs font-semibold text-surface-300">
                v{quotation.version}
              </span>
              <StatusBadge
                status={quotation.status}
                isConverted={Boolean(quotation.converted_invoice_id)}
                convertedInvoiceNo={quotation.converted_invoice_no}
              />
            </div>
            <p className="mt-0.5 text-sm text-surface-400">{quotation.title}</p>
          </div>
        </div>

        {/* 各種アクションボタン */}
        <div className="flex flex-wrap items-center gap-2">
          {/* PDF出力 */}
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={isDownloadingPdf}
            className="inline-flex items-center gap-1.5 rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-xs font-medium text-surface-200 hover:bg-surface-700 disabled:opacity-50"
          >
            <Download className="h-4 w-4 text-surface-400" />
            {isDownloadingPdf ? '出力中...' : 'PDF出力'}
          </button>

          {/* 下書き状態のアクション */}
          {quotation.status === 'draft' && (
            <>
              <Link
                to={`/quotations/${quotation.id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-xs font-medium text-surface-200 hover:bg-surface-700"
              >
                <Edit className="h-4 w-4 text-surface-400" />
                編集
              </Link>
              <button
                type="button"
                onClick={handleSend}
                disabled={sendMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {sendMutation.isPending ? '送信中...' : '提示・確定送付'}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-900 bg-rose-950/40 px-3 py-2 text-xs font-medium text-rose-400 hover:bg-rose-900/60 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                削除
              </button>
            </>
          )}

          {/* 提示済 (sent) 状態のアクション */}
          {quotation.status === 'sent' && (
            <>
              <button
                type="button"
                onClick={() => setIsReviseModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-xs font-medium text-amber-300 hover:bg-surface-700"
              >
                <Copy className="h-4 w-4" />
                改訂版を発行
              </button>
              <button
                type="button"
                onClick={handleAccept}
                disabled={acceptMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                受注確定
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={rejectMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-800 bg-rose-950/50 px-3 py-2 text-xs font-medium text-rose-400 hover:bg-rose-900/60 disabled:opacity-50"
              >
                <XCircle className="h-4 w-4" />
                失注・却下
              </button>
            </>
          )}

          {/* 受注確定 (accepted) 状態のアクション */}
          {quotation.status === 'accepted' && (
            <>
              {!quotation.converted_invoice_id ? (
                <button
                  type="button"
                  onClick={handleConvert}
                  disabled={convertMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
                >
                  <FileCheck className="h-4 w-4" />
                  {convertMutation.isPending ? '転換中...' : '受注転換 (請求書起票)'}
                </button>
              ) : (
                <Link
                  to={`/invoices`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-700 bg-indigo-950/60 px-3 py-2 text-xs font-medium text-indigo-300 hover:bg-indigo-900/60"
                >
                  <ExternalLink className="h-4 w-4" />
                  転換先請求書 ({quotation.converted_invoice_no || '開く'})
                </Link>
              )}
              {!quotation.superseded_by && (
                <button
                  type="button"
                  onClick={() => setIsReviseModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-surface-700 bg-surface-800 px-3 py-2 text-xs font-medium text-surface-300 hover:bg-surface-700"
                >
                  <Copy className="h-4 w-4" />
                  再改訂版発行
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* 改訂履歴・リンクバナー */}
      {quotation.superseded_by && (
        <div className="flex items-center justify-between rounded-xl border border-amber-800 bg-amber-950/40 p-4 text-sm text-amber-200">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-400" />
            <span>この見積書は改訂されています。最新バージョンをご確認ください。</span>
          </div>
          <Link
            to={`/quotations/${quotation.superseded_by}`}
            className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500"
          >
            新バージョンへ移動
          </Link>
        </div>
      )}

      {/* 受注転換済みバナー */}
      {quotation.converted_invoice_id && (
        <div className="flex items-center justify-between rounded-xl border border-indigo-800 bg-indigo-950/40 p-4 text-sm text-indigo-200">
          <div className="flex items-center gap-2">
            <FileCheck className="h-5 w-5 text-indigo-400" />
            <span>
              この見積書は受注転換され、売上請求書 (
              <span className="font-semibold text-white">{quotation.converted_invoice_no}</span>
              ) が起票されています。
            </span>
          </div>
          <Link
            to={`/invoices`}
            className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500"
          >
            請求書一覧で確認
          </Link>
        </div>
      )}

      {/* 基本情報グリッド */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="rounded-xl border border-surface-800 bg-surface-900 p-5 space-y-4 md:col-span-2">
          <h2 className="text-sm font-semibold text-surface-200 border-b border-surface-800 pb-2">
            見積基本情報
          </h2>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-surface-400">宛先 (顧客)</span>
              <p className="mt-1 font-medium text-surface-100 text-sm">
                {quotation.customer_name ?? '—'}
                {quotation.customer_code && (
                  <span className="ml-1 text-xs text-surface-400">({quotation.customer_code})</span>
                )}
              </p>
            </div>
            <div>
              <span className="text-surface-400">発行者</span>
              <p className="mt-1 font-medium text-surface-200">
                {quotation.creator_name ?? 'システム管理者'}
              </p>
            </div>
            <div>
              <span className="text-surface-400">発行日</span>
              <p className="mt-1 font-medium text-surface-200">{quotation.issue_date}</p>
            </div>
            <div>
              <span className="text-surface-400">有効期限</span>
              <p className="mt-1 font-medium text-surface-200">
                {quotation.valid_until ?? '未指定'}
              </p>
            </div>
            {quotation.notes && (
              <div className="col-span-2">
                <span className="text-surface-400">備考</span>
                <p className="mt-1 whitespace-pre-wrap rounded-lg bg-surface-800/60 p-3 text-surface-200">
                  {quotation.notes}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 金額サマリーカード */}
        <div className="rounded-xl border border-surface-800 bg-surface-900 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-surface-200 border-b border-surface-800 pb-2">
            見積金額合計
          </h2>
          <div className="space-y-3 text-xs">
            <div className="flex justify-between text-surface-400">
              <span>小計 (税抜)</span>
              <span className="font-semibold text-surface-200">
                {currencyFormatter.format(quotation.subtotal)}
              </span>
            </div>
            <div className="flex justify-between text-surface-400">
              <span>消費税額</span>
              <span className="font-semibold text-surface-200">
                {currencyFormatter.format(quotation.tax_amount)}
              </span>
            </div>
            <div className="border-t border-surface-800 pt-3 flex justify-between text-sm font-bold text-indigo-300">
              <span>税込合計</span>
              <span className="text-base">{currencyFormatter.format(quotation.total_amount)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 明細テーブル */}
      <div className="rounded-xl border border-surface-800 bg-surface-900 overflow-hidden shadow-sm">
        <div className="border-b border-surface-800 px-5 py-3 bg-surface-950/40">
          <h2 className="text-sm font-semibold text-surface-200">見積明細</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-surface-800 text-xs uppercase text-surface-400">
              <tr>
                <th className="px-5 py-3 w-12">#</th>
                <th className="px-5 py-3 min-w-[200px]">品名</th>
                <th className="px-5 py-3 min-w-[150px]">詳細・摘要</th>
                <th className="px-5 py-3 text-right">数量</th>
                <th className="px-5 py-3">単位</th>
                <th className="px-5 py-3 text-right">単価</th>
                <th className="px-5 py-3">税率</th>
                <th className="px-5 py-3 text-right">金額 (税抜)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-800">
              {quotation.lines.map((line) => (
                <tr key={line.id} className="hover:bg-surface-800/30">
                  <td className="px-5 py-3 text-xs text-surface-500">{line.line_no}</td>
                  <td className="px-5 py-3 font-medium text-surface-100">{line.item_name}</td>
                  <td className="px-5 py-3 text-surface-400 text-xs">{line.description || '—'}</td>
                  <td className="px-5 py-3 text-right text-surface-200">{line.quantity}</td>
                  <td className="px-5 py-3 text-surface-400 text-xs">{line.unit}</td>
                  <td className="px-5 py-3 text-right text-surface-200">
                    {currencyFormatter.format(line.unit_price)}
                  </td>
                  <td className="px-5 py-3 text-xs text-surface-400">
                    {Math.round(line.tax_rate * 100)}%
                  </td>
                  <td className="px-5 py-3 text-right font-semibold text-surface-100">
                    {currencyFormatter.format(line.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 改訂版発行モーダル */}
      {isReviseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-surface-700 bg-surface-900 p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-surface-100">改訂版見積書の発行</h3>
            <p className="text-xs text-surface-400">
              現在の見積内容をコピーして新しいバージョン (v{quotation.version + 1}) の下書きを発行します。
              元の見積書 (v{quotation.version}) は保持されます。
            </p>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-surface-300">改訂理由・備考</label>
              <textarea
                rows={3}
                placeholder="例: クライアントからの仕様変更要請に伴う数量見直し"
                value={reviseNotes}
                onChange={(e) => setReviseNotes(e.target.value)}
                className="w-full rounded-lg border border-surface-700 bg-surface-800 p-2.5 text-xs text-surface-100 placeholder-surface-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsReviseModalOpen(false)}
                className="rounded-lg border border-surface-700 px-3 py-1.5 text-xs font-medium text-surface-300 hover:bg-surface-800"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleRevise}
                disabled={reviseMutation.isPending}
                className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
              >
                {reviseMutation.isPending ? '発行中...' : '改訂版を発行'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
