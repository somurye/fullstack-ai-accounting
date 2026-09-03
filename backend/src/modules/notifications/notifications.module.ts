import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { ContractExpiryAlertService } from './contract-expiry-alert.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [DatabaseModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, ContractExpiryAlertService],
  exports: [NotificationsService, ContractExpiryAlertService],
})
export class NotificationsModule {}
