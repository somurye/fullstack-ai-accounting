import { Module } from '@nestjs/common';
import { AiSuggestionsModule } from '../ai-suggestions/ai-suggestions.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { VendorBillsModule } from '../vendor-bills/vendor-bills.module';
import { BankTransactionsController } from './bank-transactions.controller';
import { BankTransactionsService } from './bank-transactions.service';

@Module({
  imports: [AuditLogsModule, AiSuggestionsModule, InvoicesModule, VendorBillsModule],
  controllers: [BankTransactionsController],
  providers: [BankTransactionsService],
  exports: [BankTransactionsService],
})
export class BankTransactionsModule {}
