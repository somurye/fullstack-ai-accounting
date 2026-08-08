import { SetMetadata } from '@nestjs/common';
import type { Role } from '../enums/role.enum';

export const ROLES_KEY = 'roles';

/** ハンドラー/コントローラーに許可ロールを付与する。`RolesGuard`が参照する。 */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);
