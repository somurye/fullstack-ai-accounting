import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AttendanceService } from './attendance.service';

describe('AttendanceService', () => {
  let service: AttendanceService;
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
        AttendanceService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: AuditLogsService, useValue: mockAuditLogs },
      ],
    }).compile();

    service = module.get<AttendanceService>(AttendanceService);
  });

  describe('二重RBAC認可チェック (assertUserPermission)', () => {
    it('パーミッション未保持ユーザーは403例外をスローする', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // 権限なし

      await expect(
        service.list('tenant-1', 'user-no-perm', { page: 1, limit: 31 }),
      ).rejects.toThrow(AppException);
    });
  });

  describe('clock (打刻処理)', () => {
    it('出勤打刻が正常に記録される', async () => {
      // 1. assertUserPermission PASS
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. 従業員取得 (active)
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 'emp-1', name: '山田 太郎', employee_no: 'EMP001' }],
      });
      // 3. 既存レコードなし (0 rows)
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      // 4. INSERT
      const createdRow = {
        id: 'att-1',
        tenant_id: 'tenant-1',
        employee_id: 'emp-1',
        work_date: '2026-09-13',
        clock_in: new Date('2026-09-13T09:00:00Z'),
        clock_out: null,
        break_minutes: 0,
        regular_hours: '0.00',
        overtime_hours: '0.00',
        late_night_hours: '0.00',
        holiday_hours: '0.00',
        is_holiday: false,
        note: null,
        status: 'draft',
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [createdRow],
      });

      const res = await service.clock('tenant-1', 'user-1', {
        employee_id: 'emp-1',
        type: 'clock_in',
        timestamp: '2026-09-13T09:00:00+09:00',
      });

      expect(res.id).toBe('att-1');
      expect(res.employee_id).toBe('emp-1');
      expect(res.employee_name).toBe('山田 太郎');
      expect(mockAuditLogs.record).toHaveBeenCalled();
    });

    it('退勤打刻時に労働時間区分が自動計算される', async () => {
      // 1. assertUserPermission PASS
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. 従業員取得 (active)
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 'emp-1', name: '山田 太郎', employee_no: 'EMP001' }],
      });
      // 3. 既存レコードあり (09:00出勤済み)
      const existingRow = {
        id: 'att-1',
        tenant_id: 'tenant-1',
        employee_id: 'emp-1',
        work_date: '2026-09-13',
        clock_in: new Date(2026, 8, 13, 9, 0, 0),
        clock_out: null,
        break_minutes: 60,
        is_holiday: false,
      };
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [existingRow],
      });
      // 4. UPDATE (18:30退勤 -> 拘束9.5h, 休憩1h, 実働8.5h -> 所定8h, 残業0.5h)
      const updatedRow = {
        ...existingRow,
        clock_out: new Date(2026, 8, 13, 18, 30, 0),
        regular_hours: '8.00',
        overtime_hours: '0.50',
        late_night_hours: '0.00',
        holiday_hours: '0.00',
        updated_at: new Date(),
      };
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [updatedRow],
      });

      const res = await service.clock('tenant-1', 'user-1', {
        employee_id: 'emp-1',
        type: 'clock_out',
        timestamp: new Date(2026, 8, 13, 18, 30, 0).toISOString(),
        break_minutes: 60,
      });

      expect(res.regular_hours).toBe(8.0);
      expect(res.overtime_hours).toBe(0.5);
      expect(mockAuditLogs.record).toHaveBeenCalled();
    });
  });
});
