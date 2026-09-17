import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import {
  quotationCreateSchema,
  quotationListQuerySchema,
  quotationReviseSchema,
  quotationUpdateSchema,
} from './dto/quotation.schemas';
import { QuotationsService } from './quotations.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

@Controller('quotations')
@UseGuards(TenantAuthGuard, PermissionsGuard)
export class QuotationsController {
  constructor(private readonly quotationsService: QuotationsService) {}

  @Get()
  @RequirePermissions('quotation.view')
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedQuery = parseWithZod(quotationListQuerySchema, query);
    const { quotations, pagination } = await this.quotationsService.list(
      tenantId,
      userId,
      parsedQuery,
    );
    return successEnvelope(quotations, pagination);
  }

  @Post()
  @RequirePermissions('quotation.create')
  async create(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const dto = parseWithZod(quotationCreateSchema, body);
    const quotation = await this.quotationsService.create(tenantId, userId, dto);
    return successEnvelope(quotation);
  }

  @Get(':id')
  @RequirePermissions('quotation.view')
  async findOne(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const quotation = await this.quotationsService.findById(tenantId, userId, parsedId);
    return successEnvelope(quotation);
  }

  @Patch(':id')
  @RequirePermissions('quotation.edit')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(quotationUpdateSchema, body);
    const quotation = await this.quotationsService.update(tenantId, userId, parsedId, dto);
    return successEnvelope(quotation);
  }

  @Delete(':id')
  @RequirePermissions('quotation.edit')
  async delete(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    await this.quotationsService.delete(tenantId, userId, parsedId);
    return successEnvelope({ success: true, deletedId: parsedId });
  }

  @Post(':id/send')
  @HttpCode(200)
  @RequirePermissions('quotation.send')
  async send(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const quotation = await this.quotationsService.send(tenantId, userId, parsedId);
    return successEnvelope(quotation);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @RequirePermissions('quotation.convert')
  async accept(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const quotation = await this.quotationsService.accept(tenantId, userId, parsedId);
    return successEnvelope(quotation);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions('quotation.send')
  async reject(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const quotation = await this.quotationsService.reject(tenantId, userId, parsedId);
    return successEnvelope(quotation);
  }

  @Post(':id/revise')
  @HttpCode(200)
  @RequirePermissions('quotation.send')
  async revise(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(quotationReviseSchema, body);
    const newQuotation = await this.quotationsService.revise(tenantId, userId, parsedId, dto);
    return successEnvelope(newQuotation);
  }

  @Post(':id/convert')
  @HttpCode(200)
  @RequirePermissions('quotation.convert')
  async convert(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const result = await this.quotationsService.convert(tenantId, userId, parsedId);
    return successEnvelope(result);
  }

  @Get(':id/pdf')
  @RequirePermissions('quotation.view')
  async downloadPdf(@Param('id') id: string, @Res() res: Response) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const { buffer, filename } = await this.quotationsService.getPdf(tenantId, userId, parsedId);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  private requireTenantId(): string {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw AppException.badRequest('テナントコンテキストが存在しません');
    }
    return tenantId;
  }

  private requireUserId(): string {
    const userId = RequestContext.getUserId();
    if (!userId) {
      throw AppException.badRequest('ユーザーコンテキストが存在しません');
    }
    return userId;
  }
}
