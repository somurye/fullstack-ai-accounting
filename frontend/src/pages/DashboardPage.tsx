/**
 * DashboardPage
 * =============
 * `AppLayout` の動作確認用プレースホルダーページ。
 * 今後、`docs/openapi.yaml` の各リソース(仕訳/請求書/経費精算 等)に対応する
 * ページ・TanStack Queryフックを `src/pages/` 配下に追加していく。
 */
export function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-surface-50">ダッシュボード</h1>
        <p className="mt-1 text-sm text-surface-400">
          経理・会計オールインワンAIアプリケーションへようこそ。
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: '未承認の申請', value: '—' },
          { label: '本日の入金消込', value: '—' },
          { label: '未消込の請求書', value: '—' },
          { label: '確定待ちの仕訳', value: '—' },
        ].map((stat) => (
          <div key={stat.label} className="card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-surface-500">
              {stat.label}
            </p>
            <p className="mt-2 text-2xl font-semibold text-surface-50">{stat.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
