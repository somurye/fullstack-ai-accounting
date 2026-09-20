import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { ContractRenewalLinksModule } from '../contract-renewal-links/contract-renewal-links.module';
import { ApprovalRequestsModule } from '../approval-requests/approval-requests.module';
import { QuotationsModule } from '../quotations/quotations.module';
import { RecommendationsService } from './recommendations.service';
import { RecommendationsController } from './recommendations.controller';

@Module({
  imports: [
    DatabaseModule,
    AuditLogsModule,
    ContractRenewalLinksModule,
    ApprovalRequestsModule,
    QuotationsModule,
  ],
  controllers: [RecommendationsController],
  providers: [RecommendationsService],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
