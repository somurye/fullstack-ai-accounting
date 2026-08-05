import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import { aiSuggestionListQuerySchema, aiSuggestionRejectSchema } from './dto/ai-suggestion.schemas';
import { AiSuggestionsService } from './ai-suggestions.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/**
 * AiSuggestionsController
 * ========================
 * AI提案(`ai_suggestions`)の検索・詳細取得・採用(accept)・不採用(reject)を実装する。
 */
@Controller('ai/suggestions')
@UseGuards(TenantAuthGuard)
export class AiSuggestionsController {
  constructor(private readonly aiSuggestionsService: AiSuggestionsService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(aiSuggestionListQuerySchema, query);
    const { suggestions, pagination } = await this.aiSuggestionsService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(suggestions, pagination);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const suggestion = await this.aiSuggestionsService.findById(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
    );
    return successEnvelope(suggestion);
  }

  @Post(':id/accept')
  @HttpCode(200)
  async accept(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const suggestion = await this.aiSuggestionsService.accept(tenantId, userId, parsedId);
    return successEnvelope(suggestion);
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(aiSuggestionRejectSchema, body ?? {});
    const suggestion = await this.aiSuggestionsService.reject(tenantId, userId, parsedId, dto);
    return successEnvelope(suggestion);
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
