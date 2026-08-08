import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import { BankConnectionService } from './bank-connection.service';
import { BankSyncService } from './bank-sync.service';
import { bankIntegrationSyncSchema } from './dto/bank-integration.schemas';

/**
 * `docs/openapi.yaml`未収録(本タスクで追加した垂直機能)の`tags: [BankIntegration]`を実装する。
 * 銀行API/アグリゲーションAPI(現状は`MockBankApiClient`)経由の連携状態管理・明細同期エンドポイント。
 */
@Controller('bank-integration')
@UseGuards(TenantAuthGuard)
export class BankIntegrationController {
  constructor(
    private readonly bankSyncService: BankSyncService,
    private readonly bankConnectionService: BankConnectionService,
  ) {}

  @Get('status')
  async getStatus() {
    const tenantId = this.requireTenantId();
    const status = await this.bankConnectionService.getStatus(tenantId, RequestContext.getUserId());
    return successEnvelope(status);
  }

  @Post('connect')
  async connect() {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const status = await this.bankConnectionService.connect(tenantId, userId);
    return successEnvelope(status);
  }

  @Post('disconnect')
  async disconnect() {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const status = await this.bankConnectionService.disconnect(tenantId, userId);
    return successEnvelope(status);
  }

  @Post('sync')
  async sync(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const dto = parseWithZod(bankIntegrationSyncSchema, body ?? {});
    const result = await this.bankSyncService.sync(tenantId, userId, dto);
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
