import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { Role } from '../enums/role.enum';
import { AppException } from '../exceptions/app.exception';
import type { AuthenticatedRequest } from './tenant-auth.guard';

/**
 * RolesGuard
 * ==========
 * 職務分掌(SoD)RBACの実施ガード。`@Roles(...)` で宣言された許可ロールと、
 * `TenantAuthGuard` が検証済みのJWTクレーム `roles`(テナント内の保有ロール
 * コード配列)を突き合わせ、いずれにも一致しなければ403を返す。
 * `TenantAuthGuard` の後段で動作する前提(`req.user` が設定済みであること)。
 *
 * `@Roles()` が付与されていないハンドラーは対象外とし、常に通過させる
 * (既存の大半のエンドポイントは本SoDモデルの対象外であるため)。
 *
 * 外部閲覧者(`viewer_external`)は `ExternalAccessGuard` 側で時限アクセス許可の
 * 有無を別途厳密に検証済みのため、本ガードのロール判定からは除外して素通しする
 * (監査ログ等、両ガードを併用するエンドポイントで、正当な期限内アクセスが
 * 誤って403にならないようにするため)。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userRoles = req.user?.roles ?? [];

    if (userRoles.includes('viewer_external')) {
      return true;
    }

    const allowed: string[] = requiredRoles;
    const hasRequiredRole = userRoles.some((role) => allowed.includes(role));
    if (!hasRequiredRole) {
      throw AppException.forbidden('この操作を行う権限がありません(ロール不足)');
    }
    return true;
  }
}
