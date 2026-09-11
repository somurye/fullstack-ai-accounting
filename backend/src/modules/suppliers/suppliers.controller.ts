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
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import {
  supplierCreateSchema,
  supplierListQuerySchema,
  supplierUpdateSchema,
} from './dto/supplier.schemas';
import { SuppliersService } from './suppliers.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

@Controller('suppliers')
@UseGuards(TenantAuthGuard, PermissionsGuard)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  private requireTenantId(): string {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw AppException.unauthorized('テナントIDが特定できません');
    }
    return tenantId;
  }

  private requireUserId(): string {
    const userId = RequestContext.getUserId();
    if (!userId) {
      throw AppException.unauthorized('ユーザー認証が必要です');
    }
    return userId;
  }

  @Get()
  @RequirePermissions('supplier.view')
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(supplierListQuerySchema, query);
    const { suppliers, pagination } = await this.suppliersService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(suppliers, pagination);
  }

  @Get(':id')
  @RequirePermissions('supplier.view')
  async getById(@Param('id') idParam: unknown) {
    const tenantId = this.requireTenantId();
    const id = parseWithZod(idParamSchema, idParam);
    const supplier = await this.suppliersService.getById(
      tenantId,
      RequestContext.getUserId(),
      id,
    );
    return successEnvelope(supplier);
  }

  @Post()
  @RequirePermissions('supplier.create')
  async create(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedInput = parseWithZod(supplierCreateSchema, body);
    const created = await this.suppliersService.create(tenantId, userId, parsedInput);
    return successEnvelope(created);
  }

  @Put(':id')
  @RequirePermissions('supplier.edit')
  async update(
    @Param('id') idParam: unknown,
    @Body() body: unknown,
  ) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const id = parseWithZod(idParamSchema, idParam);
    const parsedInput = parseWithZod(supplierUpdateSchema, body);
    const updated = await this.suppliersService.update(tenantId, userId, id, parsedInput);
    return successEnvelope(updated);
  }
}
