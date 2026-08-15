import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { RequestContext } from '../context/request-context';

/**
 * TenantContextMiddleware
 * =======================
 * Nestのリクエストライフサイクルの最も早い段階(ミドルウェア)で実行され、
 * `X-Tenant-ID` ヘッダーの値を `AsyncLocalStorage` ベースの `RequestContext` に
 * 格納する。この時点ではJWTの検証は行っていないため `tenantId` は未検証の値である。
 *
 * 実際の認可(JWTクレームの`tenant_id`との一致検証)は `TenantAuthGuard` が
 * 後続のガードフェーズで行い、検証に成功した値で `RequestContext` を上書きする。
 *
 * ミドルウェア → ガード → インターセプター → パイプ → ハンドラ、という
 * Nestの実行順序上、`AsyncLocalStorage.run()` でリクエスト処理全体を
 * ラップできるのはミドルウェアの役割であるため、コンテキストの「入れ物」自体は
 * ここで生成する。
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const rawTenantId = req.header('X-Tenant-ID');
    const tenantId = rawTenantId && rawTenantId.trim().length > 0 ? rawTenantId.trim() : null;
    const requestId = randomUUID();

    res.setHeader('X-Request-ID', requestId);

    RequestContext.run(
      {
        tenantId,
        userId: null,
        requestId,
        ipAddress: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      },
      () => {
        next();
      },
    );
  }
}
