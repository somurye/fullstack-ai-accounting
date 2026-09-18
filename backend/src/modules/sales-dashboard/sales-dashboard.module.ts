import { Module } from '@nestjs/common';
import { SalesDashboardController } from './sales-dashboard.controller';
import { SalesDashboardService } from './sales-dashboard.service';

@Module({
  controllers: [SalesDashboardController],
  providers: [SalesDashboardService],
  exports: [SalesDashboardService],
})
export class SalesDashboardModule {}
