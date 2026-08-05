import { Module } from '@nestjs/common';
import { FiscalPeriodsController } from './fiscal-periods.controller';
import { FiscalPeriodsService } from './fiscal-periods.service';
import { FiscalYearsController } from './fiscal-years.controller';
import { FiscalYearsService } from './fiscal-years.service';

@Module({
  controllers: [FiscalYearsController, FiscalPeriodsController],
  providers: [FiscalYearsService, FiscalPeriodsService],
})
export class FiscalPeriodsModule {}
