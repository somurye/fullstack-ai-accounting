import {
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import { notificationListQuerySchema } from './dto/notification.schemas';
import { NotificationsService } from './notifications.service';
import { ContractExpiryAlertService } from './contract-expiry-alert.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

@Controller('notifications')
@UseGuards(TenantAuthGuard, PermissionsGuard)
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly contractExpiryAlertService: ContractExpiryAlertService,
  ) {}

  /**
   * 通知一覧を取得する。
   */
  @Get()
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(notificationListQuerySchema, query);
    const result = await this.notificationsService.list(tenantId, parsedQuery);
    return successEnvelope(result);
  }

  /**
   * 通知を既読化する。
   */
  @Patch(':id/read')
  async markAsRead(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const updated = await this.notificationsService.markAsRead(tenantId, parsedId);
    return successEnvelope(updated);
  }

  /**
   * 契約期限アラートバッチを手動実行する (全テナント横断管理機能)。
   * - notification.batch_execute 権限を持つロール (owner のみ) に制限。
   * - 個別テナントの情報漏洩を防ぐため、集計値のみを返却。
   */
  @Post('run-expiry-batch')
  @HttpCode(200)
  @RequirePermissions('notification.batch_execute')
  async runExpiryBatch() {
    const result = await this.contractExpiryAlertService.runBatch();
    return successEnvelope({
      processed_tenants: result.processedTenants,
      created_notifications: result.createdNotifications,
      failed_tenants_count: result.failedTenantsCount,
    });
  }

  private requireTenantId(): string {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new AppException('UNAUTHORIZED', 'Tenant ID is required', 401);
    }
    return tenantId;
  }
}
