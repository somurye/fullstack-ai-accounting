import { AppException } from '../../common/exceptions/app.exception';
import { DatabaseService } from '../../database/database.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PayrollCalculationsService } from './payroll-calculations.service';

describe('PayrollCalculationsService', () => {
  let service: PayrollCalculationsService;
  let mockDb: any;
  let mockAuditLogs: any;
  let mockClient: any;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';
  const employeeId = '33333333-3333-3333-3333-333333333333';
  const periodId = '44444444-4444-4444-4444-444444444444';
  const calcId = '55555555-5555-5555-5555-555555555555';

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
    };
    mockDb = {
      transaction: jest.fn((_tenantId, _userId, callback) => callback(mockClient)),
    };
    mockAuditLogs = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    service = new PayrollCalculationsService(mockDb as unknown as DatabaseService, mockAuditLogs as unknown as AuditLogsService);
  });

  describe('RBAC二重防御', () => {
    it('payroll.create 権限がない場合、403 Forbidden をスローする', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // enforcePermission failure

      await expect(
        service.createPeriod(tenantId, userId, {
          name: '2026年5月度給与',
          period_start: '2026-05-01',
          period_end: '2026-05-31',
          payment_date: '2026-06-10',
        }),
      ).rejects.toThrow(AppException);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT 1'),
        [tenantId, userId, 'payroll.create'],
      );
    });
  });

  describe('承認フロー連携 (暗黙自動承認の防止 & 0-step / 多段階承認)', () => {
    it('承認ルールが未設定の場合、400 Bad Request をスローして暗黙自動承認を防止する', async () => {
      // 1. enforcePermission: success
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. select payroll_calculations: draft
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: calcId, status: 'draft' }],
      });
      // 3. select approval_rules: 未設定 (0件)
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(
        service.submitApproval(tenantId, userId, calcId),
      ).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            message: '給与計算の承認ルールが設定されていません。承認ルールの設定を行ってください',
          }),
        }),
      );
    });

    it('明示的0-step自動承認ルールが設定されている場合、即座に status = active に遷移する', async () => {
      // 1. enforcePermission: success
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. select payroll_calculations: draft
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: calcId, status: 'draft' }],
      });
      // 3. select approval_rules: 0-step auto approve
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ step_number: 0, is_explicit_auto_approve: true }],
      });
      // 4. update payroll_calculations: active
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: calcId, status: 'active', approved_at: new Date() }],
      });

      const res = await service.submitApproval(tenantId, userId, calcId);
      expect(res.status).toBe('active');
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        tenantId,
        expect.objectContaining({ action: 'payroll.auto_approved' }),
      );
    });

    it('多段階承認ルールが設定されている場合、approval_requests を起票して status = pending_approval に遷移する', async () => {
      // 1. enforcePermission: success
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. select payroll_calculations: draft
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: calcId, status: 'draft' }],
      });
      // 3. select approval_rules: step 1, 2
      mockClient.query.mockResolvedValueOnce({
        rowCount: 2,
        rows: [
          { step_number: 1, is_explicit_auto_approve: false },
          { step_number: 2, is_explicit_auto_approve: false },
        ],
      });
      // 4. insert approval_requests
      const arId = '66666666-6666-6666-6666-666666666666';
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: arId }],
      });
      // 5. update payroll_calculations: pending_approval
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: calcId, status: 'pending_approval', approval_request_id: arId }],
      });

      const res = await service.submitApproval(tenantId, userId, calcId);
      expect(res.status).toBe('pending_approval');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO approval_requests'),
        [tenantId, calcId, userId, 2],
      );
    });
  });
});
