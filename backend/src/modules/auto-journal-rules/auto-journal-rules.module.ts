import { Module } from '@nestjs/common';
import { AutoJournalRulesController } from './auto-journal-rules.controller';
import { AutoJournalRulesService } from './auto-journal-rules.service';

@Module({
  controllers: [AutoJournalRulesController],
  providers: [AutoJournalRulesService],
  exports: [AutoJournalRulesService],
})
export class AutoJournalRulesModule {}
