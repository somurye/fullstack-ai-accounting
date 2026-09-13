import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { PurchaseDashboardController } from './purchase-dashboard.controller';
import { PurchaseDashboardService } from './purchase-dashboard.service';

@Module({
  imports: [DatabaseModule],
  controllers: [PurchaseDashboardController],
  providers: [PurchaseDashboardService],
  exports: [PurchaseDashboardService],
})
export class PurchaseDashboardModule {}
