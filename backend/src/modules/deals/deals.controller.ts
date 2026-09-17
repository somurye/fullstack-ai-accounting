import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { z } from 'zod';
import { DealsService } from './deals.service';
import { TenantAuthGuard, type AuthenticatedRequest } from '../../common/guards/tenant-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import {
  createDealSchema,
  updateDealSchema,
  closeDealSchema,
  dealListQuerySchema,
} from './dto/deal.schemas';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

@Controller('deals')
@UseGuards(TenantAuthGuard, PermissionsGuard)
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  /**
   * 案件一覧取得
   */
  @Get()
  @RequirePermissions('deal.view')
  async list(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    const tenantId = req.user.tenant_id;
    const userId = req.user.sub;
    const roles = req.user.roles || [];
    const parsedQuery = parseWithZod(dealListQuerySchema, query);
    const { deals, pagination } = await this.dealsService.list(
      tenantId,
      userId,
      roles,
      parsedQuery,
    );
    return successEnvelope(deals, pagination);
  }

  /**
   * 案件詳細取得
   */
  @Get(':id')
  @RequirePermissions('deal.view')
  async findById(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const tenantId = req.user.tenant_id;
    const userId = req.user.sub;
    const roles = req.user.roles || [];
    const parsedId = parseWithZod(idParamSchema, id);
    const deal = await this.dealsService.findById(tenantId, userId, roles, parsedId);
    return successEnvelope(deal);
  }

  /**
   * 案件新規作成
   */
  @Post()
  @RequirePermissions('deal.create')
  @HttpCode(HttpStatus.CREATED)
  async create(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const tenantId = req.user.tenant_id;
    const userId = req.user.sub;
    const roles = req.user.roles || [];
    const dto = parseWithZod(createDealSchema, body);
    const deal = await this.dealsService.create(tenantId, userId, roles, dto);
    return successEnvelope(deal);
  }

  /**
   * 案件更新 (進行中ステージのみ)
   */
  @Patch(':id')
  @RequirePermissions('deal.edit')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const tenantId = req.user.tenant_id;
    const userId = req.user.sub;
    const roles = req.user.roles || [];
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(updateDealSchema, body);
    const deal = await this.dealsService.update(tenantId, userId, roles, parsedId, dto);
    return successEnvelope(deal);
  }

  /**
   * 案件クローズ (won / lost 確定)
   */
  @Post(':id/close')
  @RequirePermissions('deal.close')
  @HttpCode(HttpStatus.OK)
  async close(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const tenantId = req.user.tenant_id;
    const userId = req.user.sub;
    const roles = req.user.roles || [];
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(closeDealSchema, body);
    const deal = await this.dealsService.close(tenantId, userId, roles, parsedId, dto);
    return successEnvelope(deal);
  }

  /**
   * 案件削除
   */
  @Delete(':id')
  @RequirePermissions('deal.edit')
  @HttpCode(HttpStatus.OK)
  async delete(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const tenantId = req.user.tenant_id;
    const userId = req.user.sub;
    const roles = req.user.roles || [];
    const parsedId = parseWithZod(idParamSchema, id);
    const result = await this.dealsService.delete(tenantId, userId, roles, parsedId);
    return successEnvelope(result);
  }
}
