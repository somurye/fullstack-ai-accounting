import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import { taxCategoryCreateSchema } from './dto/tax-category.schemas';
import { TaxCategoriesService } from './tax-categories.service';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(200),
});

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/** 税区分マスタCRUD(`docs/openapi.yaml` `tags: [TaxCategories]`) */
@Controller('tax-categories')
@UseGuards(TenantAuthGuard)
export class TaxCategoriesController {
  constructor(private readonly taxCategoriesService: TaxCategoriesService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(listQuerySchema, query);
    const { taxCategories, pagination } = await this.taxCategoriesService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(taxCategories, pagination);
  }

  @Post()
  async create(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const dto = parseWithZod(taxCategoryCreateSchema, body);
    const taxCategory = await this.taxCategoriesService.create(tenantId, RequestContext.getUserId(), dto);
    return successEnvelope(taxCategory);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const taxCategory = await this.taxCategoriesService.findById(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
    );
    return successEnvelope(taxCategory);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(taxCategoryCreateSchema, body);
    const taxCategory = await this.taxCategoriesService.update(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
      dto,
    );
    return successEnvelope(taxCategory);
  }

  private requireTenantId(): string {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw AppException.unauthorized('テナントコンテキストが確立されていません');
    }
    return tenantId;
  }
}
