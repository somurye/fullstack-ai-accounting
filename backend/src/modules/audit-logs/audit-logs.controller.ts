import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { RequestContext } from '../../common/context/request-context';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AppException } from '../../common/exceptions/app.exception';
import { ExternalAccessGuard } from '../../common/guards/external-access.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import { auditLogListQuerySchema } from './dto/audit-log.schemas';
import { AuditLogsService } from './audit-logs.service';

/**
 * AuditLogsController
 * ====================
 * 監査ログの閲覧のみを提供する(書き込みAPIは無い。`AuditLogsService.record()`は
 * サービス間呼び出し専用で、`audit_logs`自体もDBトリガーにより追記専用)。
 *
 * `ExternalAccessGuard` を適用し、税理士・監査人(viewer_external)が
 * 時限アクセス許可の範囲でのみ閲覧できるようにする。
 *
 * 職務分掌(SoD)RBAC: 通常ロールのユーザーは`ADMIN`/`ACCOUNTANT`のみ閲覧可能
 * (`RolesGuard`は`viewer_external`保持者を対象外として素通しするため、
 * `ExternalAccessGuard`による時限アクセス許可の判定と競合しない)。
 */
@Controller('audit-logs')
@UseGuards(TenantAuthGuard, ExternalAccessGuard, RolesGuard)
@Roles(Role.ADMIN, Role.ACCOUNTANT)
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  async list(@Query() query: unknown) {
    const tenantId = this.requireTenantId();
    const parsedQuery = parseWithZod(auditLogListQuerySchema, query);
    const { logs, pagination } = await this.auditLogsService.list(
      tenantId,
      RequestContext.getUserId(),
      parsedQuery,
    );
    return successEnvelope(logs, pagination);
  }

  private requireTenantId(): string {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw AppException.unauthorized('テナントコンテキストが確立されていません');
    }
    return tenantId;
  }
}
