import { Landmark, Link2, Sparkles, Upload, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';
import { useBankAccounts } from '../bank-accounts/hooks';
import { useAiSuggestions } from '../ai-suggestions/hooks';
import { useAccounts } from '../settings/accounts/hooks';
import { useBankTransactions, useImportBankTransactionsCsv, useMatchBankTransaction } from './hooks';
import { MATCH_STATUS_BADGE, MATCH_STATUS_LABEL } from './types';
import type { BankTransaction } from './types';

const amountFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

function ImportCsvModal({ bankAccountId, onClose }: { bankAccountId: string; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const importMutation = useImportBankTransactionsCsv();

  const handleSubmit = async (): Promise<void> => {
    if (!file) return;
    await importMutation.mutateAsync({ file, bank_account_id: bankAccountId });
    onClose();
  };

  return (
    <Modal title="銀行明細CSVを取込む" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-surface-400">
          ヘッダー行に取引日・摘要・入金額/出金額(または符号付き金額)・残高の列を含むCSVファイルを指定してください。
          同一口座・日付・金額・摘要の明細は重複として自動スキップされます。
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none file:mr-3 file:rounded-md file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-xs file:text-white"
        />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5"
            disabled={!file || importMutation.isPending}
            onClick={() => void handleSubmit()}
          >
            <Upload className="h-4 w-4" />
            {importMutation.isPending ? '取込中…' : '取込む'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function MatchModal({ transaction, onClose }: { transaction: BankTransaction; onClose: () => void }) {
  const matchMutation = useMatchBankTransaction();
  const { data: accountsData } = useAccounts({ page_size: 200 });
  const accounts = accountsData?.accounts ?? [];

  const suggestionsQuery = useAiSuggestions(
    { target_type: 'bank_transaction', target_id: transaction.id, accepted: undefined },
    { enabled: Boolean(transaction.id) },
  );
  const suggestions = (suggestionsQuery.data?.suggestions ?? []).filter((s) => s.target_id === transaction.id);

  const [manualTargetType, setManualTargetType] = useState<'journal_entry' | 'invoice' | 'vendor_bill'>(
    'journal_entry',
  );
  const [manualTargetId, setManualTargetId] = useState('');

  const runAutoMatch = async (): Promise<void> => {
    if (!transaction.id) return;
    const result = await matchMutation.mutateAsync({ id: transaction.id, dto: {} });
    if (result.match_status === 'unmatched') {
      void suggestionsQuery.refetch();
    } else {
      onClose();
    }
  };

  const applyAccountCode = async (code?: string): Promise<void> => {
    if (!transaction.id || !code) return;
    const account = accounts.find((a) => a.code === code);
    if (!account?.id) return;
    await matchMutation.mutateAsync({ id: transaction.id, dto: { account_id: account.id } });
    onClose();
  };

  const applyManualLink = async (): Promise<void> => {
    if (!transaction.id || !manualTargetId) return;
    await matchMutation.mutateAsync({
      id: transaction.id,
      dto: { target_type: manualTargetType, target_id: manualTargetId },
    });
    onClose();
  };

  return (
    <Modal title="銀行明細のマッチング" onClose={onClose}>
      <div className="space-y-5">
        <div className="rounded-lg border border-surface-800 bg-surface-900 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-surface-300">{transaction.transaction_date}</span>
            <span className={(transaction.amount ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {amountFormatter.format(transaction.amount ?? 0)}
            </span>
          </div>
          <p className="mt-1 text-xs text-surface-400">{transaction.description ?? '(摘要なし)'}</p>
        </div>

        <div>
          <button
            type="button"
            className="btn-primary flex w-full items-center justify-center gap-2"
            disabled={matchMutation.isPending}
            onClick={() => void runAutoMatch()}
          >
            <Wand2 className="h-4 w-4" />
            {matchMutation.isPending ? '評価中…' : '自動仕訳ルールを評価して消込'}
          </button>
          <p className="mt-1 text-xs text-surface-500">
            適合するルールがなければ、下記にAIによる勘定科目提案が表示されます。
          </p>
        </div>

        {suggestions.length > 0 && (
          <div className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-surface-300">
              <Sparkles className="h-3.5 w-3.5 text-brand-400" />
              AI提案(過去仕訳との類似度)
            </h3>
            {suggestions.map((s) =>
              (s.payload?.candidates ?? []).map((candidate) => (
                <div
                  key={`${s.id}-${candidate.code}`}
                  className="flex items-center justify-between rounded-lg border border-surface-800 bg-surface-900 px-3 py-2 text-sm"
                >
                  <div>
                    <span className="font-mono text-xs text-surface-400">{candidate.code}</span>{' '}
                    <span className="text-surface-100">{candidate.name}</span>
                    <span className="ml-2 text-xs text-surface-500">
                      類似度 {candidate.score !== undefined ? Math.round(candidate.score * 100) : '—'}%
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary !py-1 text-xs"
                    disabled={matchMutation.isPending}
                    onClick={() => void applyAccountCode(candidate.code)}
                  >
                    採用して消込
                  </button>
                </div>
              )),
            )}
          </div>
        )}

        <div className="space-y-2 border-t border-surface-800 pt-4">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-surface-300">
            <Link2 className="h-3.5 w-3.5" />
            既存レコードへ手動で紐付け
          </h3>
          <div className="flex gap-2">
            <select
              value={manualTargetType}
              onChange={(e) => setManualTargetType(e.target.value as typeof manualTargetType)}
              className="rounded-lg border border-surface-700 bg-surface-850 px-2 py-2 text-xs text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            >
              <option value="journal_entry">仕訳</option>
              <option value="invoice">売上請求書</option>
              <option value="vendor_bill">仕入請求書</option>
            </select>
            <input
              type="text"
              placeholder="対象ID(UUID)"
              value={manualTargetId}
              onChange={(e) => setManualTargetId(e.target.value)}
              className="flex-1 rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-xs text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            />
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={!manualTargetId || matchMutation.isPending}
              onClick={() => void applyManualLink()}
            >
              紐付け
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function BankTransactionListPage() {
  const { data: bankAccountsData } = useBankAccounts({ page_size: 200 });
  const bankAccounts = bankAccountsData?.bankAccounts ?? [];

  const [bankAccountId, setBankAccountId] = useState<string>('');
  const [matchStatusFilter, setMatchStatusFilter] = useState<string>('');
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [matchingTransaction, setMatchingTransaction] = useState<BankTransaction | null>(null);

  const selectedBankAccountId = bankAccountId || bankAccounts[0]?.id || '';

  const { data, isLoading } = useBankTransactions({
    bank_account_id: selectedBankAccountId || undefined,
    match_status: (matchStatusFilter || undefined) as BankTransaction['match_status'] | undefined,
    page_size: 100,
  });
  const transactions = data?.transactions ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-surface-50">
            <Landmark className="h-5 w-5 text-brand-400" />
            銀行明細
          </h1>
          <p className="mt-1 text-sm text-surface-400">銀行明細CSVの取込・自動仕訳ルールおよびAI提案による消込を行います。</p>
        </div>
        <button
          type="button"
          className="btn-primary flex items-center gap-1.5"
          disabled={!selectedBankAccountId}
          onClick={() => setImportModalOpen(true)}
        >
          <Upload className="h-4 w-4" />
          CSV取込
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">銀行口座</label>
          <select
            value={selectedBankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            className="rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          >
            {bankAccounts.length === 0 && <option value="">銀行口座が未登録です</option>}
            {bankAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.bank_name} {account.branch_name} ({account.account_number})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">消込状態</label>
          <select
            value={matchStatusFilter}
            onChange={(e) => setMatchStatusFilter(e.target.value)}
            className="rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="">すべて</option>
            {Object.entries(MATCH_STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading && <p className="text-sm text-surface-400">読み込み中…</p>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-4 py-3 font-medium">取引日</th>
              <th className="px-4 py-3 font-medium">摘要</th>
              <th className="px-4 py-3 font-medium text-right">金額</th>
              <th className="px-4 py-3 font-medium">状態</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-surface-500">
                  銀行明細がありません。CSVを取込んでください
                </td>
              </tr>
            )}
            {transactions.map((tx) => (
              <tr key={tx.id} className="border-b border-surface-800/60">
                <td className="px-4 py-3 text-surface-300">{tx.transaction_date}</td>
                <td className="px-4 py-3 text-surface-100">{tx.description ?? '—'}</td>
                <td
                  className={`px-4 py-3 text-right font-mono ${
                    (tx.amount ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {amountFormatter.format(tx.amount ?? 0)}
                </td>
                <td className="px-4 py-3">
                  <span className={tx.match_status ? MATCH_STATUS_BADGE[tx.match_status] : 'badge-draft'}>
                    {tx.match_status ? MATCH_STATUS_LABEL[tx.match_status] : '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {tx.match_status === 'unmatched' && (
                    <button
                      type="button"
                      className="btn-secondary !py-1 text-xs"
                      onClick={() => setMatchingTransaction(tx)}
                    >
                      マッチング
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {importModalOpen && selectedBankAccountId && (
        <ImportCsvModal bankAccountId={selectedBankAccountId} onClose={() => setImportModalOpen(false)} />
      )}

      {matchingTransaction && (
        <MatchModal transaction={matchingTransaction} onClose={() => setMatchingTransaction(null)} />
      )}
    </div>
  );
}
