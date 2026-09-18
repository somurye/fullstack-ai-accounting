import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DealsModule } from '../deals/deals.module';
import { ContractRenewalLinksService } from './contract-renewal-links.service';
import { ContractRenewalLinksController } from './contract-renewal-links.controller';

@Module({
  imports: [DatabaseModule, AuditLogsModule, DealsModule],
  providers: [ContractRenewalLinksService],
  controllers: [ContractRenewalLinksController],
  exports: [ContractRenewalLinksService],
})
export class ContractRenewalLinksModule {}
