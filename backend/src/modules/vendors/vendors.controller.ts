import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import { vendorCreateSchema } from './dto/vendor.schemas';
import { VendorsService } from './vendors.service';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(200),
  q: z.string().optional(),
});

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/** 仕入先マスタCRUD(`docs/openapi.yaml` `tags: [Vendors]`)。全銀FB振込先情報を含む */
@Controller('vendors')
@UseGuards(TenantAuthGuard)
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(listQuerySchema, query);
    const { vendors, pagination } = await this.vendorsService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(vendors, pagination);
  }

  @Post()
  async create(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const dto = parseWithZod(vendorCreateSchema, body);
    const vendor = await this.vendorsService.create(tenantId, RequestContext.getUserId(), dto);
    return successEnvelope(vendor);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const vendor = await this.vendorsService.findById(tenantId, RequestContext.getUserId(), parsedId);
    return successEnvelope(vendor);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(vendorCreateSchema, body);
    const vendor = await this.vendorsService.update(tenantId, RequestContext.getUserId(), parsedId, dto);
    return successEnvelope(vendor);
  }

  private requireTenantId(): string {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw AppException.unauthorized('テナントコンテキストが確立されていません');
    }
    return tenantId;
  }
}
