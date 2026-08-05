import { useMemo, useState } from 'react';
import { useFiscalPeriods, useFiscalYears } from '../fiscal-periods/hooks';
import { useBs, useCashFlow, usePl, useTrialBalance } from './hooks';

const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

type Tab = 'trial-balance' | 'pl' | 'bs' | 'cash-flow';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ReportsPage() {
  const [tab, setTab] = useState<Tab>('trial-balance');
  const [fiscalPeriodId, setFiscalPeriodId] = useState('');
  const [fiscalYearId, setFiscalYearId] = useState('');
  const [asOfDate, setAsOfDate] = useState(todayIso());

  const { data: fiscalYears = [] } = useFiscalYears();
  const { data: fiscalPeriods = [] } = useFiscalPeriods();

  const trialBalanceQuery = useTrialBalance({ fiscal_period_id: fiscalPeriodId || undefined });
  const plQuery = usePl({ fiscal_year_id: fiscalYearId || undefined });
  const bsQuery = useBs({ as_of_date: asOfDate });
  const cashFlowQuery = useCashFlow({ fiscal_year_id: fiscalYearId || undefined });

  const tbLines = trialBalanceQuery.data ?? [];
  const tbTotals = useMemo(
    () => ({
      debit: tbLines.reduce((sum, l) => sum + (l.debit_total ?? 0), 0),
      credit: tbLines.reduce((sum, l) => sum + (l.credit_total ?? 0), 0),
    }),
    [tbLines],
  );

  const bsLines = bsQuery.data?.lines ?? [];
  const bsSummary = useMemo(() => {
    const find = (name: string) => bsLines.find((l) => l.account_name === name)?.amount ?? 0;
    const totalAssets = find('資産合計');
    const totalLiabilities = find('負債合計');
    const totalEquity = find('純資産合計');
    return { totalAssets, totalLiabilities, totalEquity, balanced: totalAssets === totalLiabilities + totalEquity };
  }, [bsLines]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-surface-50">試算表・財務三表</h1>
        <p className="mt-1 text-sm text-surface-400">確定済み仕訳(posted)に基づくリアルタイム集計です。</p>
      </div>

      <div className="flex gap-2 border-b border-surface-800">
        {(
          [
            ['trial-balance', '試算表'],
            ['pl', '損益計算書(PL)'],
            ['bs', '貸借対照表(BS)'],
            ['cash-flow', 'キャッシュ・フロー計算書(CF)'],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === value
                ? 'border-brand-400 text-brand-300'
                : 'border-transparent text-surface-400 hover:text-surface-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'trial-balance' && (
        <div className="space-y-4">
          <div className="card flex flex-wrap items-end gap-3 p-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-surface-400">会計期間</label>
              <select
                value={fiscalPeriodId}
                onChange={(e) => setFiscalPeriodId(e.target.value)}
                className="rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
              >
                <option value="">選択してください</option>
                {fiscalPeriods.map((p) => (
                  <option key={p.id} value={p.id}>
                    第{p.period_no}期({p.start_date} 〜 {p.end_date})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
                  <th className="px-4 py-3 font-medium">科目コード</th>
                  <th className="px-4 py-3 font-medium">科目名</th>
                  <th className="px-4 py-3 text-right font-medium">期首残高</th>
                  <th className="px-4 py-3 text-right font-medium">借方合計</th>
                  <th className="px-4 py-3 text-right font-medium">貸方合計</th>
                  <th className="px-4 py-3 text-right font-medium">期末残高</th>
                </tr>
              </thead>
              <tbody>
                {!fiscalPeriodId && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-surface-500">
                      会計期間を選択してください
                    </td>
                  </tr>
                )}
                {fiscalPeriodId && tbLines.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-surface-500">
                      データがありません
                    </td>
                  </tr>
                )}
                {tbLines.map((line) => (
                  <tr key={line.account_id} className="border-b border-surface-800/60">
                    <td className="px-4 py-3 font-mono text-xs text-surface-300">{line.account_code}</td>
                    <td className="px-4 py-3 text-surface-200">{line.account_name}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-surface-300">
                      {currencyFormatter.format(line.opening_balance ?? 0)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-surface-300">
                      {currencyFormatter.format(line.debit_total ?? 0)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-surface-300">
                      {currencyFormatter.format(line.credit_total ?? 0)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-surface-100">
                      {currencyFormatter.format(line.closing_balance ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {tbLines.length > 0 && (
                <tfoot>
                  <tr className="border-t border-surface-800 text-sm font-semibold">
                    <td className="px-4 py-3 text-surface-300" colSpan={3}>
                      合計(貸借一致確認)
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-surface-100">
                      {currencyFormatter.format(tbTotals.debit)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-surface-100">
                      {currencyFormatter.format(tbTotals.credit)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={tbTotals.debit === tbTotals.credit ? 'badge-posted' : 'badge-rejected'}>
                        {tbTotals.debit === tbTotals.credit ? '一致' : '不一致'}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {tab === 'pl' && (
        <div className="space-y-4">
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
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead>
                <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
                  <th className="px-4 py-3 font-medium">区分</th>
                  <th className="px-4 py-3 font-medium">科目</th>
                  <th className="px-4 py-3 text-right font-medium">金額</th>
                </tr>
              </thead>
              <tbody>
                {!fiscalYearId && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-surface-500">
                      会計年度を選択してください
                    </td>
                  </tr>
                )}
                {(plQuery.data?.lines ?? []).map((line, i) => (
                  <tr
                    key={`${line.account_code}-${i}`}
                    className={`border-b border-surface-800/60 ${line.section === '集計' ? 'font-semibold' : ''}`}
                  >
                    <td className="px-4 py-3 text-surface-400">{line.section}</td>
                    <td className="px-4 py-3 text-surface-200">{line.account_name}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-surface-100">
                      {currencyFormatter.format(line.amount ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'bs' && (
        <div className="space-y-4">
          <div className="card flex flex-wrap items-end gap-3 p-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-surface-400">基準日</label>
              <input
                type="date"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                className="rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
              />
            </div>
            <div className="ml-auto text-sm">
              <span className={bsSummary.balanced ? 'badge-posted' : 'badge-rejected'}>
                {bsSummary.balanced ? '貸借一致' : '貸借不一致'}
              </span>
            </div>
          </div>

          <div className="card grid grid-cols-3 gap-4 p-5 text-sm">
            <div>
              <p className="text-xs font-medium text-surface-500">資産合計</p>
              <p className="mt-1 tabular-nums text-lg font-semibold text-surface-50">
                {currencyFormatter.format(bsSummary.totalAssets)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-surface-500">負債合計</p>
              <p className="mt-1 tabular-nums text-lg font-semibold text-surface-50">
                {currencyFormatter.format(bsSummary.totalLiabilities)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-surface-500">純資産合計</p>
              <p className="mt-1 tabular-nums text-lg font-semibold text-surface-50">
                {currencyFormatter.format(bsSummary.totalEquity)}
              </p>
            </div>
          </div>

          <div className="card overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead>
                <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
                  <th className="px-4 py-3 font-medium">区分</th>
                  <th className="px-4 py-3 font-medium">科目</th>
                  <th className="px-4 py-3 text-right font-medium">金額</th>
                </tr>
              </thead>
              <tbody>
                {bsLines.map((line, i) => (
                  <tr
                    key={`${line.account_code}-${i}`}
                    className={`border-b border-surface-800/60 ${line.section === '集計' ? 'font-semibold' : ''}`}
                  >
                    <td className="px-4 py-3 text-surface-400">{line.section}</td>
                    <td className="px-4 py-3 text-surface-200">{line.account_name}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-surface-100">
                      {currencyFormatter.format(line.amount ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'cash-flow' && (
        <div className="space-y-4">
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
          </div>

          {!fiscalYearId && (
            <div className="card p-8 text-center text-sm text-surface-500">会計年度を選択してください</div>
          )}

          {fiscalYearId && cashFlowQuery.data && (
            <>
              <div className="card grid grid-cols-2 gap-4 p-5 text-sm sm:grid-cols-5">
                <div>
                  <p className="text-xs font-medium text-surface-500">期首残高</p>
                  <p className="mt-1 tabular-nums text-lg font-semibold text-surface-50">
                    {currencyFormatter.format(cashFlowQuery.data.beginning_cash_balance ?? 0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-surface-500">営業活動</p>
                  <p className="mt-1 tabular-nums text-lg font-semibold text-surface-50">
                    {currencyFormatter.format(cashFlowQuery.data.operating_activities_total ?? 0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-surface-500">投資活動</p>
                  <p className="mt-1 tabular-nums text-lg font-semibold text-surface-50">
                    {currencyFormatter.format(cashFlowQuery.data.investing_activities_total ?? 0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-surface-500">財務活動</p>
                  <p className="mt-1 tabular-nums text-lg font-semibold text-surface-50">
                    {currencyFormatter.format(cashFlowQuery.data.financing_activities_total ?? 0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-surface-500">期末残高</p>
                  <p className="mt-1 tabular-nums text-lg font-semibold text-brand-300">
                    {currencyFormatter.format(cashFlowQuery.data.ending_cash_balance ?? 0)}
                  </p>
                </div>
              </div>

              {(
                [
                  ['営業活動によるキャッシュフロー', cashFlowQuery.data.operating_activities ?? []],
                  ['投資活動によるキャッシュフロー', cashFlowQuery.data.investing_activities ?? []],
                  ['財務活動によるキャッシュフロー', cashFlowQuery.data.financing_activities ?? []],
                ] as [string, typeof cashFlowQuery.data.operating_activities][]
              ).map(([label, lines]) => (
                <div key={label} className="card overflow-x-auto">
                  <h2 className="border-b border-surface-800 px-4 py-3 text-sm font-semibold text-surface-100">
                    {label}
                  </h2>
                  <table className="w-full min-w-[500px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
                        <th className="px-4 py-2 font-medium">科目コード</th>
                        <th className="px-4 py-2 font-medium">科目名</th>
                        <th className="px-4 py-2 text-right font-medium">金額</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(lines ?? []).length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-4 py-4 text-center text-surface-500">
                            該当する取引はありません
                          </td>
                        </tr>
                      )}
                      {(lines ?? []).map((line, i) => (
                        <tr key={`${line.account_code}-${i}`} className="border-b border-surface-800/60">
                          <td className="px-4 py-2 font-mono text-xs text-surface-300">{line.account_code}</td>
                          <td className="px-4 py-2 text-surface-200">{line.account_name}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-surface-100">
                            {currencyFormatter.format(line.amount ?? 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
