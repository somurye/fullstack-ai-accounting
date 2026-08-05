import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import { CustomersService } from './customers.service';
import { customerCreateSchema } from './dto/customer.schemas';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(200),
  q: z.string().optional(),
});

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/** 顧客マスタCRUD(`docs/openapi.yaml` `tags: [Customers]`) */
@Controller('customers')
@UseGuards(TenantAuthGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(listQuerySchema, query);
    const { customers, pagination } = await this.customersService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(customers, pagination);
  }

  @Post()
  async create(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const dto = parseWithZod(customerCreateSchema, body);
    const customer = await this.customersService.create(tenantId, RequestContext.getUserId(), dto);
    return successEnvelope(customer);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const customer = await this.customersService.findById(tenantId, RequestContext.getUserId(), parsedId);
    return successEnvelope(customer);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(customerCreateSchema, body);
    const customer = await this.customersService.update(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
      dto,
    );
    return successEnvelope(customer);
  }

  private requireTenantId(): string {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw AppException.unauthorized('テナントコンテキストが確立されていません');
    }
    return tenantId;
  }
}
