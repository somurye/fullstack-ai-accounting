import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import {
  payrollImportMappingCreateSchema,
  payrollImportMappingListQuerySchema,
} from './dto/payroll-import-mapping.schemas';
import { PayrollImportMappingsService } from './payroll-import-mappings.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/** 給与CSV取込マッピング設定CRUD(`docs/openapi.yaml` `tags: [PayrollImports]`) */
@Controller('payroll-import-mappings')
@UseGuards(TenantAuthGuard)
export class PayrollImportMappingsController {
  constructor(private readonly mappingsService: PayrollImportMappingsService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(payrollImportMappingListQuerySchema, query);
    const { mappings, pagination } = await this.mappingsService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(mappings, pagination);
  }

  @Post()
  async create(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const dto = parseWithZod(payrollImportMappingCreateSchema, body);
    const mapping = await this.mappingsService.create(tenantId, RequestContext.getUserId(), dto);
    return successEnvelope(mapping);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(payrollImportMappingCreateSchema, body);
    const mapping = await this.mappingsService.update(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
      dto,
    );
    return successEnvelope(mapping);
  }

  private requireTenantId(): string {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw AppException.unauthorized('テナントコンテキストが確立されていません');
    }
    return tenantId;
  }
}
