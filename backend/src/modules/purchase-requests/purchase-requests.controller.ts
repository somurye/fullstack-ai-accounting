import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
  createPurchaseRequestSchema,
  purchaseRequestListQuerySchema,
  updatePurchaseRequestSchema,
  createPurchaseReceiptSchema,
  linkVendorBillSchema,
} from './dto/purchase-request.schemas';
import { PurchaseRequestsService } from './purchase-requests.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/**
 * PurchaseRequestsController
 * ==========================
 * 発注申請管理 API (`/purchase-requests`) のコントローラー。
 * PermissionsGuard により細粒度RBAC (purchase_request.*) を明示的に認可強制。
 */
@Controller('purchase-requests')
@UseGuards(TenantAuthGuard, PermissionsGuard)
export class PurchaseRequestsController {
  constructor(private readonly service: PurchaseRequestsService) {}

  @Get()
  @RequirePermissions('purchase_request.view')
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(purchaseRequestListQuerySchema, query);
    const { purchaseRequests, pagination } = await this.service.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(purchaseRequests, pagination);
  }

  @Get(':id')
  @RequirePermissions('purchase_request.view')
  async getById(@Param('id') idParam: unknown) {
    const tenantId = this.requireTenantId();
    const id = parseWithZod(idParamSchema, idParam);
    const detail = await this.service.getById(tenantId, RequestContext.getUserId(), id);
    return successEnvelope(detail);
  }

  @Post()
  @RequirePermissions('purchase_request.create')
  async create(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const dto = parseWithZod(createPurchaseRequestSchema, body);
    const created = await this.service.create(tenantId, userId, dto);
    return successEnvelope(created);
  }

  @Put(':id')
  @RequirePermissions('purchase_request.edit')
  async update(@Param('id') idParam: unknown, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const id = parseWithZod(idParamSchema, idParam);
    const dto = parseWithZod(updatePurchaseRequestSchema, body);
    const updated = await this.service.update(tenantId, userId, id, dto);
    return successEnvelope(updated);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('purchase_request.edit')
  async delete(@Param('id') idParam: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const id = parseWithZod(idParamSchema, idParam);
    await this.service.delete(tenantId, userId, id);
  }

  @Post(':id/submit')
  @RequirePermissions('purchase_request.create')
  async submitForApproval(@Param('id') idParam: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const id = parseWithZod(idParamSchema, idParam);
    const result = await this.service.submitForApproval(tenantId, userId, id);
    return successEnvelope(result);
  }

  @Post(':id/terminate')
  @RequirePermissions('purchase_request.terminate')
  async terminate(@Param('id') idParam: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const id = parseWithZod(idParamSchema, idParam);
    const result = await this.service.terminate(tenantId, userId, id);
    return successEnvelope(result);
  }

  @Post(':id/receipts')
  @RequirePermissions('purchase_request.receive')
  async addReceipt(@Param('id') idParam: unknown, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const id = parseWithZod(idParamSchema, idParam);
    const dto = parseWithZod(createPurchaseReceiptSchema, body);
    const result = await this.service.addReceipt(tenantId, userId, id, dto);
    return successEnvelope(result);
  }

  @Get(':id/receipts')
  @RequirePermissions('purchase_request.view')
  async listReceipts(@Param('id') idParam: unknown) {
    const tenantId = this.requireTenantId();
    const id = parseWithZod(idParamSchema, idParam);
    const receipts = await this.service.listReceipts(tenantId, RequestContext.getUserId(), id);
    return successEnvelope(receipts);
  }

  @Post(':id/link-bill')
  @RequirePermissions('purchase_request.link_bill')
  async linkVendorBill(@Param('id') idParam: unknown, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const id = parseWithZod(idParamSchema, idParam);
    const dto = parseWithZod(linkVendorBillSchema, body);
    await this.service.linkVendorBill(tenantId, userId, id, dto);
    return successEnvelope({ success: true });
  }

  @Delete(':id/link-bill/:vendorBillId')
  @HttpCode(204)
  @RequirePermissions('purchase_request.link_bill')
  async unlinkVendorBill(
    @Param('id') idParam: unknown,
    @Param('vendorBillId') vendorBillIdParam: unknown,
  ) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const id = parseWithZod(idParamSchema, idParam);
    const vendorBillId = parseWithZod(idParamSchema, vendorBillIdParam);
    await this.service.unlinkVendorBill(tenantId, userId, id, vendorBillId);
  }

  private requireTenantId(): string {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw AppException.unauthorized('テナントコンテキストが必要です');
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
}
