import { CheckCircle2, UserCog, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePayrollImportMappings, useImportPayrollCsv, usePayrollImports, usePostPayrollImport } from './hooks';
import type { PayrollImport } from './types';

const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

const STATUS_LABEL: Record<string, string> = { imported: '取込済(未確定)', posted: '確定済' };
const STATUS_BADGE: Record<string, string> = { imported: 'badge-draft', posted: 'badge-posted' };

function computeTotals(record: PayrollImport) {
  const lines = record.lines ?? [];
  const debit = lines.reduce(
    (sum, l) => sum + (l.executive_compensation_amount ?? 0) + (l.salary_amount ?? 0) + (l.social_insurance_company_amount ?? 0),
    0,
  );
  const credit = lines.reduce(
    (sum, l) =>
      sum +
      (l.withholding_tax_amount ?? 0) +
      (l.resident_tax_amount ?? 0) +
      (l.social_insurance_employee_amount ?? 0) +
      (l.social_insurance_company_amount ?? 0) +
      (l.net_payment_amount ?? 0),
    0,
  );
  return { debit, credit };
}

function ImportResultPanel({
  record,
  onPosted,
}: {
  record: PayrollImport;
  onPosted: (updated: PayrollImport) => void;
}) {
  const postMutation = usePostPayrollImport();
  const { debit, credit } = computeTotals(record);
  const balanced = Math.round(debit) === Math.round(credit);

  return (
    <div className="card space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-surface-100">
            {record.pay_period_start} 〜 {record.pay_period_end}(支給日: {record.payment_date})
          </p>
          <p className="mt-1 text-xs text-surface-400">従業員 {record.lines?.length ?? 0}名分を取込みました</p>
        </div>
        <span className={record.status ? STATUS_BADGE[record.status] : 'badge-draft'}>
          {record.status ? STATUS_LABEL[record.status] : '—'}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-surface-800">
        <table className="w-full min-w-[700px] text-left text-xs">
          <thead>
            <tr className="border-b border-surface-800 text-surface-500">
              <th className="px-3 py-2 font-medium">従業員</th>
              <th className="px-3 py-2 text-right font-medium">役員報酬</th>
              <th className="px-3 py-2 text-right font-medium">給料手当</th>
              <th className="px-3 py-2 text-right font-medium">源泉所得税</th>
              <th className="px-3 py-2 text-right font-medium">住民税</th>
              <th className="px-3 py-2 text-right font-medium">社保(本人)</th>
              <th className="px-3 py-2 text-right font-medium">社保(会社)</th>
              <th className="px-3 py-2 text-right font-medium">差引支給額</th>
            </tr>
          </thead>
          <tbody>
            {(record.lines ?? []).map((line) => (
              <tr key={line.id} className="border-b border-surface-800/60 text-surface-200">
                <td className="px-3 py-2">
                  {line.employee_name}
                  {line.employee_code && <span className="ml-1 text-surface-500">({line.employee_code})</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{currencyFormatter.format(line.executive_compensation_amount ?? 0)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{currencyFormatter.format(line.salary_amount ?? 0)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{currencyFormatter.format(line.withholding_tax_amount ?? 0)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{currencyFormatter.format(line.resident_tax_amount ?? 0)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{currencyFormatter.format(line.social_insurance_employee_amount ?? 0)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{currencyFormatter.format(line.social_insurance_company_amount ?? 0)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{currencyFormatter.format(line.net_payment_amount ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-surface-800 bg-surface-900 px-4 py-3 text-sm">
        <div className="flex items-center gap-2">
          {balanced ? (
            <CheckCircle2 className="h-4 w-4 text-positive" />
          ) : (
            <span className="h-4 w-4 rounded-full bg-negative" />
          )}
          <span className={balanced ? 'text-positive' : 'text-negative'}>
            {balanced ? '貸借一致(複合仕訳は自動的に貸借バランスします)' : '貸借不一致'}
          </span>
        </div>
        <div className="text-xs text-surface-400">
          借方合計 {currencyFormatter.format(debit)} / 貸方合計 {currencyFormatter.format(credit)}
        </div>
      </div>

      {record.status === 'imported' && (
        <div className="flex justify-end">
          <button
            type="button"
            className="btn-primary"
            disabled={postMutation.isPending}
            onClick={() => record.id && postMutation.mutate(record.id, { onSuccess: onPosted })}
          >
            {postMutation.isPending ? '確定中…' : '仕訳を確定する'}
          </button>
        </div>
      )}
    </div>
  );
}

export function PayrollImportPage() {
  const { data: mappingsData } = usePayrollImportMappings({ page_size: 200, is_active: true });
  const mappings = mappingsData?.mappings ?? [];

  const { data: importsData, isLoading } = usePayrollImports({ page_size: 20 });
  const imports = importsData?.imports ?? [];

  const importMutation = useImportPayrollCsv();

  const [mappingId, setMappingId] = useState('');
  const [payPeriodStart, setPayPeriodStart] = useState('');
  const [payPeriodEnd, setPayPeriodEnd] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [lastResult, setLastResult] = useState<PayrollImport | null>(null);

  const canSubmit = mappingId && payPeriodStart && payPeriodEnd && paymentDate && file;

  const handleSubmit = async (): Promise<void> => {
    if (!file || !mappingId || !payPeriodStart || !payPeriodEnd || !paymentDate) return;
    const result = await importMutation.mutateAsync({
      file,
      import_mapping_id: mappingId,
      pay_period_start: payPeriodStart,
      pay_period_end: payPeriodEnd,
      payment_date: paymentDate,
    });
    setLastResult(result);
    setFile(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-surface-50">
            <UserCog className="h-5 w-5 text-brand-400" />
            給与インポート
          </h1>
          <p className="mt-1 text-sm text-surface-400">
            給与ソフトCSVを取込み、役員報酬・給料手当・各種預り金・法定福利費の複合仕訳を自動生成します。
          </p>
        </div>
        <Link to="/payroll-import-mappings" className="btn-secondary">
          マッピング設定
        </Link>
      </div>

      <div className="card space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">マッピング設定</label>
            <select
              value={mappingId}
              onChange={(e) => setMappingId(e.target.value)}
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            >
              <option value="">選択してください</option>
              {mappings.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">給与期間(開始)</label>
            <input
              type="date"
              value={payPeriodStart}
              onChange={(e) => setPayPeriodStart(e.target.value)}
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">給与期間(終了)</label>
            <input
              type="date"
              value={payPeriodEnd}
              onChange={(e) => setPayPeriodEnd(e.target.value)}
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-surface-400">支給日</label>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">給与CSVファイル</label>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none file:mr-3 file:rounded-md file:border-0 file:bg-brand-600 file:px-3 file:py-1.5 file:text-xs file:text-white"
          />
        </div>

        {mappings.length === 0 && (
          <p className="text-xs text-surface-500">
            有効なマッピング設定がありません。先に「マッピング設定」から作成してください。
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5"
            disabled={!canSubmit || importMutation.isPending}
            onClick={() => void handleSubmit()}
          >
            <Upload className="h-4 w-4" />
            {importMutation.isPending ? '取込中…' : '取込む'}
          </button>
        </div>
      </div>

      {lastResult && <ImportResultPanel record={lastResult} onPosted={setLastResult} />}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-surface-300">取込履歴</h2>
        {isLoading && <p className="text-sm text-surface-400">読み込み中…</p>}
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead>
              <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
                <th className="px-4 py-3 font-medium">給与期間</th>
                <th className="px-4 py-3 font-medium">支給日</th>
                <th className="px-4 py-3 font-medium">対象人数</th>
                <th className="px-4 py-3 font-medium">状態</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {imports.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-surface-500">
                    給与インポート履歴がありません
                  </td>
                </tr>
              )}
              {imports.map((record) => (
                <tr key={record.id} className="border-b border-surface-800/60">
                  <td className="px-4 py-3 text-surface-300">
                    {record.pay_period_start} 〜 {record.pay_period_end}
                  </td>
                  <td className="px-4 py-3 text-surface-300">{record.payment_date}</td>
                  <td className="px-4 py-3 text-surface-300">{record.lines?.length ?? 0}名</td>
                  <td className="px-4 py-3">
                    <span className={record.status ? STATUS_BADGE[record.status] : 'badge-draft'}>
                      {record.status ? STATUS_LABEL[record.status] : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="btn-secondary !py-1 text-xs"
                      onClick={() => setLastResult(record)}
                    >
                      詳細
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
