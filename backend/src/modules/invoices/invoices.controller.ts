import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import {
  creditNoteCreateSchema,
  invoiceCreateSchema,
  invoiceListQuerySchema,
  invoicePaymentCreateSchema,
} from './dto/invoice.schemas';
import { InvoicesService } from './invoices.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/**
 * InvoicesController
 * ===================
 * `docs/openapi.yaml` の `tags: [Invoices]` に定義されたエンドポイントを実装する。
 */
@Controller('invoices')
@UseGuards(TenantAuthGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(invoiceListQuerySchema, query);
    const { invoices, pagination } = await this.invoicesService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(invoices, pagination);
  }

  @Post()
  async create(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const dto = parseWithZod(invoiceCreateSchema, body);
    const invoice = await this.invoicesService.create(tenantId, userId, dto);
    return successEnvelope(invoice);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const invoice = await this.invoicesService.findById(tenantId, RequestContext.getUserId(), parsedId);
    return successEnvelope(invoice);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(invoiceCreateSchema, body);
    const invoice = await this.invoicesService.update(tenantId, userId, parsedId, dto);
    return successEnvelope(invoice);
  }

  @Post(':id/issue')
  @HttpCode(200)
  async issue(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const invoice = await this.invoicesService.issue(tenantId, userId, parsedId);
    return successEnvelope(invoice);
  }

  @Get(':id/payments')
  async listPayments(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const payments = await this.invoicesService.listPayments(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
    );
    return successEnvelope(payments);
  }

  @Post(':id/payments')
  async recordPayment(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(invoicePaymentCreateSchema, body);
    const payment = await this.invoicesService.recordPayment(tenantId, userId, parsedId, dto);
    return successEnvelope(payment);
  }

  @Post(':id/void')
  @HttpCode(200)
  async voidInvoice(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const invoice = await this.invoicesService.voidInvoice(tenantId, userId, parsedId);
    return successEnvelope(invoice);
  }

  @Post(':id/credit-notes')
  async createCreditNote(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(creditNoteCreateSchema, body);
    const creditNote = await this.invoicesService.createCreditNote(tenantId, userId, parsedId, dto);
    return successEnvelope(creditNote);
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
