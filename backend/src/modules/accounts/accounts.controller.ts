import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import { AccountsService } from './accounts.service';
import { accountCreateSchema, accountUpdateSchema } from './dto/account.schemas';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(200),
  account_type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']).optional(),
  is_active: z.coerce.boolean().optional(),
});

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/** 勘定科目マスタCRUD(`docs/openapi.yaml` `tags: [Accounts]`) */
@Controller('accounts')
@UseGuards(TenantAuthGuard)
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(listQuerySchema, query);
    const { accounts, pagination } = await this.accountsService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(accounts, pagination);
  }

  @Post()
  async create(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const dto = parseWithZod(accountCreateSchema, body);
    const account = await this.accountsService.create(tenantId, RequestContext.getUserId(), dto);
    return successEnvelope(account);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const account = await this.accountsService.findById(tenantId, RequestContext.getUserId(), parsedId);
    return successEnvelope(account);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(accountUpdateSchema, body);
    const account = await this.accountsService.update(tenantId, RequestContext.getUserId(), parsedId, dto);
    return successEnvelope(account);
  }

  private requireTenantId(): string {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw AppException.unauthorized('テナントコンテキストが確立されていません');
    }
    return tenantId;
  }
}
