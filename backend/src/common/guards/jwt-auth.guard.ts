import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RequestContext } from '../context/request-context';
import { AppException } from '../exceptions/app.exception';
import type { AuthenticatedRequest, JwtPayload } from './tenant-auth.guard';

/**
 * JwtAuthGuard
 * ============
 * `TenantAuthGuard` からX-Tenant-IDヘッダーの突合を除いた軽量版。
 * `POST /auth/logout` は `docs/openapi.yaml` 上 `TenantIdHeader` パラメータを
 * 要求しておらず(ログアウトはテナントを跨いで「自分のセッション」を破棄する操作の
 * ため)、`TenantAuthGuard` をそのまま使うと不要な400/403を返してしまう。
 * JWTの署名・有効期限のみを検証し、`RequestContext.userId` を設定する。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const authHeader = req.header('authorization') ?? req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw AppException.unauthorized('Authorizationヘッダーが存在しないか形式が不正です');
    }
    const token = authHeader.slice('Bearer '.length).trim();

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token);
    } catch {
      throw AppException.unauthorized('トークンが無効、または有効期限が切れています');
    }

    if (!payload.sub) {
      throw AppException.unauthorized('トークンに必要なクレーム(sub)が含まれていません');
    }

    req.user = payload;
    RequestContext.setUserId(payload.sub);

    return true;
  }
}
