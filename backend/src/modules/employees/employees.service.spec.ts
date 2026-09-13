import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { EmployeesService } from './employees.service';

describe('EmployeesService', () => {
  let service: EmployeesService;
  let mockDb: any;
  let mockAuditLogs: any;
  let mockClient: any;

  beforeEach(async () => {
    mockClient = {
      query: jest.fn(),
    };

    mockDb = {
      transaction: jest.fn((tenantId, userId, cb) => cb(mockClient)),
    };

    mockAuditLogs = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmployeesService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: AuditLogsService, useValue: mockAuditLogs },
      ],
    }).compile();

    service = module.get<EmployeesService>(EmployeesService);
  });

  describe('二重RBAC認可チェック (assertUserPermission)', () => {
    it('パーミッション未保持ユーザーは403例外をスローする', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // 権限なし

      await expect(
        service.list('tenant-1', 'user-no-perm', { page: 1, limit: 20 }),
      ).rejects.toThrow(AppException);
    });

    it('userIdが未指定の場合は401例外をスローする', async () => {
      await expect(
        service.list('tenant-1', null, { page: 1, limit: 20 }),
      ).rejects.toThrow(AppException);
    });
  });

  describe('create', () => {
    it('正常に従業員を登録し監査ログを記録する', async () => {
      // 1. assertUserPermission PASS
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. dupCheck (0 rows)
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      // 3. insert
      const createdRow = {
        id: 'emp-1',
        tenant_id: 'tenant-1',
        user_id: null,
        employee_no: 'EMP001',
        name: '山田 太郎',
        department_id: null,
        hire_date: '2026-04-01',
        employment_type: 'full_time',
        status: 'active',
        created_at: new Date('2026-04-01T00:00:00Z'),
        updated_at: new Date('2026-04-01T00:00:00Z'),
      };
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [createdRow],
      });

      const res = await service.create('tenant-1', 'user-1', {
        employee_no: 'EMP001',
        name: '山田 太郎',
        hire_date: '2026-04-01',
        employment_type: 'full_time',
        status: 'active',
      });

      expect(res.employee_no).toBe('EMP001');
      expect(res.name).toBe('山田 太郎');
      expect(mockAuditLogs.record).toHaveBeenCalled();
    });

    it('社員番号が重複している場合は400例外をスローする', async () => {
      // 1. assertUserPermission PASS
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. dupCheck (1 row exists)
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 'existing-id' }],
      });

      await expect(
        service.create('tenant-1', 'user-1', {
          employee_no: 'EMP001',
          name: '山田 太郎',
          hire_date: '2026-04-01',
          employment_type: 'full_time',
          status: 'active',
        }),
      ).rejects.toThrow(AppException);
    });
  });
});
