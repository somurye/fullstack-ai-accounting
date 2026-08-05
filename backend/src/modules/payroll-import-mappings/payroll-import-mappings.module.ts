import { Module } from '@nestjs/common';
import { PayrollImportMappingsController } from './payroll-import-mappings.controller';
import { PayrollImportMappingsService } from './payroll-import-mappings.service';

@Module({
  controllers: [PayrollImportMappingsController],
  providers: [PayrollImportMappingsService],
  exports: [PayrollImportMappingsService],
})
export class PayrollImportMappingsModule {}
