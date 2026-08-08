import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from './database/database.module';
import { TenantContextMiddleware } from './common/middleware/tenant-context.middleware';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { JournalEntriesModule } from './modules/journal-entries/journal-entries.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { TaxCategoriesModule } from './modules/tax-categories/tax-categories.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { ExpenseReportsModule } from './modules/expense-reports/expense-reports.module';
import { ExpenseCategoriesModule } from './modules/expense-categories/expense-categories.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { CustomersModule } from './modules/customers/customers.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { VendorBillsModule } from './modules/vendor-bills/vendor-bills.module';
import { PaymentBatchesModule } from './modules/payment-batches/payment-batches.module';
import { FixedAssetsModule } from './modules/fixed-assets/fixed-assets.module';
import { ConsumptionTaxReturnsModule } from './modules/consumption-tax-returns/consumption-tax-returns.module';
import { ReportsModule } from './modules/reports/reports.module';
import { FiscalPeriodsModule } from './modules/fiscal-periods/fiscal-periods.module';
import { AiSuggestionsModule } from './modules/ai-suggestions/ai-suggestions.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { ExternalAccessGrantsModule } from './modules/external-access-grants/external-access-grants.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { BankAccountsModule } from './modules/bank-accounts/bank-accounts.module';
import { BankTransactionsModule } from './modules/bank-transactions/bank-transactions.module';
import { BankIntegrationModule } from './modules/bank-integration/bank-integration.module';
import { AutoJournalRulesModule } from './modules/auto-journal-rules/auto-journal-rules.module';
import { PayrollImportMappingsModule } from './modules/payroll-import-mappings/payroll-import-mappings.module';
import { PayrollImportsModule } from './modules/payroll-imports/payroll-imports.module';
import { ApprovalRequestsModule } from './modules/approval-requests/approval-requests.module';
import { SettingsModule } from './modules/settings/settings.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';

/**
 * AppModule
 * =========
 * ルートモジュール。共通基盤(DatabaseModule / JwtModule / グローバル例外フィルター /
 * テナントコンテキストミドルウェア)をここで組み立てる。
 *
 * 業務機能(仕訳・請求書・経費精算 等)は `docs/openapi.yaml` の各リソースに対応する
 * 機能モジュール(例: `JournalEntriesModule`)として今後 `imports` に追加していく想定。
 * 各機能モジュールは `TenantAuthGuard` をコントローラ単位/ルート単位で適用し、
 * `DatabaseService.transaction()` に `RequestContext.getTenantId()` /
 * `RequestContext.getUserId()` を渡してRLSコンテキストを確立する。
 */
@Module({
  imports: [
    DatabaseModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'change-me-in-production',
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '1h' },
    }),
    JournalEntriesModule,
    AccountsModule,
    TaxCategoriesModule,
    DepartmentsModule,
    ExpenseReportsModule,
    ExpenseCategoriesModule,
    InvoicesModule,
    CustomersModule,
    VendorsModule,
    VendorBillsModule,
    PaymentBatchesModule,
    FixedAssetsModule,
    ConsumptionTaxReturnsModule,
    ReportsModule,
    FiscalPeriodsModule,
    AiSuggestionsModule,
    AuditLogsModule,
    AttachmentsModule,
    ExternalAccessGrantsModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    BankAccountsModule,
    BankTransactionsModule,
    BankIntegrationModule,
    AutoJournalRulesModule,
    PayrollImportMappingsModule,
    PayrollImportsModule,
    ApprovalRequestsModule,
    SettingsModule,
    DashboardModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
  exports: [JwtModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // 全ルートに適用し、リクエスト処理の最初期段階でRequestContextを確立する。
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
