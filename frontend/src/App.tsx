import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { Role } from './lib/rbac';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { RequireRole } from './routes/RequireRole';
import { ForbiddenPage } from './pages/ForbiddenPage';
import { LoginPage } from './pages/auth/LoginPage';
import { SignupPage } from './pages/auth/SignupPage';
import { AcceptInvitePage } from './pages/auth/AcceptInvitePage';
import { DashboardPage } from './pages/DashboardPage';
import { JournalEntryFormPage } from './pages/journal-entries/JournalEntryFormPage';
import { JournalEntryListPage } from './pages/journal-entries/JournalEntryListPage';
import { ExpenseReportFormPage } from './pages/expense-reports/ExpenseReportFormPage';
import { ExpenseReportListPage } from './pages/expense-reports/ExpenseReportListPage';
import { InvoiceFormPage } from './pages/invoices/InvoiceFormPage';
import { InvoiceListPage } from './pages/invoices/InvoiceListPage';
import { VendorBillFormPage } from './pages/vendor-bills/VendorBillFormPage';
import { VendorBillListPage } from './pages/vendor-bills/VendorBillListPage';
import { PaymentBatchListPage } from './pages/payment-batches/PaymentBatchListPage';
import { FixedAssetFormPage } from './pages/fixed-assets/FixedAssetFormPage';
import { FixedAssetListPage } from './pages/fixed-assets/FixedAssetListPage';
import { ConsumptionTaxReturnsPage } from './pages/consumption-tax-returns/ConsumptionTaxReturnsPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { AiSuggestionListPage } from './pages/ai-suggestions/AiSuggestionListPage';
import { AuditLogListPage } from './pages/audit-logs/AuditLogListPage';
import { AttachmentSearchPage } from './pages/attachments/AttachmentSearchPage';
import { ExternalAccessPage } from './pages/settings/ExternalAccessPage';
import { CustomerListPage } from './pages/customers/CustomerListPage';
import { VendorListPage } from './pages/vendors/VendorListPage';
import { AccountsSettingsPage } from './pages/settings/AccountsSettingsPage';
import { TaxCategoriesSettingsPage } from './pages/settings/TaxCategoriesSettingsPage';
import { DepartmentsSettingsPage } from './pages/settings/DepartmentsSettingsPage';
import { BankAccountListPage } from './pages/bank-accounts/BankAccountListPage';
import { BankTransactionListPage } from './pages/bank-transactions/BankTransactionListPage';
import { AutoJournalRuleListPage } from './pages/settings/AutoJournalRuleListPage';
import { PayrollImportPage } from './pages/payroll-imports/PayrollImportPage';
import { PayrollMappingListPage } from './pages/payroll-imports/PayrollMappingListPage';
import { ApprovalRequestListPage } from './pages/approval-requests/ApprovalRequestListPage';
import { SettingsPage } from './pages/settings/SettingsPage';

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
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
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
  );
}
