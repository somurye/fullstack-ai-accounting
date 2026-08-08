import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { BankTransactionsModule } from '../bank-transactions/bank-transactions.module';
import { BankConnectionService } from './bank-connection.service';
import { BankIntegrationController } from './bank-integration.controller';
import { BankSyncService } from './bank-sync.service';
import { bankApiClientProvider } from './clients/bank-api-client.provider';
import { MockBankApiClient } from './clients/mock-bank-api-client';

@Module({
  imports: [AuditLogsModule, BankTransactionsModule],
  controllers: [BankIntegrationController],
  providers: [BankSyncService, BankConnectionService, MockBankApiClient, bankApiClientProvider],
})
export class BankIntegrationModule {}
