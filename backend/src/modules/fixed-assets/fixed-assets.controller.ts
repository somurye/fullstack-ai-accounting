import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import {
  depreciationRunSchema,
  fixedAssetCreateSchema,
  fixedAssetDisposeSchema,
  fixedAssetListQuerySchema,
} from './dto/fixed-asset.schemas';
import { FixedAssetsService } from './fixed-assets.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/**
 * FixedAssetsController
 * ======================
 * `docs/openapi.yaml` の `tags: [FixedAssets]` に定義されたエンドポイントを実装する。
 * ルート順序に注意: `depreciation-runs` は静的パスのため `:id` より前に定義すること
 * (NestJSのルーティングは登録順マッチのため、後ろにあると `:id` に吸収されてしまう)。
 */
@Controller('fixed-assets')
@UseGuards(TenantAuthGuard)
export class FixedAssetsController {
  constructor(private readonly fixedAssetsService: FixedAssetsService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(fixedAssetListQuerySchema, query);
    const { fixedAssets, pagination } = await this.fixedAssetsService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(fixedAssets, pagination);
  }

  @Post()
  async create(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const dto = parseWithZod(fixedAssetCreateSchema, body);
    const fixedAsset = await this.fixedAssetsService.create(tenantId, userId, dto);
    return successEnvelope(fixedAsset);
  }

  @Post('depreciation-runs')
  @HttpCode(200)
  async runDepreciation(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const dto = parseWithZod(depreciationRunSchema, body);
    const result = await this.fixedAssetsService.runDepreciation(tenantId, userId, dto);
    return successEnvelope({ processed_count: result.processedCount, journal_entry_ids: result.journalEntryIds });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const fixedAsset = await this.fixedAssetsService.findById(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
    );
    return successEnvelope(fixedAsset);
  }

  @Post(':id/dispose')
  @HttpCode(200)
  async dispose(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(fixedAssetDisposeSchema, body);
    const fixedAsset = await this.fixedAssetsService.dispose(tenantId, userId, parsedId, dto);
    return successEnvelope(fixedAsset);
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
