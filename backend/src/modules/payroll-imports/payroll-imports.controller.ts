import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { CSV_UPLOAD_MAX_BYTES } from '../../common/http/upload-limits';
import { parseWithZod } from '../../common/validation/zod-parse';
import {
  payrollImportCsvFieldsSchema,
  payrollImportListQuerySchema,
} from './dto/payroll-import.schemas';
import { PayrollImportsService, type UploadedFileLike } from './payroll-imports.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/** `docs/openapi.yaml` `tags: [PayrollImports]` を実装する */
@Controller('payroll-imports')
@UseGuards(TenantAuthGuard)
export class PayrollImportsController {
  constructor(private readonly payrollImportsService: PayrollImportsService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(payrollImportListQuerySchema, query);
    const { imports, pagination } = await this.payrollImportsService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(imports, pagination);
  }

  @Post('csv')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: CSV_UPLOAD_MAX_BYTES } }))
  async importCsv(@UploadedFile() file: UploadedFileLike | undefined, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    if (!file) {
      throw AppException.badRequest('fileを指定してください');
    }
    const dto = parseWithZod(payrollImportCsvFieldsSchema, body);
    const result = await this.payrollImportsService.importCsv(tenantId, userId, file, dto);
    return successEnvelope(result);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const record = await this.payrollImportsService.findById(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
    );
    return successEnvelope(record);
  }

  @Post(':id/post')
  async post(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const record = await this.payrollImportsService.post(tenantId, userId, parsedId);
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
