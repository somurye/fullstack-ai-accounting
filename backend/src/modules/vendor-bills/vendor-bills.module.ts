import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { VendorBillsController } from './vendor-bills.controller';
import { VendorBillsService } from './vendor-bills.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [VendorBillsController],
  providers: [VendorBillsService],
  exports: [VendorBillsService],
})
export class VendorBillsModule {}
