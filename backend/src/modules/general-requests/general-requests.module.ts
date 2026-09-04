import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { GeneralRequestsController } from './general-requests.controller';
import { GeneralRequestsService } from './general-requests.service';

@Module({
  imports: [DatabaseModule, AuditLogsModule],
  controllers: [GeneralRequestsController],
  providers: [GeneralRequestsService],
  exports: [GeneralRequestsService],
})
export class GeneralRequestsModule {}
