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
import { BankTransactionsService, type UploadedFileLike } from './bank-transactions.service';
import {
  bankTransactionImportCsvFieldsSchema,
  bankTransactionListQuerySchema,
  bankTransactionMatchSchema,
} from './dto/bank-transaction.schemas';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/** `docs/openapi.yaml` `tags: [BankTransactions]` を実装する */
@Controller('bank-transactions')
@UseGuards(TenantAuthGuard)
export class BankTransactionsController {
  constructor(private readonly bankTransactionsService: BankTransactionsService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(bankTransactionListQuerySchema, query);
    const { transactions, pagination } = await this.bankTransactionsService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(transactions, pagination);
  }

  @Post('import-csv')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: CSV_UPLOAD_MAX_BYTES } }))
  async importCsv(@UploadedFile() file: UploadedFileLike | undefined, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    if (!file) {
      throw AppException.badRequest('fileを指定してください');
    }
    const dto = parseWithZod(bankTransactionImportCsvFieldsSchema, body);
    const result = await this.bankTransactionsService.importCsv(tenantId, userId, file, dto);
    return successEnvelope(result);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const transaction = await this.bankTransactionsService.findById(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
    );
    return successEnvelope(transaction);
  }

  @Post(':id/match')
  async match(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(bankTransactionMatchSchema, body ?? {});
    const transaction = await this.bankTransactionsService.match(tenantId, userId, parsedId, dto);
    return successEnvelope(transaction);
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
