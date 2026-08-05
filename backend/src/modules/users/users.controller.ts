import { Controller, Get, UseGuards } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { UsersService } from './users.service';

/** `docs/openapi.yaml` `tags: [Users]` を実装する */
@Controller('users')
@UseGuards(TenantAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getCurrent() {
    const tenantId = RequestContext.getTenantId();
    const userId = RequestContext.getUserId();
    if (!tenantId || !userId) {
      throw AppException.unauthorized('認証コンテキストが確立されていません');
    }
    const user = await this.usersService.getCurrent(tenantId, userId);
    return successEnvelope(user);
  }
}
