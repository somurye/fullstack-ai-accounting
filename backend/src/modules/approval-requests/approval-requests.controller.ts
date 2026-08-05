import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import { ApprovalRequestsService } from './approval-requests.service';
import {
  approvalRequestApproveSchema,
  approvalRequestListQuerySchema,
  approvalRequestRejectSchema,
} from './dto/approval-request.schemas';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/** 共通承認インボックス(`docs/openapi.yaml` `tags: [ApprovalRequests]`) */
@Controller('approval-requests')
@UseGuards(TenantAuthGuard)
export class ApprovalRequestsController {
  constructor(private readonly approvalRequestsService: ApprovalRequestsService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedQuery = parseWithZod(approvalRequestListQuerySchema, query);
    const { requests, pagination } = await this.approvalRequestsService.list(
      tenantId,
      userId,
      userId,
      parsedQuery,
    );
    return successEnvelope(requests, pagination);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const record = await this.approvalRequestsService.findById(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
    );
    return successEnvelope(record);
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(approvalRequestApproveSchema, body ?? {});
    const record = await this.approvalRequestsService.approve(tenantId, userId, parsedId, dto);
    return successEnvelope(record);
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(approvalRequestRejectSchema, body);
    const record = await this.approvalRequestsService.reject(tenantId, userId, parsedId, dto);
    return successEnvelope(record);
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
