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
  contractCreateSchema,
  contractListQuerySchema,
  contractUpdateSchema,
  extractContractTermsSchema,
} from './dto/contract.schemas';
import { ContractsService } from './contracts.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/**
 * ContractsController
 * ===================
 * 契約書管理 API (`/contracts`) のコントローラー。
 * DEBT-005: PermissionsGuard により細粒度RBAC (contract.*) を明示的に認可強制。
 */
@Controller('contracts')
@UseGuards(TenantAuthGuard, PermissionsGuard)
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Get()
  @RequirePermissions('contract.view')
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(contractListQuerySchema, query);
    const { contracts, pagination } = await this.contractsService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(contracts, pagination);
  }

  @Post('extract-terms')
  @RequirePermissions('contract.create')
  async extractTerms(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const dto = parseWithZod(extractContractTermsSchema, body);
    const suggestion = await this.contractsService.extractTerms(tenantId, userId, dto);
    return successEnvelope(suggestion);
  }

  @Post()
  @RequirePermissions('contract.create')
  async create(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const dto = parseWithZod(contractCreateSchema, body);
    const contract = await this.contractsService.create(tenantId, userId, dto);
    return successEnvelope(contract);
  }

  @Get(':id')
  @RequirePermissions('contract.view')
  async getById(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const contract = await this.contractsService.getById(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
    );
    return successEnvelope(contract);
  }

  @Put(':id')
  @RequirePermissions('contract.edit')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(contractUpdateSchema, body);
    const contract = await this.contractsService.update(tenantId, userId, parsedId, dto);
    return successEnvelope(contract);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('contract.edit')
  async delete(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    await this.contractsService.delete(tenantId, userId, parsedId);
  }

  @Post(':id/submit-approval')
  @HttpCode(200)
  @RequirePermissions('contract.create', 'contract.edit')
  async submitForApproval(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const contract = await this.contractsService.submitForApproval(
      tenantId,
      userId,
      parsedId,
    );
    return successEnvelope(contract);
  }

  @Post(':id/terminate')
  @HttpCode(200)
  @RequirePermissions('contract.terminate')
  async terminate(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const contract = await this.contractsService.terminate(
      tenantId,
      userId,
      parsedId,
    );
    return successEnvelope(contract);
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
