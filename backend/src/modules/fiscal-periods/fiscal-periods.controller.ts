import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import { FiscalPeriodsService } from './fiscal-periods.service';

const listQuerySchema = z.object({ fiscal_year_id: z.string().uuid().optional() });

@Controller('fiscal-periods')
@UseGuards(TenantAuthGuard)
export class FiscalPeriodsController {
  constructor(private readonly fiscalPeriodsService: FiscalPeriodsService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw AppException.unauthorized('テナントコンテキストが確立されていません');
    }
    const parsedQuery = parseWithZod(listQuerySchema, query);
    const fiscalPeriods = await this.fiscalPeriodsService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery.fiscal_year_id,
    );
    return successEnvelope(fiscalPeriods);
  }
}
