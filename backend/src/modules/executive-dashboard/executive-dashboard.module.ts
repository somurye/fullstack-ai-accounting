import { Module } from '@nestjs/common';
import { ExecutiveDashboardController } from './executive-dashboard.controller';
import { ExecutiveDashboardService } from './executive-dashboard.service';

@Module({
  controllers: [ExecutiveDashboardController],
  providers: [ExecutiveDashboardService],
  exports: [ExecutiveDashboardService],
})
export class ExecutiveDashboardModule {}
