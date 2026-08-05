import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ConsumptionTaxReturnsController } from './consumption-tax-returns.controller';
import { ConsumptionTaxReturnsService } from './consumption-tax-returns.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [ConsumptionTaxReturnsController],
  providers: [ConsumptionTaxReturnsService],
})
export class ConsumptionTaxReturnsModule {}
