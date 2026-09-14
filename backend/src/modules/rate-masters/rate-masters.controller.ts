import {
  Body,
  Controller,
  Get,
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
import { successEnvelope, buildPagination } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import {
  insuranceRateCreateSchema,
  insuranceRateUpdateSchema,
  insuranceRateListQuerySchema,
  insuranceRateEffectiveQuerySchema,
  taxBracketCreateSchema,
  taxBracketBulkCreateSchema,
  taxBracketUpdateSchema,
  taxBracketListQuerySchema,
  taxBracketEffectiveQuerySchema,
} from './dto/rate-masters.schemas';
import { RateMastersService } from './rate-masters.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

@Controller('rate-masters')
@UseGuards(TenantAuthGuard, PermissionsGuard)
export class RateMastersController {
  constructor(private readonly rateMastersService: RateMastersService) {}

  private requireTenantId(): string {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw AppException.unauthorized('テナントIDが特定できません');
    }
    return tenantId;
  }

  // ==========================================================================
  // 社会保険料率マスタ (insurance)
  // ==========================================================================

  @Get('insurance/effective')
  @RequirePermissions('rate_master.view')
  async getEffectiveInsuranceRate(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const userId = RequestContext.getUserId();
    const parsedQuery = parseWithZod(insuranceRateEffectiveQuerySchema, query);
    const item = await this.rateMastersService.getEffectiveInsuranceRate(
      tenantId,
      userId,
      parsedQuery,
    );
    return successEnvelope(item);
  }

  @Get('insurance')
  @RequirePermissions('rate_master.view')
  async listInsuranceRates(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const userId = RequestContext.getUserId();
    const parsedQuery = parseWithZod(insuranceRateListQuerySchema, query);
    const { items, total, page, limit } = await this.rateMastersService.listInsuranceRates(
      tenantId,
      userId,
      parsedQuery,
    );
    return successEnvelope(items, buildPagination(page, limit, total));
  }

  @Post('insurance')
  @RequirePermissions('rate_master.create')
  async createInsuranceRate(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = RequestContext.getUserId();
    const input = parseWithZod(insuranceRateCreateSchema, body);
    const created = await this.rateMastersService.createInsuranceRate(tenantId, userId, input);
    return successEnvelope(created);
  }

  @Put('insurance/:id')
  @RequirePermissions('rate_master.edit')
  async updateInsuranceRate(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = RequestContext.getUserId();
    const validId = parseWithZod(idParamSchema, id);
    const input = parseWithZod(insuranceRateUpdateSchema, body);
    const updated = await this.rateMastersService.updateInsuranceRate(
      tenantId,
      userId,
      validId,
      input,
    );
    return successEnvelope(updated);
  }

  // ==========================================================================
  // 所得税源泉徴収税額表 (tax-brackets)
  // ==========================================================================

  @Get('tax-brackets/effective')
  @RequirePermissions('rate_master.view')
  async getEffectiveTaxBracket(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const userId = RequestContext.getUserId();
    const parsedQuery = parseWithZod(taxBracketEffectiveQuerySchema, query);
    const item = await this.rateMastersService.getEffectiveTaxAmount(
      tenantId,
      userId,
      parsedQuery,
    );
    return successEnvelope(item);
  }

  @Get('tax-brackets')
  @RequirePermissions('rate_master.view')
  async listTaxBrackets(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const userId = RequestContext.getUserId();
    const parsedQuery = parseWithZod(taxBracketListQuerySchema, query);
    const { items, total, page, limit } = await this.rateMastersService.listTaxBrackets(
      tenantId,
      userId,
      parsedQuery,
    );
    return successEnvelope(items, buildPagination(page, limit, total));
  }

  @Post('tax-brackets/bulk')
  @RequirePermissions('rate_master.create')
  async bulkCreateTaxBrackets(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = RequestContext.getUserId();
    const input = parseWithZod(taxBracketBulkCreateSchema, body);
    const createdItems = await this.rateMastersService.bulkCreateTaxBrackets(
      tenantId,
      userId,
      input,
    );
    return successEnvelope(createdItems);
  }

  @Post('tax-brackets')
  @RequirePermissions('rate_master.create')
  async createTaxBracket(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = RequestContext.getUserId();
    const input = parseWithZod(taxBracketCreateSchema, body);
    const created = await this.rateMastersService.createTaxBracket(tenantId, userId, input);
    return successEnvelope(created);
  }

  @Put('tax-brackets/:id')
  @RequirePermissions('rate_master.edit')
  async updateTaxBracket(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = RequestContext.getUserId();
    const validId = parseWithZod(idParamSchema, id);
    const input = parseWithZod(taxBracketUpdateSchema, body);
    const updated = await this.rateMastersService.updateTaxBracket(
      tenantId,
      userId,
      validId,
      input,
    );
    return successEnvelope(updated);
  }
}
