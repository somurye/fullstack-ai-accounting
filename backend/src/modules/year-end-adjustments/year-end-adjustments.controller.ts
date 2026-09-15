import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
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
import {
  yearEndAdjustmentCalculateSchema,
  yearEndAdjustmentListQuerySchema,
  yearEndAdjustmentSubmitApprovalSchema,
} from './dto/year-end-adjustment.schemas';
import { YearEndAdjustmentsService } from './year-end-adjustments.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

@Controller('year-end-adjustments')
@UseGuards(TenantAuthGuard, PermissionsGuard)
export class YearEndAdjustmentsController {
  constructor(private readonly service: YearEndAdjustmentsService) {}

  @Get()
  @RequirePermissions('year_end_adjustment.view')
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedQuery = parseWithZod(yearEndAdjustmentListQuerySchema, query);
    const { adjustments, pagination } = await this.service.list(tenantId, userId, parsedQuery);
    return successEnvelope(adjustments, pagination);
  }

  @Get(':id')
  @RequirePermissions('year_end_adjustment.view')
  async findOne(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const adjustment = await this.service.findById(tenantId, userId, parsedId);
    return successEnvelope(adjustment);
  }

  @Post('calculate')
  @RequirePermissions('year_end_adjustment.create')
  async calculate(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const dto = parseWithZod(yearEndAdjustmentCalculateSchema, body);
    const result = await this.service.calculate(tenantId, userId, dto);
    return successEnvelope(result);
  }

  @Post(':id/submit-approval')
  @HttpCode(200)
  @RequirePermissions('year_end_adjustment.create')
  async submitApproval(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(yearEndAdjustmentSubmitApprovalSchema, body ?? {});
    const result = await this.service.submitApproval(tenantId, userId, parsedId, dto);
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
