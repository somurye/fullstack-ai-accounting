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
const ContractListPage = lazy(() =>
  import('./pages/contracts/ContractListPage').then((m) => ({ default: m.ContractListPage })),
);
const GeneralRequestListPage = lazy(() =>
  import('./pages/general-requests/GeneralRequestListPage').then((m) => ({ default: m.GeneralRequestListPage })),
);
const GeneralRequestFormPage = lazy(() =>
  import('./pages/general-requests/GeneralRequestFormPage').then((m) => ({ default: m.GeneralRequestFormPage })),
);
const GeneralRequestDetailPage = lazy(() =>
  import('./pages/general-requests/GeneralRequestDetailPage').then((m) => ({ default: m.GeneralRequestDetailPage })),
);
const PurchaseRequestListPage = lazy(() =>
  import('./pages/purchase-requests/PurchaseRequestListPage').then((m) => ({ default: m.PurchaseRequestListPage })),
);
const PurchaseRequestFormPage = lazy(() =>
  import('./pages/purchase-requests/PurchaseRequestFormPage').then((m) => ({ default: m.PurchaseRequestFormPage })),
);
const PurchaseRequestDetailPage = lazy(() =>
  import('./pages/purchase-requests/PurchaseRequestDetailPage').then((m) => ({ default: m.PurchaseRequestDetailPage })),
);
const PurchaseDashboardPage = lazy(() =>
  import('./pages/purchase-requests/PurchaseDashboardPage').then((m) => ({ default: m.PurchaseDashboardPage })),
);
const SupplierListPage = lazy(() =>
  import('./pages/suppliers/SupplierListPage').then((m) => ({ default: m.SupplierListPage })),
);
const EmployeeListPage = lazy(() =>
  import('./pages/employees/EmployeeListPage').then((m) => ({ default: m.EmployeeListPage })),
);
const AttendancePage = lazy(() =>
  import('./pages/attendance/AttendancePage').then((m) => ({ default: m.AttendancePage })),
);
const RateMastersPage = lazy(() =>
  import('./pages/rate-masters/RateMastersPage').then((m) => ({ default: m.RateMastersPage })),
);
const PayrollCalculationsPage = lazy(() =>
  import('./pages/payroll-calculations/PayrollCalculationsPage').then((m) => ({ default: m.PayrollCalculationsPage })),
);
const PayslipsPage = lazy(() =>
  import('./pages/payslips/PayslipsPage').then((m) => ({ default: m.PayslipsPage })),
);
const YearEndAdjustmentsPage = lazy(() =>
  import('./pages/year-end-adjustments/YearEndAdjustmentsPage').then((m) => ({ default: m.YearEndAdjustmentsPage })),
);
const QuotationListPage = lazy(() =>
  import('./pages/quotations/QuotationListPage').then((m) => ({ default: m.QuotationListPage })),
);
const QuotationFormPage = lazy(() =>
  import('./pages/quotations/QuotationFormPage').then((m) => ({ default: m.QuotationFormPage })),
);
const QuotationDetailPage = lazy(() =>
  import('./pages/quotations/QuotationDetailPage').then((m) => ({ default: m.QuotationDetailPage })),
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
            <Route path="/contracts" element={<ContractListPage />} />
            <Route path="/general-requests" element={<GeneralRequestListPage />} />
            <Route path="/general-requests/new" element={<GeneralRequestFormPage />} />
            <Route path="/general-requests/:id" element={<GeneralRequestDetailPage />} />
            <Route path="/general-requests/:id/edit" element={<GeneralRequestFormPage />} />
            <Route path="/purchase-requests" element={<PurchaseRequestListPage />} />
            <Route path="/purchase-requests/new" element={<PurchaseRequestFormPage />} />
            <Route path="/purchase-requests/:id" element={<PurchaseRequestDetailPage />} />
            <Route path="/purchase-requests/:id/edit" element={<PurchaseRequestFormPage />} />
            <Route path="/purchase-dashboard" element={<PurchaseDashboardPage />} />
            <Route path="/suppliers" element={<SupplierListPage />} />
            <Route path="/employees" element={<EmployeeListPage />} />
            <Route path="/attendance" element={<AttendancePage />} />
            <Route path="/rate-masters" element={<RateMastersPage />} />
            <Route path="/payroll-calculations" element={<PayrollCalculationsPage />} />
            <Route path="/payslips" element={<PayslipsPage />} />
            <Route path="/year-end-adjustments" element={<YearEndAdjustmentsPage />} />
            <Route path="/quotations" element={<QuotationListPage />} />
            <Route path="/quotations/new" element={<QuotationFormPage />} />
            <Route path="/quotations/:id" element={<QuotationDetailPage />} />
            <Route path="/quotations/:id/edit" element={<QuotationFormPage />} />
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
