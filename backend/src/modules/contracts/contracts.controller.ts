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
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import {
  contractCreateSchema,
  contractListQuerySchema,
  contractUpdateSchema,
} from './dto/contract.schemas';
import { ContractsService } from './contracts.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/**
 * ContractsController
 * ===================
 * 契約書管理 API (`/contracts`) のコントローラー。
 */
@Controller('contracts')
@UseGuards(TenantAuthGuard)
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Get()
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

  @Post()
  async create(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const dto = parseWithZod(contractCreateSchema, body);
    const contract = await this.contractsService.create(tenantId, userId, dto);
    return successEnvelope(contract);
  }

  @Get(':id')
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
  async delete(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    await this.contractsService.delete(tenantId, userId, parsedId);
  }

  @Post(':id/submit-approval')
  @HttpCode(200)
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
