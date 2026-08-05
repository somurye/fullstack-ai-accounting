import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PayrollImportsController } from './payroll-imports.controller';
import { PayrollImportsService } from './payroll-imports.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [PayrollImportsController],
  providers: [PayrollImportsService],
})
export class PayrollImportsModule {}
