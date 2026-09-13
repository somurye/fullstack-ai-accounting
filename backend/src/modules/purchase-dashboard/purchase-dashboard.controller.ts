import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import { purchaseDashboardQuerySchema } from './purchase-dashboard.dto';
import { PurchaseDashboardService } from './purchase-dashboard.service';

/**
 * PurchaseDashboardController
 * ===========================
 * 購買ダッシュボード集計 API (`/purchase-dashboard`) のコントローラー。
 * PermissionsGuard により purchase_request.view 認可を強制。
 */
@Controller('purchase-dashboard')
@UseGuards(TenantAuthGuard, PermissionsGuard)
export class PurchaseDashboardController {
  constructor(private readonly service: PurchaseDashboardService) {}

  @Get('summary')
  @RequirePermissions('purchase_request.view')
  async getSummary(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedQuery = parseWithZod(purchaseDashboardQuerySchema, query);
    const summary = await this.service.getSummary(tenantId, userId, parsedQuery);
    return successEnvelope(summary);
  }

  private requireTenantId(): string {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw AppException.unauthorized('テナントコンテキストが確立されていません');
    }
    return tenantId;
  }

  private requireUserId(): string {
    const userId = RequestContext.getUserId();
    if (!userId) {
      throw AppException.unauthorized('ユーザーコンテキストが確立されていません');
    }
    return userId;
  }
}
