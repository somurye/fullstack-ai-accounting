import { Controller, Get, UseGuards } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { TenantsService } from './tenants.service';

/** `docs/openapi.yaml` `tags: [Tenants]` を実装する */
@Controller('tenants')
@UseGuards(TenantAuthGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get('me')
  async getCurrent() {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw AppException.unauthorized('テナントコンテキストが確立されていません');
    }
    const tenant = await this.tenantsService.getCurrent(tenantId, RequestContext.getUserId());
    return successEnvelope(tenant);
  }
}
