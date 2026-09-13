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
      // 2. isAttendanceManager PASS (管理者ロール所持)
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 3. acquireAdvisoryLock PASS
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 4. 従業員取得 (active)
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 'emp-1', name: '山田 太郎', employee_no: 'EMP001' }],
      });
      // 5. 既存レコードなし (0 rows)
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      // 6. INSERT
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

    it('退勤打刻時に労働時間区分が自動計算され、週次再計算が行われる', async () => {
      // 1. assertUserPermission PASS
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. isAttendanceManager PASS (管理者ロール所持)
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 3. acquireAdvisoryLock PASS
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 4. 従業員取得 (active)
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 'emp-1', name: '山田 太郎', employee_no: 'EMP001' }],
      });
      // 5. 既存レコードあり (09:00出勤済み)
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
      // 6. UPDATE (18:30退勤 -> 拘束9.5h, 休憩1h, 実働8.5h -> 所定8h, 残業0.5h)
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
      // 7. recalculateWeeklyWorkHours: acquireAdvisoryLock
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{}],
      });
      // 8. recalculateWeeklyWorkHours: 当該週のレコード取得
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [updatedRow],
      });
      // 9. recalculateWeeklyWorkHours: UPDATE
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [],
      });
      // 10. 再読み込み
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

    it('一般従業員が他人のemployee_idで打刻しようとすると403で拒否される', async () => {
      // 1. assertUserPermission PASS
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. isManager FAIL (非管理者)
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      // 3. 自身のemployee_id取得 (emp-self)
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 'emp-self' }],
      });

      await expect(
        service.clock('tenant-1', 'user-employee', {
          employee_id: 'emp-other',
          type: 'clock_in',
          timestamp: '2026-09-13T09:00:00+09:00',
        }),
      ).rejects.toThrow(AppException);
    });
  });

  describe('updateRecord (勤怠更新処理)', () => {
    it('Advisory Lockを行ロック(FOR UPDATE)より先に取得し、正常に更新および週次再計算が行われる (FIX3デッドロック防止)', async () => {
      const initialRow = {
        id: 'att-1',
        tenant_id: 'tenant-1',
        employee_id: 'emp-1',
        work_date: '2026-09-14',
        clock_in: new Date(2026, 8, 14, 9, 0, 0),
        clock_out: new Date(2026, 8, 14, 18, 0, 0),
        break_minutes: 60,
        regular_hours: '8.00',
        overtime_hours: '0.00',
        is_holiday: false,
        employee_no: 'EMP001',
        employee_name: '山田 太郎',
      };

      // 1. assertUserPermission PASS
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. checkRes (FOR UPDATEなし、対象特定)
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [initialRow] });
      // 3. isAttendanceManager PASS
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 4. acquireAdvisoryLock (Advisory Lock先行取得)
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 5. existingRes (Advisory Lock取得後のFOR UPDATE)
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [initialRow] });
      // 6. UPDATE 実行
      const updatedRow = {
        ...initialRow,
        clock_out: new Date(2026, 8, 14, 19, 0, 0),
        regular_hours: '8.00',
        overtime_hours: '1.00',
      };
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [updatedRow] });
      // 7. recalculateWeeklyWorkHours: acquireAdvisoryLock
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 8. recalculateWeeklyWorkHours: 当該週確定レコード取得 (FOR UPDATE)
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [updatedRow] });
      // 9. recalculateWeeklyWorkHours: 週次UPDATE
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      // 10. 再読み込み
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [updatedRow] });

      const res = await service.updateRecord('tenant-1', 'user-1', 'att-1', {
        clock_out: new Date(2026, 8, 14, 19, 0, 0).toISOString(),
      });

      expect(res.id).toBe('att-1');
      expect(res.regular_hours).toBe(8.0);
      expect(res.overtime_hours).toBe(1.0);

      // クエリ呼び出しの順序を検証
      // 呼び出し2: FOR UPDATE なしの SELECT
      const call2Sql = mockClient.query.mock.calls[1][0];
      expect(call2Sql).not.toContain('FOR UPDATE');
      expect(call2Sql).toContain('FROM attendance_records');

      // 呼び出し4: pg_advisory_xact_lock
      const call4Sql = mockClient.query.mock.calls[3][0];
      expect(call4Sql).toContain('pg_advisory_xact_lock');

      // 呼び出し5: FOR UPDATE ありの SELECT (Advisory Lock取得後)
      const call5Sql = mockClient.query.mock.calls[4][0];
      expect(call5Sql).toContain('FOR UPDATE');
    });
  });
});
