import { Module } from '@nestjs/common';
import { AiSuggestionsModule } from '../ai-suggestions/ai-suggestions.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { JournalEntriesController } from './journal-entries.controller';
import { JournalEntriesService } from './journal-entries.service';

@Module({
  imports: [AiSuggestionsModule, AuditLogsModule],
  controllers: [JournalEntriesController],
  providers: [JournalEntriesService],
})
export class JournalEntriesModule {}
