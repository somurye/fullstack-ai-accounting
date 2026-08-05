import { Module } from '@nestjs/common';
import { AiSuggestionsModule } from '../ai-suggestions/ai-suggestions.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SettingsModule } from '../settings/settings.module';
import { ExpenseReportsController } from './expense-reports.controller';
import { ExpenseReportsService } from './expense-reports.service';
import { ReceiptOcrExtractionService } from './receipt-ocr-extraction.service';

@Module({
  imports: [AiSuggestionsModule, AuditLogsModule, SettingsModule],
  controllers: [ExpenseReportsController],
  providers: [ExpenseReportsService, ReceiptOcrExtractionService],
})
export class ExpenseReportsModule {}
