import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import {
  vendorBillCreateSchema,
  vendorBillListQuerySchema,
  vendorBillPaymentCreateSchema,
} from './dto/vendor-bill.schemas';
import { VendorBillsService } from './vendor-bills.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/**
 * VendorBillsController
 * ======================
 * `docs/openapi.yaml` の `tags: [VendorBills]` に定義されたエンドポイントを実装する。
 */
@Controller('vendor-bills')
@UseGuards(TenantAuthGuard)
export class VendorBillsController {
  constructor(private readonly vendorBillsService: VendorBillsService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(vendorBillListQuerySchema, query);
    const { vendorBills, pagination } = await this.vendorBillsService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(vendorBills, pagination);
  }

  @Post()
  async create(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const dto = parseWithZod(vendorBillCreateSchema, body);
    const vendorBill = await this.vendorBillsService.create(tenantId, userId, dto);
    return successEnvelope(vendorBill);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const vendorBill = await this.vendorBillsService.findById(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
    );
    return successEnvelope(vendorBill);
  }

  @Post(':id/submit')
  @HttpCode(200)
  async submit(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const vendorBill = await this.vendorBillsService.submit(tenantId, userId, parsedId);
    return successEnvelope(vendorBill);
  }

  @Get(':id/payments')
  async listPayments(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const payments = await this.vendorBillsService.listPayments(
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
    const dto = parseWithZod(vendorBillPaymentCreateSchema, body);
    const payment = await this.vendorBillsService.recordPayment(tenantId, userId, parsedId, dto);
    return successEnvelope(payment);
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
