import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * RequirePermissions
 * ==================
 * ハンドラーまたはコントローラークラスに対して、要求されるパーミッションコードを指定する。
 * 複数指定した場合は、いずれかのパーミッションを満たしていればアクセスを許可する(OR条件)。
 *
 * 例:
 *   @RequirePermissions('contract.create')
 *   @RequirePermissions('contract.create', 'contract.edit') // 作成者または編集者
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
