import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import { BankAccountsService } from './bank-accounts.service';
import { bankAccountCreateSchema, bankAccountListQuerySchema } from './dto/bank-account.schemas';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/** 銀行口座マスタCRUD(`docs/openapi.yaml` `tags: [BankAccounts]`) */
@Controller('bank-accounts')
@UseGuards(TenantAuthGuard)
export class BankAccountsController {
  constructor(private readonly bankAccountsService: BankAccountsService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(bankAccountListQuerySchema, query);
    const { bankAccounts, pagination } = await this.bankAccountsService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(bankAccounts, pagination);
  }

  @Post()
  async create(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const dto = parseWithZod(bankAccountCreateSchema, body);
    const bankAccount = await this.bankAccountsService.create(tenantId, RequestContext.getUserId(), dto);
    return successEnvelope(bankAccount);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const bankAccount = await this.bankAccountsService.findById(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
    );
    return successEnvelope(bankAccount);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(bankAccountCreateSchema, body);
    const bankAccount = await this.bankAccountsService.update(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
      dto,
    );
    return successEnvelope(bankAccount);
  }

  private requireTenantId(): string {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw AppException.unauthorized('テナントコンテキストが確立されていません');
    }
    return tenantId;
  }
}
