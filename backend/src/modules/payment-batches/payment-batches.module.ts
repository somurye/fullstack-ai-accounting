import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PaymentBatchesController } from './payment-batches.controller';
import { PaymentBatchesService } from './payment-batches.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [PaymentBatchesController],
  providers: [PaymentBatchesService],
})
export class PaymentBatchesModule {}
