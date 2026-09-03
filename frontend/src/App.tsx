import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { MobileLayout } from './components/layout/MobileLayout';
import { Role, resolveHomePath } from './lib/rbac';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { RequireRole } from './routes/RequireRole';
import { ForbiddenPage } from './pages/ForbiddenPage';
import { LoginPage } from './pages/auth/LoginPage';
import { SignupPage } from './pages/auth/SignupPage';
import { AcceptInvitePage } from './pages/auth/AcceptInvitePage';
import { useAuthStore } from './stores/authStore';

/**
 * ページ単位のコード分割。
 * ==========================
 * ダッシュボード以降の各業務画面は認証後にしか到達しないため、初回バンドル
 * (`dist/assets/index-*.js`)に含める必要がない。`React.lazy`による動的importで
 * ルートごとの別チャンクへ分割し、初回ロード時間を短縮する。名前付きexportのため
 * `.then(m => ({ default: m.XxxPage }))`で`React.lazy`が要求するdefault exportへ
 * 変換している。
 */
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const JournalEntryFormPage = lazy(() =>
  import('./pages/journal-entries/JournalEntryFormPage').then((m) => ({ default: m.JournalEntryFormPage })),
);
const JournalEntryListPage = lazy(() =>
  import('./pages/journal-entries/JournalEntryListPage').then((m) => ({ default: m.JournalEntryListPage })),
);
const ExpenseReportFormPage = lazy(() =>
  import('./pages/expense-reports/ExpenseReportFormPage').then((m) => ({ default: m.ExpenseReportFormPage })),
);
const ExpenseReportListPage = lazy(() =>
  import('./pages/expense-reports/ExpenseReportListPage').then((m) => ({ default: m.ExpenseReportListPage })),
);
const InvoiceFormPage = lazy(() =>
  import('./pages/invoices/InvoiceFormPage').then((m) => ({ default: m.InvoiceFormPage })),
);
const InvoiceListPage = lazy(() =>
  import('./pages/invoices/InvoiceListPage').then((m) => ({ default: m.InvoiceListPage })),
);
const VendorBillFormPage = lazy(() =>
  import('./pages/vendor-bills/VendorBillFormPage').then((m) => ({ default: m.VendorBillFormPage })),
);
const VendorBillListPage = lazy(() =>
  import('./pages/vendor-bills/VendorBillListPage').then((m) => ({ default: m.VendorBillListPage })),
);
const PaymentBatchListPage = lazy(() =>
  import('./pages/payment-batches/PaymentBatchListPage').then((m) => ({ default: m.PaymentBatchListPage })),
);
const FixedAssetFormPage = lazy(() =>
  import('./pages/fixed-assets/FixedAssetFormPage').then((m) => ({ default: m.FixedAssetFormPage })),
);
const FixedAssetListPage = lazy(() =>
  import('./pages/fixed-assets/FixedAssetListPage').then((m) => ({ default: m.FixedAssetListPage })),
);
const ConsumptionTaxReturnsPage = lazy(() =>
  import('./pages/consumption-tax-returns/ConsumptionTaxReturnsPage').then((m) => ({
    default: m.ConsumptionTaxReturnsPage,
  })),
);
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const AiSuggestionListPage = lazy(() =>
  import('./pages/ai-suggestions/AiSuggestionListPage').then((m) => ({ default: m.AiSuggestionListPage })),
);
const AuditLogListPage = lazy(() =>
  import('./pages/audit-logs/AuditLogListPage').then((m) => ({ default: m.AuditLogListPage })),
);
const AttachmentSearchPage = lazy(() =>
  import('./pages/attachments/AttachmentSearchPage').then((m) => ({ default: m.AttachmentSearchPage })),
);
const ExternalAccessPage = lazy(() =>
  import('./pages/settings/ExternalAccessPage').then((m) => ({ default: m.ExternalAccessPage })),
);
const CustomerListPage = lazy(() =>
  import('./pages/customers/CustomerListPage').then((m) => ({ default: m.CustomerListPage })),
);
const VendorListPage = lazy(() =>
  import('./pages/vendors/VendorListPage').then((m) => ({ default: m.VendorListPage })),
);
const AccountsSettingsPage = lazy(() =>
  import('./pages/settings/AccountsSettingsPage').then((m) => ({ default: m.AccountsSettingsPage })),
);
const TaxCategoriesSettingsPage = lazy(() =>
  import('./pages/settings/TaxCategoriesSettingsPage').then((m) => ({ default: m.TaxCategoriesSettingsPage })),
);
const DepartmentsSettingsPage = lazy(() =>
  import('./pages/settings/DepartmentsSettingsPage').then((m) => ({ default: m.DepartmentsSettingsPage })),
);
const BankAccountListPage = lazy(() =>
  import('./pages/bank-accounts/BankAccountListPage').then((m) => ({ default: m.BankAccountListPage })),
);
const BankTransactionListPage = lazy(() =>
  import('./pages/bank-transactions/BankTransactionListPage').then((m) => ({ default: m.BankTransactionListPage })),
);
const AutoJournalRuleListPage = lazy(() =>
  import('./pages/settings/AutoJournalRuleListPage').then((m) => ({ default: m.AutoJournalRuleListPage })),
);
const PayrollImportPage = lazy(() =>
  import('./pages/payroll-imports/PayrollImportPage').then((m) => ({ default: m.PayrollImportPage })),
);
const PayrollMappingListPage = lazy(() =>
  import('./pages/payroll-imports/PayrollMappingListPage').then((m) => ({ default: m.PayrollMappingListPage })),
);
const ApprovalRequestListPage = lazy(() =>
  import('./pages/approval-requests/ApprovalRequestListPage').then((m) => ({
    default: m.ApprovalRequestListPage,
  })),
);
const ContractCreatePage = lazy(() =>
  import('./pages/contracts/ContractCreatePage').then((m) => ({ default: m.ContractCreatePage })),
);
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const MobileExpenseApplyPage = lazy(() =>
  import('./pages/mobile/MobileExpenseApplyPage').then((m) => ({ default: m.MobileExpenseApplyPage })),
);
const MobileMyApplicationsPage = lazy(() =>
  import('./pages/mobile/MobileMyApplicationsPage').then((m) => ({ default: m.MobileMyApplicationsPage })),
);

function RouteFallback() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center">
      <p className="text-sm text-surface-500">読み込み中…</p>
    </div>
  );
}

/**
 * `/`直アクセス時の遷移先をロールに応じて出し分ける。EMPLOYEE専任ユーザーは
 * PCダッシュボードではなくスマホ経費申請ウィザードを起点にする(`resolveHomePath`)。
 * ログイン成功直後の遷移も同じ関数で決定しており(`LoginPage.tsx`)、ここでは
 * 既存セッションでの直接アクセス・リロード時の一貫性を担保する。
 */
function HomeRedirect() {
  const userRoles = useAuthStore((state) => state.user?.roles);
  return <Navigate to={resolveHomePath(userRoles)} replace />;
}

/**
 * App
 * ===
 * ルーティング定義。`QueryClientProvider` / `BrowserRouter` は `src/main.tsx` 側で
 * ツリーの外側に設定済みのため、ここでは `<Routes>` の構成のみを行う。
 *
 * `/login` `/signup` `/accept-invite` は未認証でもアクセス可能な公開ルート。それ以外はすべて
 * `ProtectedRoute` 配下に置かれ、未ログイン時は自動的に `/login` へリダイレクトされる。
 * `AppLayout` を認証後の親ルートとし、各業務画面は子ルートとして `<Outlet />` に描画される。
 */
export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />

        <Route element={<ProtectedRoute />}>
          {/* スマホ専用画面: 一般社員(EMPLOYEE)向けの経費申請ウィザード。承認者/管理者も
              自分の経費を申請する場合にアクセスできるよう、APPROVER/ADMINも許可する。
              PC用の`AppLayout`(サイドバー付き)とは別系統の`MobileLayout`を使う。 */}
          <Route element={<RequireRole roles={[Role.EMPLOYEE, Role.APPROVER, Role.ADMIN]} />}>
            <Route element={<MobileLayout />}>
              <Route path="/mobile/expense-apply" element={<MobileExpenseApplyPage />} />
              <Route path="/mobile/my-applications" element={<MobileMyApplicationsPage />} />
            </Route>
          </Route>

          <Route element={<AppLayout />}>
            <Route index element={<HomeRedirect />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/journal-entries" element={<JournalEntryListPage />} />
            <Route path="/journal-entries/new" element={<JournalEntryFormPage />} />
            <Route path="/journal-entries/:id" element={<JournalEntryFormPage />} />
            <Route path="/expense-reports" element={<ExpenseReportListPage />} />
            <Route path="/expense-reports/new" element={<ExpenseReportFormPage />} />
            <Route path="/expense-reports/:id" element={<ExpenseReportFormPage />} />
            <Route path="/invoices" element={<InvoiceListPage />} />
            <Route path="/invoices/new" element={<InvoiceFormPage />} />
            <Route path="/invoices/:id" element={<InvoiceFormPage />} />
            <Route path="/vendor-bills" element={<VendorBillListPage />} />
            <Route path="/vendor-bills/new" element={<VendorBillFormPage />} />
            <Route path="/vendor-bills/:id" element={<VendorBillFormPage />} />
            <Route path="/payment-batches" element={<PaymentBatchListPage />} />
            <Route path="/fixed-assets" element={<FixedAssetListPage />} />
            <Route path="/fixed-assets/new" element={<FixedAssetFormPage />} />
            <Route path="/fixed-assets/:id" element={<FixedAssetFormPage />} />
            <Route path="/consumption-tax-returns" element={<ConsumptionTaxReturnsPage />} />
            <Route path="/contracts/new" element={<ContractCreatePage />} />
            <Route path="/contracts" element={<ContractCreatePage />} />
            <Route path="/forbidden" element={<ForbiddenPage />} />

            {/* 職務分掌(SoD)RBAC: 財務諸表は ADMIN / ACCOUNTANT のみ */}
            <Route element={<RequireRole roles={[Role.ADMIN, Role.ACCOUNTANT]} />}>
              <Route path="/reports" element={<ReportsPage />} />
            </Route>

            <Route path="/ai/suggestions" element={<AiSuggestionListPage />} />

            {/* 職務分掌(SoD)RBAC: 監査ログは ADMIN / ACCOUNTANT に加え、時限アクセス許可を持つ外部閲覧者も対象 */}
            <Route element={<RequireRole roles={[Role.ADMIN, Role.ACCOUNTANT, 'viewer_external']} />}>
              <Route path="/audit-logs" element={<AuditLogListPage />} />
            </Route>

            <Route path="/attachments" element={<AttachmentSearchPage />} />
            <Route path="/customers" element={<CustomerListPage />} />
            <Route path="/vendors" element={<VendorListPage />} />
            <Route path="/bank-accounts" element={<BankAccountListPage />} />
            <Route path="/bank-transactions" element={<BankTransactionListPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/accounts" element={<AccountsSettingsPage />} />
            <Route path="/settings/tax-categories" element={<TaxCategoriesSettingsPage />} />
            <Route path="/settings/departments" element={<DepartmentsSettingsPage />} />
            <Route path="/settings/auto-journal-rules" element={<AutoJournalRuleListPage />} />
            <Route path="/settings/external-access" element={<ExternalAccessPage />} />
            <Route path="/payroll-imports" element={<PayrollImportPage />} />
            <Route path="/payroll-import-mappings" element={<PayrollMappingListPage />} />
            <Route path="/approval-requests" element={<ApprovalRequestListPage />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}
