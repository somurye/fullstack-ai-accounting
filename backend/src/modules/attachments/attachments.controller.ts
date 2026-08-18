import { createReadStream } from 'node:fs';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { ExternalAccessGuard } from '../../common/guards/external-access.guard';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { ATTACHMENT_UPLOAD_MAX_BYTES } from '../../common/http/upload-limits';
import { parseWithZod } from '../../common/validation/zod-parse';
import {
  attachmentLinkCreateSchema,
  attachmentListQuerySchema,
  attachmentUploadSchema,
} from './dto/attachment.schemas';
import { AttachmentsService, type UploadedFileLike } from './attachments.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/**
 * AttachmentsController
 * =======================
 * 電帳法対応の証憑ファイル管理API。検索系(GET)は`ExternalAccessGuard`により
 * 税理士・監査人(viewer_external)の時限アクセスにも対応する。アップロード・
 * 関連付け(POST)は内部ユーザーの操作のみを想定し、当該ガードは適用しない。
 */
@Controller('attachments')
@UseGuards(TenantAuthGuard)
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Get()
  @UseGuards(ExternalAccessGuard)
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(attachmentListQuerySchema, query);
    const { attachments, pagination } = await this.attachmentsService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(attachments, pagination);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: ATTACHMENT_UPLOAD_MAX_BYTES } }))
  async upload(@UploadedFile() file: UploadedFileLike | undefined, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    if (!file) {
      throw AppException.badRequest('fileを指定してください');
    }
    const dto = parseWithZod(attachmentUploadSchema, body);
    const attachment = await this.attachmentsService.upload(tenantId, userId, file, dto);
    return successEnvelope(attachment);
  }

  @Get(':id')
  @UseGuards(ExternalAccessGuard)
  async findOne(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const attachment = await this.attachmentsService.findById(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
    );
    return successEnvelope(attachment);
  }

  /**
   * 電帳法(電子帳簿保存法)のスキャナ保存要件は、保存した証憑を必要に応じて速やかに
   * 可視できることを求める。`Content-Disposition: inline`でブラウザ内プレビュー
   * (画像/PDF)をそのまま可能にする。
   */
  @Get(':id/content')
  @UseGuards(ExternalAccessGuard)
  async content(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const { storagePath, mimeType, fileName } = await this.attachmentsService.getFileContent(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
    );

    res
      .status(200)
      .header('Content-Type', mimeType || 'application/octet-stream')
      .header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);

    const stream = createReadStream(storagePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: '証憑ファイルの実体が見つかりません' },
        });
      } else {
        res.end();
      }
    });
    stream.pipe(res);
  }

  @Post(':id/links')
  async link(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(attachmentLinkCreateSchema, body);
    await this.attachmentsService.link(tenantId, userId, parsedId, dto);
    return successEnvelope({ linked: true });
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
