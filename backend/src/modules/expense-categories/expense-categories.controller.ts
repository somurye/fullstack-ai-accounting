import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import { ExpenseCategoriesService } from './expense-categories.service';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(200),
});

/** 経費精算フォームの費目カテゴリ選択のための最小限の一覧取得API(openapi.yaml未定義の補助エンドポイント) */
@Controller('expense-categories')
@UseGuards(TenantAuthGuard)
export class ExpenseCategoriesController {
  constructor(private readonly expenseCategoriesService: ExpenseCategoriesService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw AppException.unauthorized('テナントコンテキストが確立されていません');
    }
    const parsedQuery = parseWithZod(listQuerySchema, query);
    const { categories, pagination } = await this.expenseCategoriesService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(categories, pagination);
  }
}
