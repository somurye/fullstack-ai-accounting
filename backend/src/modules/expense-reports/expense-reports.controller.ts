import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { OCR_IMAGE_UPLOAD_MAX_BYTES } from '../../common/http/upload-limits';
import { parseWithZod } from '../../common/validation/zod-parse';
import {
  expenseReportApproveSchema,
  expenseReportCreateSchema,
  expenseReportLineCreateSchema,
  expenseReportListQuerySchema,
  expenseReportOcrSchema,
  expenseReportRejectSchema,
} from './dto/expense-report.schemas';
import { ExpenseReportsService } from './expense-reports.service';

interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

const ALLOWED_OCR_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/**
 * ExpenseReportsController
 * =========================
 * 経費精算(expense_reports)のCRUD + 承認/却下アクションを実装する。
 *
 * `docs/openapi.yaml` は承認/却下を汎用の `/approval-requests/{id}/approve|reject`
 * (`tags: [ApprovalRequests]`)として定義しているが、本タスクの指示では
 * `/expense-reports/{id}/approve|reject` という経費精算専用のサブリソースパスが
 * 明示的に要求されているため、そちらを実装する(内部的には共通の
 * `approval_requests`/`approval_history` テーブルを操作しており、
 * `fn_prevent_self_approval` トリガーとの連携もその上で成立する)。
 * 汎用の `/approval-requests` エンドポイント自体は本タスクのスコープ外。
 */
@Controller('expense-reports')
@UseGuards(TenantAuthGuard)
export class ExpenseReportsController {
  constructor(private readonly expenseReportsService: ExpenseReportsService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedQuery = parseWithZod(expenseReportListQuerySchema, query);
    const { reports, pagination } = await this.expenseReportsService.list(
      tenantId,
      userId,
      userId,
      parsedQuery,
    );
    return successEnvelope(reports, pagination);
  }

  @Post()
  async create(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const dto = parseWithZod(expenseReportCreateSchema, body);
    const report = await this.expenseReportsService.create(tenantId, userId, dto);
    return successEnvelope(report);
  }

  @Post('ocr')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: OCR_IMAGE_UPLOAD_MAX_BYTES } }))
  async extractOcr(@UploadedFile() file: UploadedFileLike | undefined, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    if (!file) {
      throw AppException.badRequest('fileを指定してください');
    }
    if (!ALLOWED_OCR_MIME_TYPES.includes(file.mimetype)) {
      throw AppException.badRequest(
        `対応していないファイル形式です(${file.mimetype})。JPEG/PNG/PDF形式でアップロードしてください`,
      );
    }
    const dto = parseWithZod(expenseReportOcrSchema, body);
    const result = await this.expenseReportsService.extractReceiptOcr(tenantId, userId, file, dto);
    return successEnvelope(result);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const report = await this.expenseReportsService.findById(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
    );
    return successEnvelope(report);
  }

  @Post(':id/lines')
  async addLine(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(expenseReportLineCreateSchema, body);
    const line = await this.expenseReportsService.addLine(tenantId, userId, parsedId, dto);
    return successEnvelope(line);
  }

  @Post(':id/approve')
  @HttpCode(200)
  async approve(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(expenseReportApproveSchema, body ?? {});
    const report = await this.expenseReportsService.approve(tenantId, userId, parsedId, dto);
    return successEnvelope(report);
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(expenseReportRejectSchema, body);
    const report = await this.expenseReportsService.reject(tenantId, userId, parsedId, dto);
    return successEnvelope(report);
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
