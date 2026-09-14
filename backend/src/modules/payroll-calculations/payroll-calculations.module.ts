import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PayrollCalculationsController } from './payroll-calculations.controller';
import { PayrollCalculationsService } from './payroll-calculations.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [PayrollCalculationsController],
  providers: [PayrollCalculationsService],
  exports: [PayrollCalculationsService],
})
export class PayrollCalculationsModule {}
