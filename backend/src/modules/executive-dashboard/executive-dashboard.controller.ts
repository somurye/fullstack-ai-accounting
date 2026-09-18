import {
  Controller,
  Get,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ExecutiveDashboardService } from './executive-dashboard.service';
import { TenantAuthGuard, type AuthenticatedRequest } from '../../common/guards/tenant-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { successEnvelope } from '../../common/http/envelope';

@Controller('executive-dashboard')
@UseGuards(TenantAuthGuard, PermissionsGuard)
export class ExecutiveDashboardController {
  constructor(private readonly dashboardService: ExecutiveDashboardService) {}

  /**
   * 横断KPIエグゼクティブサマリー取得
   * - 要求パーミッション: dashboard.executive_view
   */
  @Get('summary')
  @RequirePermissions('dashboard.executive_view')
  @HttpCode(HttpStatus.OK)
  async getSummary(@Req() req: AuthenticatedRequest) {
    const tenantId = req.user.tenant_id;
    const userId = req.user.sub;
    const roles = req.user.roles || [];
    const summary = await this.dashboardService.getSummary(
      tenantId,
      userId,
      roles,
    );
    return successEnvelope(summary);
  }
}
