import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../exceptions/app.exception';
import type { AuthenticatedRequest } from './tenant-auth.guard';

/**
 * ExternalAccessGuard
 * ====================
 * `TenantAuthGuard` の後段で動作する追加ガード。JWTクレームの `roles` に
 * `viewer_external` が含まれる場合のみ介入し、`external_access_grants` に
 * 現在時刻を含む有効な許可が存在するかをDBへ直接確認する。
 *
 * 判定は `app_readonly_external` DBロールとして接続した上で
 * `fn_has_active_external_grant()`(SECURITY DEFINER, RLS設計の一部)を
 * 呼び出す(`DatabaseService.transactionAsRole`)。これにより、アプリ層の
 * このガードにバグがあっても、同じ判定ロジックの結果は
 * `sql/001_initial_schema_all_in_one.sql` のRESTRICTIVE RLSポリシーが
 * 独立して強制する(多層防御。原則2「DB制約による最終防御」)。
 *
 * viewer_external以外のロールを持つ通常ユーザーには一切影響しない
 * (このガードは常にtrueを返す)。
 *
 * 【本タスクでの適用範囲】全モジュールの全クエリを`app_readonly_external`
 * ロール経由に切り替える全面改修はスコープ外とし、本ガードを外部閲覧者の
 * 主要な参照面(監査ログ・添付ファイル検索)へ適用することで、
 * 「期限切れトークンが401/403で遮断される」という要件を実証する。
 */
@Injectable()
export class ExternalAccessGuard implements CanActivate {
  constructor(private readonly db: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const roles = req.user?.roles ?? [];
    if (!roles.includes('viewer_external')) {
      return true;
    }

    const tenantId = req.user.tenant_id;
    const userId = req.user.sub;

    const hasActiveGrant = await this.db.transactionAsRole(
      'app_readonly_external',
      tenantId,
      userId,
      async (client) => {
        const result = await client.query<{ has_grant: boolean }>(
          'SELECT fn_has_active_external_grant() AS has_grant',
        );
        return result.rows[0]?.has_grant ?? false;
      },
    );

    if (!hasActiveGrant) {
      throw AppException.forbidden(
        '時限アクセス許可が存在しないか、有効期間外のためこのリソースへアクセスできません',
      );
    }
    return true;
  }
}
