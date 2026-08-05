import { Calculator, CheckCircle2, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useFiscalYears } from '../fiscal-periods/hooks';
import {
  useConsumptionTaxReturn,
  useConsumptionTaxReturns,
  useCreateConsumptionTaxReturn,
  useFinalizeConsumptionTaxReturn,
  useRecalculateConsumptionTaxReturn,
} from './hooks';
import { TAX_FILING_METHOD_LABEL, type TaxFilingMethod } from './types';

const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

function statusBadgeClass(status?: string): string {
  return status === 'finalized' ? 'badge-posted' : 'badge-draft';
}

export function ConsumptionTaxReturnsPage() {
  const [fiscalYearId, setFiscalYearId] = useState('');
  const [filingMethod, setFilingMethod] = useState<TaxFilingMethod>('twenty_percent_special');
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const { data: fiscalYears = [] } = useFiscalYears();
  const { data, isLoading } = useConsumptionTaxReturns({ page_size: 50 });
  const { data: selected } = useConsumptionTaxReturn(selectedId);

  const createMutation = useCreateConsumptionTaxReturn();
  const recalcMutation = useRecalculateConsumptionTaxReturn();
  const finalizeMutation = useFinalizeConsumptionTaxReturn();

  const returns = data?.returns ?? [];

  const filingMethodOptions = useMemo(
    () => Object.entries(TAX_FILING_METHOD_LABEL) as [TaxFilingMethod, string][],
    [],
  );

  const handleCreate = async (): Promise<void> => {
    if (!fiscalYearId) return;
    const created = await createMutation.mutateAsync({ fiscal_year_id: fiscalYearId, filing_method: filingMethod });
    setSelectedId(created.id);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-surface-50">消費税申告サポート</h1>
        <p className="mt-1 text-sm text-surface-400">
          課税方式(本則/簡易/2割特例)を選択して税額を計算し、申告データを確定します。
        </p>
      </div>

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">会計年度</label>
          <select
            value={fiscalYearId}
            onChange={(e) => setFiscalYearId(e.target.value)}
            className="rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="">選択してください</option>
            {fiscalYears.map((fy) => (
              <option key={fy.id} value={fy.id}>
                {fy.start_date} 〜 {fy.end_date}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">課税方式</label>
          <select
            value={filingMethod}
            onChange={(e) => setFilingMethod(e.target.value as TaxFilingMethod)}
            className="rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          >
            {filingMethodOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={!fiscalYearId || createMutation.isPending}
          onClick={() => void handleCreate()}
        >
          <Calculator className="h-4 w-4" />
          {createMutation.isPending ? '計算中…' : '計算を実行'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="card overflow-x-auto lg:col-span-2">
          <div className="border-b border-surface-800 px-5 py-3">
            <h2 className="text-sm font-semibold text-surface-100">申告データ一覧</h2>
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
                <th className="px-3 py-2 font-medium">課税方式</th>
                <th className="px-3 py-2 text-right font-medium">納税額</th>
                <th className="px-3 py-2 font-medium">状態</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-surface-500">
                    読み込み中…
                  </td>
                </tr>
              )}
              {!isLoading && returns.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-surface-500">
                    申告データはまだありません
                  </td>
                </tr>
              )}
              {returns.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={`cursor-pointer border-b border-surface-800/60 hover:bg-surface-850/60 ${
                    selectedId === r.id ? 'bg-surface-850/80' : ''
                  }`}
                >
                  <td className="px-3 py-2 text-surface-200">
                    {r.filing_method ? TAX_FILING_METHOD_LABEL[r.filing_method] : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-surface-200">
                    {currencyFormatter.format(r.tax_due_amount ?? 0)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={statusBadgeClass(r.status)}>
                      {r.status === 'finalized' ? '確定済み' : '下書き'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card p-5 lg:col-span-3">
          {!selected && <p className="text-sm text-surface-500">左の一覧から申告データを選択してください</p>}
          {selected && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-surface-100">
                  {selected.filing_method ? TAX_FILING_METHOD_LABEL[selected.filing_method] : '—'}
                </h2>
                <span className={statusBadgeClass(selected.status)}>
                  {selected.status === 'finalized' ? '確定済み' : '下書き'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-xs font-medium text-surface-500">課税売上高</p>
                  <p className="mt-1 tabular-nums text-surface-100">
                    {currencyFormatter.format(selected.taxable_sales_amount ?? 0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-surface-500">課税仕入高</p>
                  <p className="mt-1 tabular-nums text-surface-100">
                    {currencyFormatter.format(selected.taxable_purchase_amount ?? 0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-surface-500">納付税額</p>
                  <p className="mt-1 tabular-nums text-lg font-semibold text-surface-50">
                    {currencyFormatter.format(selected.tax_due_amount ?? 0)}
                  </p>
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-500">
                  区分別内訳
                </h3>
                <table className="w-full text-left text-sm">
                  <tbody>
                    {(selected.lines ?? []).length === 0 && (
                      <tr>
                        <td className="py-2 text-surface-500">内訳データがありません</td>
                      </tr>
                    )}
                    {(selected.lines ?? []).map((line) => (
                      <tr key={line.id} className="border-b border-surface-800/60">
                        <td className="py-2 text-surface-300">{line.category}</td>
                        <td className="py-2 text-right tabular-nums text-surface-100">
                          {currencyFormatter.format(line.amount ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selected.status === 'draft' && (
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={recalcMutation.isPending}
                    onClick={() => selected.id && recalcMutation.mutate(selected.id)}
                  >
                    <RefreshCw className="h-4 w-4" />
                    再計算
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={finalizeMutation.isPending}
                    onClick={() => selected.id && finalizeMutation.mutate(selected.id)}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    確定する
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
