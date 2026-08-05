import { Controller, Get, UseGuards } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { DashboardService } from './dashboard.service';

/**
 * DashboardController
 * ====================
 * `docs/openapi.yaml` の `tags: [Dashboard]` に定義されたエンドポイントを実装する。
 * ダッシュボード画面(`/dashboard`)表示に必要な集計データを1リクエストで返す、
 * 読み取り専用の横断集計API。
 */
@Controller('dashboard')
@UseGuards(TenantAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  async summary() {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const result = await this.dashboardService.summary(tenantId, userId, userId);
    return successEnvelope(result);
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
