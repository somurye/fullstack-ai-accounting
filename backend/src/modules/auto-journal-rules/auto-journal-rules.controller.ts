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
import { AutoJournalRulesService } from './auto-journal-rules.service';
import {
  autoJournalRuleCreateSchema,
  autoJournalRuleListQuerySchema,
} from './dto/auto-journal-rule.schemas';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/** 自動仕訳ルールCRUD(`docs/openapi.yaml` `tags: [AutoJournalRules]`) */
@Controller('auto-journal-rules')
@UseGuards(TenantAuthGuard)
export class AutoJournalRulesController {
  constructor(private readonly autoJournalRulesService: AutoJournalRulesService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(autoJournalRuleListQuerySchema, query);
    const { rules, pagination } = await this.autoJournalRulesService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(rules, pagination);
  }

  @Post()
  async create(@Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const dto = parseWithZod(autoJournalRuleCreateSchema, body);
    const rule = await this.autoJournalRulesService.create(tenantId, RequestContext.getUserId(), dto);
    return successEnvelope(rule);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    const dto = parseWithZod(autoJournalRuleCreateSchema, body);
    const rule = await this.autoJournalRulesService.update(
      tenantId,
      RequestContext.getUserId(),
      parsedId,
      dto,
    );
    return successEnvelope(rule);
  }

  @Delete(':id')
  @HttpCode(204)
  async deactivate(@Param('id') id: string): Promise<void> {
    const tenantId = this.requireTenantId();
    const parsedId = parseWithZod(idParamSchema, id);
    await this.autoJournalRulesService.deactivate(tenantId, RequestContext.getUserId(), parsedId);
  }

  private requireTenantId(): string {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw AppException.unauthorized('テナントコンテキストが確立されていません');
    }
    return tenantId;
  }
}
