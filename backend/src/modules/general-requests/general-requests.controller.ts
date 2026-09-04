import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
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
import {
  createGeneralRequestSchema,
  generalRequestListQuerySchema,
  updateGeneralRequestSchema,
} from './dto/general-request.schemas';
import { GeneralRequestsService } from './general-requests.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/**
 * GeneralRequestsController
 * =========================
 * 汎用稟議申請 API (`/general-requests`) のコントローラー。
 * PermissionsGuard により細粒度RBAC (general_request.*) を明示的に認可強制。
 */
@Controller('general-requests')
@UseGuards(TenantAuthGuard, PermissionsGuard)
export class GeneralRequestsController {
  constructor(private readonly generalRequestsService: GeneralRequestsService) {}

  @Get()
  @RequirePermissions('general_request.view')
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(generalRequestListQuerySchema, query);
    const { data, pagination } = await this.generalRequestsService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(data, pagination);
  }

  @Post()
  @RequirePermissions('general_request.create')
  async create(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const dto = parseWithZod(createGeneralRequestSchema, body);
    const request = await this.generalRequestsService.create(tenantId, userId, dto);
    return successEnvelope(request);
  }

  @Get(':id')
  @RequirePermissions('general_request.view')
  async getById(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const request = await this.generalRequestsService.getById(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
    );
    return successEnvelope(request);
  }

  @Put(':id')
  @RequirePermissions('general_request.edit')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(updateGeneralRequestSchema, body);
    const request = await this.generalRequestsService.update(
      tenantId,
      userId,
      parsedId,
      dto,
    );
    return successEnvelope(request);
  }

  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('general_request.edit')
  async delete(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    await this.generalRequestsService.delete(tenantId, userId, parsedId);
    return successEnvelope({ deleted_id: parsedId });
  }

  @Post(':id/submit-approval')
  @HttpCode(200)
  @RequirePermissions('general_request.create', 'general_request.edit')
  async submitForApproval(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const request = await this.generalRequestsService.submitForApproval(
      tenantId,
      userId,
      parsedId,
    );
    return successEnvelope(request);
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
