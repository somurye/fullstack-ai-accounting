import {
  BarChart3,
  BookOpen,
  Building2,
  FileStack,
  Landmark,
  Paperclip,
  Percent,
  Receipt,
  ScrollText,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Truck,
  UserCog,
  Users,
  Wallet,
  Wand2,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '../../lib/utils';

interface NavItem {
  label: string;
  to: string;
  icon: ComponentType<{ className?: string }>;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

/**
 * ナビゲーション構成。`docs/openapi.yaml` のタグ(領域A〜D + 共通)に対応させている。
 * ルーティング先ページは今後 `src/pages/` 配下に順次実装していく想定。
 */
const NAV_GROUPS: NavGroup[] = [
  {
    title: '会計コア',
    items: [
      { label: '仕訳', to: '/journal-entries', icon: BookOpen },
      { label: '試算表・財務三表', to: '/reports', icon: BarChart3 },
    ],
  },
  {
    title: '資金・請求 (領域A)',
    items: [
      { label: '売上請求書', to: '/invoices', icon: Receipt },
      { label: '仕入請求書・買掛金', to: '/vendor-bills', icon: FileStack },
      { label: '銀行口座', to: '/bank-accounts', icon: Landmark },
      { label: '銀行明細', to: '/bank-transactions', icon: Landmark },
      { label: '支払バッチ (全銀FB)', to: '/payment-batches', icon: Send },
    ],
  },
  {
    title: '経費・承認 (領域B)',
    items: [
      { label: '経費精算', to: '/expense-reports', icon: Wallet },
      { label: '承認待ち', to: '/approval-requests', icon: ScrollText },
    ],
  },
  {
    title: '資産・税務 (領域C)',
    items: [
      { label: '固定資産', to: '/fixed-assets', icon: Building2 },
      { label: '消費税申告', to: '/consumption-tax-returns', icon: Percent },
    ],
  },
  {
    title: '給与連携 (領域D)',
    items: [{ label: '給与インポート', to: '/payroll-imports', icon: UserCog }],
  },
  {
    title: 'マスタ',
    items: [
      { label: '顧客', to: '/customers', icon: Users },
      { label: '仕入先', to: '/vendors', icon: Truck },
      { label: '勘定科目', to: '/settings/accounts', icon: BookOpen },
      { label: '税区分', to: '/settings/tax-categories', icon: Percent },
      { label: '部門', to: '/settings/departments', icon: Building2 },
      { label: '自動仕訳ルール', to: '/settings/auto-journal-rules', icon: Wand2 },
      { label: '給与CSVマッピング', to: '/payroll-import-mappings', icon: UserCog },
    ],
  },
  {
    title: 'ガバナンス',
    items: [
      { label: '監査ログ', to: '/audit-logs', icon: ShieldCheck },
      { label: '証憑管理(電帳法)', to: '/attachments', icon: Paperclip },
      { label: '外部アクセス管理', to: '/settings/external-access', icon: ShieldAlert },
      { label: 'AI提案', to: '/ai/suggestions', icon: Sparkles },
    ],
  },
  {
    title: '設定',
    items: [{ label: '設定', to: '/settings', icon: Settings }],
  },
];

export function Sidebar() {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-surface-800 bg-surface-900">
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-surface-800 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
          経
        </div>
        <span className="text-sm font-semibold tracking-wide text-surface-50">
          経理・会計オールインワン
        </span>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-surface-500">
              {group.title}
            </p>
            <ul className="space-y-1">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) => cn('nav-link', isActive && 'nav-link-active')}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
