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
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import {
  journalEntryCreateSchema,
  journalEntryLineCreateSchema,
  journalEntryListQuerySchema,
  journalEntryReverseSchema,
  journalEntryUpdateSchema,
  journalEntryVoidSchema,
} from './dto/journal-entry.schemas';
import { JournalEntriesService } from './journal-entries.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/**
 * JournalEntriesController
 * =========================
 * `docs/openapi.yaml` の `tags: [JournalEntries]` に定義された全エンドポイントを実装する。
 * 認証・テナント整合性検証は `TenantAuthGuard` に委譲し、コントローラは
 * `RequestContext`(ガード通過後は検証済みの値)からtenantId/userIdを取得する。
 */
@Controller('journal-entries')
@UseGuards(TenantAuthGuard)
export class JournalEntriesController {
  constructor(private readonly journalEntriesService: JournalEntriesService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(journalEntryListQuerySchema, query);
    const { entries, pagination } = await this.journalEntriesService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(entries, pagination);
  }

  @Post()
  async create(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const dto = parseWithZod(journalEntryCreateSchema, body);
    const entry = await this.journalEntriesService.create(tenantId, userId, dto);
    return successEnvelope(entry);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const entry = await this.journalEntriesService.findById(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
    );
    return successEnvelope(entry);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(journalEntryUpdateSchema, body);
    const entry = await this.journalEntriesService.update(tenantId, userId, parsedId, dto);
    return successEnvelope(entry);
  }

  @Get(':id/lines')
  async listLines(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const lines = await this.journalEntriesService.listLines(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
    );
    return successEnvelope(lines);
  }

  @Post(':id/lines')
  async addLine(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(journalEntryLineCreateSchema, body);
    const line = await this.journalEntriesService.addLine(tenantId, userId, parsedId, dto);
    return successEnvelope(line);
  }

  @Delete(':id/lines/:lineId')
  @HttpCode(204)
  async deleteLine(@Param('id') id: string, @Param('lineId') lineId: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const parsedLineId = parseWithZod(idParamSchema, lineId);
    await this.journalEntriesService.deleteLine(tenantId, userId, parsedId, parsedLineId);
  }

  @Post(':id/post')
  @HttpCode(200)
  async postEntry(@Param('id') id: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const entry = await this.journalEntriesService.post(tenantId, userId, parsedId);
    return successEnvelope(entry);
  }

  @Post(':id/void')
  @HttpCode(200)
  async voidEntry(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(journalEntryVoidSchema, body ?? {});
    const entry = await this.journalEntriesService.voidEntry(tenantId, userId, parsedId, dto);
    return successEnvelope(entry);
  }

  @Post(':id/reverse')
  async reverse(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(journalEntryReverseSchema, body);
    const entry = await this.journalEntriesService.reverse(tenantId, userId, parsedId, dto);
    return successEnvelope(entry);
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
