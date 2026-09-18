import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SalesDashboardService } from './sales-dashboard.service';
import { TenantAuthGuard, type AuthenticatedRequest } from '../../common/guards/tenant-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import { salesDashboardQuerySchema } from './sales-dashboard.dto';

@Controller('sales-dashboard')
@UseGuards(TenantAuthGuard, PermissionsGuard)
export class SalesDashboardController {
  constructor(private readonly dashboardService: SalesDashboardService) {}

  /**
   * 営業ダッシュボード統合サマリー取得
   */
  @Get('summary')
  @RequirePermissions('dashboard.view')
  @HttpCode(HttpStatus.OK)
  async getSummary(
    @Req() req: AuthenticatedRequest,
    @Query() query: unknown,
  ) {
    const tenantId = req.user.tenant_id;
    const userId = req.user.sub;
    const roles = req.user.roles || [];
    const parsedQuery = parseWithZod(salesDashboardQuerySchema, query);
    const summary = await this.dashboardService.getSummary(
      tenantId,
      userId,
      roles,
      parsedQuery,
    );
    return successEnvelope(summary);
  }

  /**
   * 案件パイプライン集計単体取得
   */
  @Get('pipeline')
  @RequirePermissions('dashboard.view')
  @HttpCode(HttpStatus.OK)
  async getPipelineSummary(@Req() req: AuthenticatedRequest) {
    const tenantId = req.user.tenant_id;
    const userId = req.user.sub;
    const roles = req.user.roles || [];
    const pipeline = await this.dashboardService.getPipelineSummary(
      tenantId,
      userId,
      roles,
    );
    return successEnvelope(pipeline);
  }

  /**
   * 見積状態別集計単体取得
   */
  @Get('quotations')
  @RequirePermissions('dashboard.view')
  @HttpCode(HttpStatus.OK)
  async getQuotationSummary(@Req() req: AuthenticatedRequest) {
    const tenantId = req.user.tenant_id;
    const userId = req.user.sub;
    const roles = req.user.roles || [];
    const quotations = await this.dashboardService.getQuotationSummary(
      tenantId,
      userId,
      roles,
    );
    return successEnvelope(quotations);
  }

  /**
   * 契約更新連携進捗集計単体取得
   */
  @Get('renewals')
  @RequirePermissions('dashboard.view')
  @HttpCode(HttpStatus.OK)
  async getRenewalSummary(@Req() req: AuthenticatedRequest) {
    const tenantId = req.user.tenant_id;
    const userId = req.user.sub;
    const roles = req.user.roles || [];
    const renewals = await this.dashboardService.getRenewalSummary(
      tenantId,
      userId,
      roles,
    );
    return successEnvelope(renewals);
  }
}
