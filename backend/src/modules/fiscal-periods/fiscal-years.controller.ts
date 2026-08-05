import { Controller, Get, UseGuards } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { FiscalYearsService } from './fiscal-years.service';

@Controller('fiscal-years')
@UseGuards(TenantAuthGuard)
export class FiscalYearsController {
  constructor(private readonly fiscalYearsService: FiscalYearsService) {}

  @Get()
  async list() {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw AppException.unauthorized('テナントコンテキストが確立されていません');
    }
    const fiscalYears = await this.fiscalYearsService.list(tenantId, RequestContext.getUserId());
    return successEnvelope(fiscalYears);
  }
}
