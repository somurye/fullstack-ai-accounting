import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import { payslipCreateSchema, payslipListQuerySchema } from './dto/payslip.schemas';
import { PayslipsService } from './payslips.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

@Controller('payslips')
@UseGuards(TenantAuthGuard, PermissionsGuard)
export class PayslipsController {
  constructor(private readonly payslipsService: PayslipsService) {}

  @Get()
  @RequirePermissions('payslip.view')
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedQuery = parseWithZod(payslipListQuerySchema, query);
    const { payslips, pagination } = await this.payslipsService.list(tenantId, userId, parsedQuery);
    return successEnvelope(payslips, pagination);
  }

  @Get(':id')
  @RequirePermissions('payslip.view')
  async findOne(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const payslip = await this.payslipsService.findById(tenantId, userId, parsedId);
    return successEnvelope(payslip);
  }

  @Post()
  @RequirePermissions('payslip.create')
  async create(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const dto = parseWithZod(payslipCreateSchema, body);
    const payslip = await this.payslipsService.create(tenantId, userId, dto);
    return successEnvelope(payslip);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @RequirePermissions('payslip.create')
  async confirm(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const payslip = await this.payslipsService.confirm(tenantId, userId, parsedId);
    return successEnvelope(payslip);
  }

  @Get(':id/pdf')
  @RequirePermissions('payslip.view')
  async downloadPdf(@Param('id') id: string, @Res() res: Response) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const { buffer, filename } = await this.payslipsService.getPdf(tenantId, userId, parsedId);

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
