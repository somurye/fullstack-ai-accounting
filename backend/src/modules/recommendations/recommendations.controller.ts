import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RecommendationsService } from './recommendations.service';
import { TenantAuthGuard, type AuthenticatedRequest } from '../../common/guards/tenant-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { successEnvelope } from '../../common/http/envelope';
import type { RecommendationStatus, RecommendationDomain } from './recommendations.dto';

@Controller('recommendations')
@UseGuards(TenantAuthGuard, PermissionsGuard)
export class RecommendationsController {
  constructor(private readonly recommendationsService: RecommendationsService) {}

  /**
   * レコメンド一覧取得
   * - 要求パーミッション: recommendation.view
   */
  @Get()
  @RequirePermissions('recommendation.view')
  @HttpCode(HttpStatus.OK)
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: RecommendationStatus,
    @Query('target_domain') targetDomain?: RecommendationDomain,
  ) {
    const tenantId = req.user.tenant_id;
    const userId = req.user.sub;
    const roles = req.user.roles || [];

    const items = await this.recommendationsService.list(tenantId, userId, roles, {
      status,
      target_domain: targetDomain,
    });
    return successEnvelope(items);
  }

  /**
   * レコメンド採用 (accept)
   * - 要求パーミッション: recommendation.act
   */
  @Patch(':id/accept')
  @RequirePermissions('recommendation.act')
  @HttpCode(HttpStatus.OK)
  async accept(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const tenantId = req.user.tenant_id;
    const userId = req.user.sub;
    const roles = req.user.roles || [];

    const result = await this.recommendationsService.accept(tenantId, userId, roles, id);
    return successEnvelope(result);
  }

  /**
   * レコメンド見送り (dismiss)
   * - 要求パーミッション: recommendation.act
   */
  @Patch(':id/dismiss')
  @RequirePermissions('recommendation.act')
  @HttpCode(HttpStatus.OK)
  async dismiss(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    const tenantId = req.user.tenant_id;
    const userId = req.user.sub;
    const roles = req.user.roles || [];

    const result = await this.recommendationsService.dismiss(tenantId, userId, roles, id);
    return successEnvelope(result);
  }
}
