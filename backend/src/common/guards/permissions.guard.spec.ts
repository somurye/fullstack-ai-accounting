import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';
import { AppException } from '../exceptions/app.exception';

describe('PermissionsGuard (DEBT-005)', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new PermissionsGuard(reflector);
  });

  function createMockContext(roles: string[]): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            sub: 'user-1',
            tenant_id: 'tenant-1',
            roles,
          },
        }),
      }),
    } as any;
  }

  it('パーミッション未指定のエンドポイントは素通しする', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = createMockContext(['employee']);
    expect(guard.canActivate(context)).toBe(true);
  });

  describe('owner ロール', () => {
    it('すべての契約パーミッション (create, view, edit, approve, terminate) を許可する', () => {
      const perms = ['contract.create', 'contract.view', 'contract.edit', 'contract.approve', 'contract.terminate'];
      for (const perm of perms) {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([perm]);
        const context = createMockContext(['owner']);
        expect(guard.canActivate(context)).toBe(true);
      }
    });
  });

  describe('legal_admin ロール', () => {
    it('すべての契約パーミッションを許可する', () => {
      const perms = ['contract.create', 'contract.view', 'contract.edit', 'contract.approve', 'contract.terminate'];
      for (const perm of perms) {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([perm]);
        const context = createMockContext(['legal_admin']);
        expect(guard.canActivate(context)).toBe(true);
      }
    });
  });

  describe('legal_viewer ロール', () => {
    it('contract.view は許可する', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['contract.view']);
      const context = createMockContext(['legal_viewer']);
      expect(guard.canActivate(context)).toBe(true);
    });

    it('contract.create は403で拒否する', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['contract.create']);
      const context = createMockContext(['legal_viewer']);
      expect(() => guard.canActivate(context)).toThrow(AppException);
    });

    it('contract.edit は403で拒否する', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['contract.edit']);
      const context = createMockContext(['legal_viewer']);
      expect(() => guard.canActivate(context)).toThrow(AppException);
    });

    it('contract.approve は403で拒否する', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['contract.approve']);
      const context = createMockContext(['legal_viewer']);
      expect(() => guard.canActivate(context)).toThrow(AppException);
    });

    it('contract.terminate は403で拒否する', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['contract.terminate']);
      const context = createMockContext(['legal_viewer']);
      expect(() => guard.canActivate(context)).toThrow(AppException);
    });
  });

  describe('approver ロール', () => {
    it('contract.view と contract.approve は許可する', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['contract.view']);
      expect(guard.canActivate(createMockContext(['approver']))).toBe(true);

      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['contract.approve']);
      expect(guard.canActivate(createMockContext(['approver']))).toBe(true);
    });

    it('contract.create は403で拒否する', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['contract.create']);
      expect(() => guard.canActivate(createMockContext(['approver']))).toThrow(AppException);
    });
  });

  describe('fail-closed の検証 (employee ロール等)', () => {
    it('employee ロールは contract.view を含めすべての契約操作が403で拒否される', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['contract.view']);
      expect(() => guard.canActivate(createMockContext(['employee']))).toThrow(AppException);
    });
  });

  describe('notification.batch_execute 権限 (P1-T4-FIX)', () => {
    it('owner ロールは notification.batch_execute を許可する', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['notification.batch_execute']);
      expect(guard.canActivate(createMockContext(['owner']))).toBe(true);
    });

    it('legal_admin / legal_viewer / accountant / approver / employee ロールは 403 で拒否される', () => {
      const nonBatchRoles = ['legal_admin', 'legal_viewer', 'accountant', 'accounting_manager', 'approver', 'employee'];
      for (const role of nonBatchRoles) {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['notification.batch_execute']);
        expect(() => guard.canActivate(createMockContext([role]))).toThrow(AppException);
      }
    });
  });

  describe('general_request.* 権限 (P1-T5 汎用稟議)', () => {
    it('employee ロールは general_request.create, view, edit を許可し、approve は拒否する', () => {
      const allowedPerms = ['general_request.create', 'general_request.view', 'general_request.edit'];
      for (const perm of allowedPerms) {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([perm]);
        expect(guard.canActivate(createMockContext(['employee']))).toBe(true);
      }

      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['general_request.approve']);
      expect(() => guard.canActivate(createMockContext(['employee']))).toThrow(AppException);
    });

    it('approver ロールは general_request.view, approve を許可し、create は拒否する', () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['general_request.view']);
      expect(guard.canActivate(createMockContext(['approver']))).toBe(true);

      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['general_request.approve']);
      expect(guard.canActivate(createMockContext(['approver']))).toBe(true);

      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['general_request.create']);
      expect(() => guard.canActivate(createMockContext(['approver']))).toThrow(AppException);
    });

    it('owner ロールはすべての general_request パーミッション (create, view, edit, approve) を許可する', () => {
      const perms = ['general_request.create', 'general_request.view', 'general_request.edit', 'general_request.approve'];
      for (const perm of perms) {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([perm]);
        expect(guard.canActivate(createMockContext(['owner']))).toBe(true);
      }
    });
  });
});

