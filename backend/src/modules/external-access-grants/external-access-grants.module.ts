import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ExternalAccessGrantsController } from './external-access-grants.controller';
import { ExternalAccessGrantsService } from './external-access-grants.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [ExternalAccessGrantsController],
  providers: [ExternalAccessGrantsService],
})
export class ExternalAccessGrantsModule {}
