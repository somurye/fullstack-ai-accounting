import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { type AuthenticatedRequest, TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import {
  externalAccessGrantCreateSchema,
  externalAccessGrantListQuerySchema,
} from './dto/external-access-grant.schemas';
import { ExternalAccessGrantsService } from './external-access-grants.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/** 時限アクセス許可を発行できるロール(openapi.yaml: "owner/accounting_managerのみ") */
const GRANT_ISSUER_ROLES = ['owner', 'accounting_manager'];

@Controller('external-access-grants')
@UseGuards(TenantAuthGuard)
export class ExternalAccessGrantsController {
  constructor(private readonly externalAccessGrantsService: ExternalAccessGrantsService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(externalAccessGrantListQuerySchema, query);
    const { grants, pagination } = await this.externalAccessGrantsService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(grants, pagination);
  }

  @Post()
  async create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const roles = req.user?.roles ?? [];
    if (!roles.some((role) => GRANT_ISSUER_ROLES.includes(role))) {
      throw AppException.forbidden(
        '時限アクセス許可の発行は owner または accounting_manager ロールのみ実行できます',
      );
    }
    const dto = parseWithZod(externalAccessGrantCreateSchema, body);
    const grant = await this.externalAccessGrantsService.create(tenantId, userId, dto);
    return successEnvelope(grant);
  }

  @Post(':id/revoke')
  async revoke(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const grant = await this.externalAccessGrantsService.revoke(tenantId, userId, parsedId);
    return successEnvelope(grant);
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
