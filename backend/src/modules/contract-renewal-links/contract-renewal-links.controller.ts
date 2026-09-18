import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { z } from 'zod';
import { ContractRenewalLinksService } from './contract-renewal-links.service';
import { TenantAuthGuard, type AuthenticatedRequest } from '../../common/guards/tenant-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import {
  createRenewalDealSchema,
  attachQuotationSchema,
} from './dto/contract-renewal-link.schemas';

const idParamSchema = z.string().uuid('IDはUUID形式で指定してください');

@Controller('contract-renewal-links')
@UseGuards(TenantAuthGuard, PermissionsGuard)
export class ContractRenewalLinksController {
  constructor(
    private readonly renewalLinksService: ContractRenewalLinksService,
  ) {}

  /**
   * 契約更新提案の案件作成 (人間による明示的操作)
   */
  @Post('create-deal')
  @RequirePermissions('contract_renewal_link.create')
  @HttpCode(HttpStatus.CREATED)
  async createRenewalDeal(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const tenantId = req.user.tenant_id;
    const userId = req.user.sub;
    const roles = req.user.roles || [];
    const dto = parseWithZod(createRenewalDealSchema, body);
    const result = await this.renewalLinksService.createRenewalDeal(
      tenantId,
      userId,
      roles,
      dto,
    );
    return successEnvelope(result);
  }

  /**
   * 契約更新案件に見積書を紐付ける (NULLから1回限りの設定)
   */
  @Post('attach-quotation')
  @RequirePermissions('contract_renewal_link.create')
  @HttpCode(HttpStatus.OK)
  async attachQuotation(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const tenantId = req.user.tenant_id;
    const userId = req.user.sub;
    const roles = req.user.roles || [];
    const dto = parseWithZod(attachQuotationSchema, body);
    const result = await this.renewalLinksService.attachQuotation(
      tenantId,
      userId,
      roles,
      dto.deal_id,
      dto.quotation_id,
    );
    return successEnvelope(result);
  }

  /**
   * 案件IDから紐づく契約情報を取得 (案件詳細画面からの参照)
   */
  @Get('by-deal/:dealId')
  @RequirePermissions('contract_renewal_link.view')
  async getByDealId(
    @Req() req: AuthenticatedRequest,
    @Param('dealId') dealId: string,
  ) {
    const tenantId = req.user.tenant_id;
    const userId = req.user.sub;
    const roles = req.user.roles || [];
    const parsedDealId = parseWithZod(idParamSchema, dealId);
    const result = await this.renewalLinksService.findByDealId(
      tenantId,
      userId,
      roles,
      parsedDealId,
    );
    return successEnvelope(result);
  }

  /**
   * 契約IDから紐づく案件・見積一覧を取得 (契約詳細画面からの参照)
   */
  @Get('by-contract/:contractId')
  @RequirePermissions('contract_renewal_link.view')
  async getByContractId(
    @Req() req: AuthenticatedRequest,
    @Param('contractId') contractId: string,
  ) {
    const tenantId = req.user.tenant_id;
    const userId = req.user.sub;
    const roles = req.user.roles || [];
    const parsedContractId = parseWithZod(idParamSchema, contractId);
    const result = await this.renewalLinksService.findByContractId(
      tenantId,
      userId,
      roles,
      parsedContractId,
    );
    return successEnvelope(result);
  }
}
