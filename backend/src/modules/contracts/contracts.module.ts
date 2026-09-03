import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AiSuggestionsModule } from '../ai-suggestions/ai-suggestions.module';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';

@Module({
  imports: [DatabaseModule, AuditLogsModule, AiSuggestionsModule],
  controllers: [ContractsController],
  providers: [ContractsService],
  exports: [ContractsService],
})
export class ContractsModule {}
