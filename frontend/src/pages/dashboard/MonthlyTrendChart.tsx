import type { DashboardMonthlyTrend } from './types';

interface MonthlyTrendChartProps {
  data: DashboardMonthlyTrend[];
}

const WIDTH = 960;
const HEIGHT = 300;
const MARGIN = { top: 16, right: 16, bottom: 28, left: 64 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const GRID_LINES = 4;

const compactYen = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  notation: 'compact',
  maximumFractionDigits: 1,
});

function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `${y.slice(2)}/${m}`;
}

/**
 * 月次売上・費用(棒グラフ)と純利益(折れ線)を1枚のSVGで描画する軽量チャート。
 * 外部チャートライブラリ(recharts等)には依存せず、既存コードベースの
 * 「必要最小限の依存関係で完結させる」方針(ORM不使用・生SQL駆動と同じ思想)に合わせる。
 * 純利益は赤字月がありうるため、0を跨ぐ共有スケールを明示的に計算する。
 */
export function MonthlyTrendChart({ data }: MonthlyTrendChartProps) {
  if (data.length === 0) {
    return <div className="flex h-72 items-center justify-center text-sm text-surface-500">データがありません</div>;
  }

  const allValues = data.flatMap((d) => [d.revenue ?? 0, d.expense ?? 0, d.net_income ?? 0]);
  const maxValue = Math.max(0, ...allValues);
  const minValue = Math.min(0, ...allValues);
  const range = maxValue - minValue || 1;

  const yFor = (value: number): number => PLOT_HEIGHT - ((value - minValue) / range) * PLOT_HEIGHT;
  const zeroY = yFor(0);

  const monthSlot = PLOT_WIDTH / data.length;
  const barWidth = Math.min(22, monthSlot * 0.3);
  const barGap = barWidth * 0.15;

  const gridValues = Array.from({ length: GRID_LINES + 1 }, (_, i) => minValue + (range * i) / GRID_LINES);

  const linePoints = data
    .map((d, i) => {
      const x = monthSlot * i + monthSlot / 2;
      const y = yFor(d.net_income ?? 0);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className="w-full">
      <div className="mb-3 flex items-center gap-4 text-xs text-surface-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-info" />
          売上高
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-negative" />
          費用
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-positive" />
          純利益
        </span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="h-72 w-full">
        <g transform={`translate(${MARGIN.left}, ${MARGIN.top})`}>
          {gridValues.map((value) => (
            <g key={value}>
              <line
                x1={0}
                x2={PLOT_WIDTH}
                y1={yFor(value)}
                y2={yFor(value)}
                stroke="#2a2e35"
                strokeWidth={1}
                strokeDasharray={value === 0 ? undefined : '3 3'}
              />
              <text x={-8} y={yFor(value)} textAnchor="end" dominantBaseline="middle" className="fill-surface-500 text-[10px]">
                {compactYen.format(value)}
              </text>
            </g>
          ))}

          {data.map((d, i) => {
            const groupX = monthSlot * i + monthSlot / 2;
            const revenueX = groupX - barWidth - barGap / 2;
            const expenseX = groupX + barGap / 2;
            const revenue = d.revenue ?? 0;
            const expense = d.expense ?? 0;
            const revenueY = Math.min(yFor(revenue), zeroY);
            const expenseY = Math.min(yFor(expense), zeroY);
            return (
              <g key={d.month}>
                <rect x={revenueX} y={revenueY} width={barWidth} height={Math.abs(yFor(revenue) - zeroY)} className="fill-info">
                  <title>{`${d.month} 売上高: ${compactYen.format(revenue)}`}</title>
                </rect>
                <rect x={expenseX} y={expenseY} width={barWidth} height={Math.abs(yFor(expense) - zeroY)} className="fill-negative">
                  <title>{`${d.month} 費用: ${compactYen.format(expense)}`}</title>
                </rect>
                <text x={groupX} y={PLOT_HEIGHT + 18} textAnchor="middle" className="fill-surface-400 text-[10px]">
                  {monthLabel(d.month ?? '')}
                </text>
              </g>
            );
          })}

          <polyline points={linePoints} fill="none" stroke="#10b981" strokeWidth={2} />
          {data.map((d, i) => {
            const x = monthSlot * i + monthSlot / 2;
            const y = yFor(d.net_income ?? 0);
            return (
              <circle key={d.month} cx={x} cy={y} r={3} className="fill-positive">
                <title>{`${d.month} 純利益: ${compactYen.format(d.net_income ?? 0)}`}</title>
              </circle>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
