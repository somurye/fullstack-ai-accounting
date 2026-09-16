import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { YearEndAdjustmentsController } from './year-end-adjustments.controller';
import { YearEndAdjustmentsService } from './year-end-adjustments.service';

@Module({
  imports: [DatabaseModule, AuditLogsModule],
  controllers: [YearEndAdjustmentsController],
  providers: [YearEndAdjustmentsService],
  exports: [YearEndAdjustmentsService],
})
export class YearEndAdjustmentsModule {}
