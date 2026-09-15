import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PayslipPdfService } from './payslip-pdf.service';
import { PayslipsController } from './payslips.controller';
import { PayslipsService } from './payslips.service';

@Module({
  imports: [DatabaseModule, AuditLogsModule],
  controllers: [PayslipsController],
  providers: [PayslipsService, PayslipPdfService],
  exports: [PayslipsService, PayslipPdfService],
})
export class PayslipsModule {}
