import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { RequestContext } from '../context/request-context';
import { AppException } from '../exceptions/app.exception';

/**
 * JWTアクセストークンに含まれるクレーム。
 * `docs/openapi.yaml` の `BearerAuth` セキュリティスキームに対応する。
 */
export interface JwtPayload {
  /** ユーザーID (users.id) */
  sub: string;
  /** テナントID (tenants.id) */
  tenant_id: string;
  /** 現在のテナントにおけるロールコード一覧 */
  roles: string[];
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

/**
 * TenantAuthGuard
 * ===============
 * 以下2点を1つのガードで検証する、本APIのマルチテナント認証の要。
 *
 *   1. JWTアクセストークンの署名・有効期限を検証する(JwtAuthGuard相当)。
 *   2. `X-Tenant-ID` ヘッダーの値がJWTクレームの `tenant_id` と一致することを
 *      検証する(なりすまし・テナント越境アクセスの防止)。
 *
 * ここで検証を通過しても、実際のデータ越境防止の最終防御はDB側のRLS
 * (`fn_current_tenant_id()` / `FORCE ROW LEVEL SECURITY`)が担う
 * (原則2「DB制約による最終防御」)。本ガードはあくまでAPI層での早期拒否であり、
 * アプリケーション層のバグでこのガードが迂回されても、DB側で越境は起こらない
 * 多層防御構成になっている。
 *
 * 検証成功時は `RequestContext` の `userId` / `tenantId`(検証済みの値)を更新し、
 * 以降のサービス層は `RequestContext.getTenantId()` / `getUserId()` を
 * そのまま `DatabaseService.transaction()` に渡すだけでよい。
 */
@Injectable()
export class TenantAuthGuard implements CanActivate {
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

    if (!payload.tenant_id || !payload.sub) {
      throw AppException.unauthorized('トークンに必要なクレーム(tenant_id/sub)が含まれていません');
    }

    const headerTenantId = req.header('X-Tenant-ID');
    if (!headerTenantId) {
      throw AppException.badRequest('X-Tenant-IDヘッダーは必須です');
    }
    if (headerTenantId !== payload.tenant_id) {
      throw AppException.tenantMismatch();
    }

    // 検証済みの値でリクエストオブジェクト・非同期コンテキストの双方を更新する。
    req.user = payload;
    RequestContext.setTenantId(payload.tenant_id);
    RequestContext.setUserId(payload.sub);

    return true;
  }
}
