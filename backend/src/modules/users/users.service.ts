import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import { DatabaseService } from '../../database/database.service';
import type { components } from '../../types/api.generated';

export type UserDto = components['schemas']['User'];

interface UserRow {
  id: string;
  email: string | null;
  name: string;
  is_active: boolean;
}

interface RoleRow {
  code: string;
}

/** `docs/openapi.yaml` `tags: [Users]` の `GET /users/me` を実装する */
@Injectable()
export class UsersService {
  constructor(private readonly db: DatabaseService) {}

  async getCurrent(tenantId: string, userId: string): Promise<UserDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const userResult = await client.query<UserRow>(
        `SELECT id, email, name, is_active FROM users WHERE id = $1`,
        [userId],
      );
      const user = userResult.rows[0];
      if (!user) {
        throw AppException.notFound('ユーザーが見つかりません');
      }

      const rolesResult = await client.query<RoleRow>(
        `SELECT r.code AS code
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.tenant_id = $1 AND ur.user_id = $2
         ORDER BY r.code ASC`,
        [tenantId, userId],
      );

      return {
        id: user.id,
        email: user.email ?? undefined,
        name: user.name,
        is_active: user.is_active,
        roles: rolesResult.rows.map((row) => row.code as NonNullable<UserDto['roles']>[number]),
      };
    });
  }
}
