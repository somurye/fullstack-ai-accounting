import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import { encodeZenginContentToShiftJis } from '../../common/zengin/zengin-format';
import { exportZenginSchema, paymentBatchListQuerySchema } from './dto/payment-batch.schemas';
import { PaymentBatchesService } from './payment-batches.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/**
 * PaymentBatchesController
 * =========================
 * `docs/openapi.yaml` の `tags: [PaymentBatches]` に定義されたエンドポイントを実装する。
 * `GET /payment-batches/:id/download` はopenapi.yamlには明示されていないが、
 * export-zengin応答の `download_url` フィールド・フロントエンドの「ダウンロード/再ダウンロード」
 * 要件を満たすために必要な実体として追加する。
 */
@Controller('payment-batches')
@UseGuards(TenantAuthGuard)
export class PaymentBatchesController {
  constructor(private readonly paymentBatchesService: PaymentBatchesService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(paymentBatchListQuerySchema, query);
    const { paymentBatches, pagination } = await this.paymentBatchesService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(paymentBatches, pagination);
  }

  @Post('export-zengin')
  async exportZengin(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const dto = parseWithZod(exportZenginSchema, body);
    const batch = await this.paymentBatchesService.exportZengin(tenantId, userId, dto);
    return successEnvelope(batch);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const batch = await this.paymentBatchesService.findById(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
    );
    return successEnvelope(batch);
  }

  /**
   * 全銀協仕様は提出データがShift-JISであることを前提とするため、生成したテキストを
   * `encodeZenginContentToShiftJis()`でバイト列へ変換して返す
   * (`?encoding=utf8`指定時のみ、内容確認・デバッグ用にUTF-8のまま返す)。
   */
  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @Query('encoding') encoding: string | undefined,
    @Res() res: Response,
  ) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const { batchNo, content } = await this.paymentBatchesService.downloadZenginFile(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
    );

    const useUtf8 = encoding === 'utf8';
    const body = useUtf8 ? content : encodeZenginContentToShiftJis(content);
    const charset = useUtf8 ? 'utf-8' : 'Shift_JIS';

    res
      .status(200)
      .header('Content-Type', `text/plain; charset=${charset}`)
      .header('Content-Disposition', `attachment; filename="${batchNo}.txt"`)
      .send(body);
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
