import { Module } from '@nestjs/common';
import { ApprovalRequestsModule } from '../approval-requests/approval-requests.module';
import { ContractsModule } from '../contracts/contracts.module';
import { PurchaseDashboardModule } from '../purchase-dashboard/purchase-dashboard.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { SalesDashboardModule } from '../sales-dashboard/sales-dashboard.module';
import { ExecutiveDashboardController } from './executive-dashboard.controller';
import { ExecutiveDashboardService } from './executive-dashboard.service';

@Module({
  imports: [
    ApprovalRequestsModule,
    ContractsModule,
    PurchaseDashboardModule,
    AttendanceModule,
    SalesDashboardModule,
  ],
  controllers: [ExecutiveDashboardController],
  providers: [ExecutiveDashboardService],
  exports: [ExecutiveDashboardService],
})
export class ExecutiveDashboardModule {}
