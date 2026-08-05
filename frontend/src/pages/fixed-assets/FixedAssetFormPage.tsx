import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from '../../stores/toastStore';
import { StatusBadge } from './StatusBadge';
import { useAccounts, useCreateFixedAsset, useDepartments, useFixedAsset } from './hooks';
import { DEPRECIATION_METHOD_LABEL, type DepreciationMethod, type FixedAssetStatus } from './types';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const currencyFormatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });

export function FixedAssetFormPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) {
    return <CreateFixedAssetForm />;
  }
  return <FixedAssetDetailView id={id} />;
}

function CreateFixedAssetForm() {
  const navigate = useNavigate();
  const { data: accounts = [] } = useAccounts();
  const { data: departments = [] } = useDepartments();
  const createMutation = useCreateFixedAsset();

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [acquisitionDate, setAcquisitionDate] = useState(todayIso());
  const [acquisitionCost, setAcquisitionCost] = useState('');
  const [usefulLifeYears, setUsefulLifeYears] = useState('5');
  const [depreciationMethod, setDepreciationMethod] = useState<DepreciationMethod>('straight_line');
  const [salvageValue, setSalvageValue] = useState('0');
  const [departmentId, setDepartmentId] = useState('');
  const [assetAccountId, setAssetAccountId] = useState('');
  const [expenseAccountId, setExpenseAccountId] = useState('');

  const isValid =
    name &&
    Number(acquisitionCost) > 0 &&
    Number(usefulLifeYears) > 0 &&
    assetAccountId &&
    expenseAccountId;

  const handleSubmit = async (): Promise<void> => {
    if (!isValid) {
      toast.error('名称・取得価額・耐用年数・資産科目・減価償却費科目を入力してください');
      return;
    }
    const asset = await createMutation.mutateAsync({
      name,
      category: category || undefined,
      acquisition_date: acquisitionDate,
      acquisition_cost: Number(acquisitionCost),
      useful_life_years: Number(usefulLifeYears),
      depreciation_method: depreciationMethod,
      salvage_value: Number(salvageValue) || 0,
      department_id: departmentId || undefined,
      asset_account_id: assetAccountId,
      depreciation_expense_account_id: expenseAccountId,
    });
    navigate(`/fixed-assets/${asset.id}`, { replace: true });
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/fixed-assets"
          className="mb-2 inline-flex items-center gap-1 text-sm text-surface-400 hover:text-surface-200"
        >
          <ArrowLeft className="h-4 w-4" />
          固定資産一覧へ戻る
        </Link>
        <h1 className="text-xl font-semibold text-surface-50">固定資産を新規登録</h1>
      </div>

      <div className="card grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-surface-400">資産名称</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">分類(任意)</label>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="例: 工具器具備品"
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">取得日</label>
          <input
            type="date"
            value={acquisitionDate}
            onChange={(e) => setAcquisitionDate(e.target.value)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">取得価額</label>
          <input
            type="number"
            min="0"
            step="1"
            value={acquisitionCost}
            onChange={(e) => setAcquisitionCost(e.target.value)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">残存価額</label>
          <input
            type="number"
            min="0"
            step="1"
            value={salvageValue}
            onChange={(e) => setSalvageValue(e.target.value)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">耐用年数(年)</label>
          <input
            type="number"
            min="1"
            step="1"
            value={usefulLifeYears}
            onChange={(e) => setUsefulLifeYears(e.target.value)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">償却方法</label>
          <select
            value={depreciationMethod}
            onChange={(e) => setDepreciationMethod(e.target.value as DepreciationMethod)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          >
            {(Object.entries(DEPRECIATION_METHOD_LABEL) as [DepreciationMethod, string][]).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ),
            )}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">部門(任意)</label>
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="">なし</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">資産科目</label>
          <select
            value={assetAccountId}
            onChange={(e) => setAssetAccountId(e.target.value)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="">選択してください</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-surface-400">減価償却費科目</label>
          <select
            value={expenseAccountId}
            onChange={(e) => setExpenseAccountId(e.target.value)}
            className="w-full rounded-lg border border-surface-700 bg-surface-850 px-3 py-2 text-sm text-surface-100 outline-none focus:ring-2 focus:ring-brand-400"
          >
            <option value="">選択してください</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          className="btn-primary"
          disabled={!isValid || createMutation.isPending}
          onClick={() => void handleSubmit()}
        >
          {createMutation.isPending ? '登録中…' : '登録する'}
        </button>
      </div>
    </div>
  );
}

function FixedAssetDetailView({ id }: { id: string }) {
  const navigate = useNavigate();
  const { data: asset, isLoading } = useFixedAsset(id);
  const { data: accounts = [] } = useAccounts();

  if (isLoading || !asset) {
    return <p className="text-sm text-surface-400">読み込み中…</p>;
  }

  const accountLabel = (accountId?: string): string => {
    const account = accounts.find((a) => a.id === accountId);
    return account ? `${account.code} ${account.name}` : '—';
  };

  const bookValue = (asset.acquisition_cost ?? 0) - (asset.accumulated_depreciation ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button
            type="button"
            onClick={() => navigate('/fixed-assets')}
            className="mb-2 inline-flex items-center gap-1 text-sm text-surface-400 hover:text-surface-200"
          >
            <ArrowLeft className="h-4 w-4" />
            固定資産一覧へ戻る
          </button>
          <h1 className="text-xl font-semibold text-surface-50">
            {asset.asset_no} {asset.name}
          </h1>
        </div>
        {asset.status && <StatusBadge status={asset.status as FixedAssetStatus} />}
      </div>

      <div className="card grid grid-cols-2 gap-4 p-5 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs font-medium text-surface-500">取得日</p>
          <p className="mt-1 text-surface-100">{asset.acquisition_date}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-surface-500">取得価額</p>
          <p className="mt-1 tabular-nums text-surface-100">
            {currencyFormatter.format(asset.acquisition_cost ?? 0)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-surface-500">耐用年数</p>
          <p className="mt-1 text-surface-100">{asset.useful_life_years}年</p>
        </div>
        <div>
          <p className="text-xs font-medium text-surface-500">償却方法</p>
          <p className="mt-1 text-surface-100">
            {asset.depreciation_method ? DEPRECIATION_METHOD_LABEL[asset.depreciation_method] : '—'}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-surface-500">資産科目</p>
          <p className="mt-1 text-surface-100">{accountLabel(asset.asset_account_id)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-surface-500">減価償却費科目</p>
          <p className="mt-1 text-surface-100">{accountLabel(asset.depreciation_expense_account_id)}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-surface-500">償却累計額</p>
          <p className="mt-1 tabular-nums text-surface-100">
            {currencyFormatter.format(asset.accumulated_depreciation ?? 0)}
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-surface-500">帳簿価額</p>
          <p className="mt-1 tabular-nums font-semibold text-surface-50">
            {currencyFormatter.format(bookValue)}
          </p>
        </div>
      </div>

      <div className="card overflow-x-auto p-5">
        <h2 className="mb-3 text-sm font-semibold text-surface-100">償却スケジュール</h2>
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead>
            <tr className="border-b border-surface-800 text-xs uppercase tracking-wide text-surface-500">
              <th className="px-2 py-2 font-medium">会計期間ID</th>
              <th className="px-2 py-2 text-right font-medium">計上予定額</th>
              <th className="px-2 py-2 text-right font-medium">実績額</th>
              <th className="px-2 py-2 font-medium">ステータス</th>
            </tr>
          </thead>
          <tbody>
            {(asset.depreciation_schedules ?? []).length === 0 && (
              <tr>
                <td colSpan={4} className="px-2 py-6 text-center text-surface-500">
                  償却スケジュールはまだありません(月次償却バッチを実行してください)
                </td>
              </tr>
            )}
            {(asset.depreciation_schedules ?? []).map((s) => (
              <tr key={s.id} className="border-b border-surface-800/60">
                <td className="px-2 py-2 font-mono text-xs text-surface-300">{s.fiscal_period_id}</td>
                <td className="px-2 py-2 text-right tabular-nums text-surface-200">
                  {currencyFormatter.format(s.scheduled_amount ?? 0)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-surface-200">
                  {s.actual_amount !== null && s.actual_amount !== undefined
                    ? currencyFormatter.format(s.actual_amount)
                    : '—'}
                </td>
                <td className="px-2 py-2 text-surface-300">{s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
