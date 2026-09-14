import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { RateMastersController } from './rate-masters.controller';
import { RateMastersService } from './rate-masters.service';

@Module({
  imports: [DatabaseModule, AuditLogsModule],
  controllers: [RateMastersController],
  providers: [RateMastersService],
  exports: [RateMastersService],
})
export class RateMastersModule {}
