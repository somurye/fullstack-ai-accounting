import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import {
  consumptionTaxReturnCreateSchema,
  consumptionTaxReturnListQuerySchema,
} from './dto/consumption-tax-return.schemas';
import { ConsumptionTaxReturnsService } from './consumption-tax-returns.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/**
 * ConsumptionTaxReturnsController
 * =================================
 * `docs/openapi.yaml` の `tags: [ConsumptionTaxReturns]` に定義されたエンドポイントを実装する。
 */
@Controller('consumption-tax-returns')
@UseGuards(TenantAuthGuard)
export class ConsumptionTaxReturnsController {
  constructor(private readonly consumptionTaxReturnsService: ConsumptionTaxReturnsService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(consumptionTaxReturnListQuerySchema, query);
    const { returns, pagination } = await this.consumptionTaxReturnsService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(returns, pagination);
  }

  @Post()
  async create(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const dto = parseWithZod(consumptionTaxReturnCreateSchema, body);
    const taxReturn = await this.consumptionTaxReturnsService.create(tenantId, userId, dto);
    return successEnvelope(taxReturn);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const taxReturn = await this.consumptionTaxReturnsService.findById(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
    );
    return successEnvelope(taxReturn);
  }

  @Post(':id/calculate')
  @HttpCode(200)
  async calculate(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const taxReturn = await this.consumptionTaxReturnsService.calculate(tenantId, userId, parsedId);
    return successEnvelope(taxReturn);
  }

  @Post(':id/finalize')
  @HttpCode(200)
  async finalize(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const taxReturn = await this.consumptionTaxReturnsService.finalize(tenantId, userId, parsedId);
    return successEnvelope(taxReturn);
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
