import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
