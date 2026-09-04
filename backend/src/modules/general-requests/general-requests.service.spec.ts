import { AppException } from '../../common/exceptions/app.exception';
import type { DatabaseService } from '../../database/database.service';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import { GeneralRequestsService } from './general-requests.service';

describe('GeneralRequestsService', () => {
  let service: GeneralRequestsService;
  let mockDb: { transaction: jest.Mock };
  let mockAuditLogs: { record: jest.Mock };
  let mockClient: { query: jest.Mock };

  const TENANT_ID = '11111111-1111-1111-1111-111111111111';
  const USER_ID = '22222222-2222-2222-2222-222222222222';
  const REQUEST_ID = '33333333-3333-3333-3333-333333333333';
  const ATTACHMENT_ID = '44444444-4444-4444-4444-444444444444';

  const sampleRequestRow = {
    id: REQUEST_ID,
    tenant_id: TENANT_ID,
    request_no: 'REQ-202609-0001',
    title: 'PC周辺機器購入の件',
    description: '4Kモニターおよびキーボードの購入申請',
    category: 'equipment',
    amount: '45000.00',
    attachment_id: ATTACHMENT_ID,
    status: 'draft',
    created_by: USER_ID,
    approved_at: null,
    created_at: new Date('2026-09-04T10:00:00Z'),
    updated_at: new Date('2026-09-04T10:00:00Z'),
  };

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
    };
    mockDb = {
      transaction: jest.fn().mockImplementation((_tenantId, _userId, callback) => callback(mockClient)),
    };
    mockAuditLogs = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    service = new GeneralRequestsService(
      mockDb as unknown as DatabaseService,
      mockAuditLogs as unknown as AuditLogsService,
    );
  });

  describe('list', () => {
    it('稟議一覧を取得できる (ページネーション・フィルタ適用)', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // count
        .mockResolvedValueOnce({ rows: [sampleRequestRow] }); // select

      const result = await service.list(TENANT_ID, USER_ID, {
        status: 'draft',
        category: 'equipment',
        page: 1,
        page_size: 20,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(REQUEST_ID);
      expect(result.data[0].request_no).toBe('REQ-202609-0001');
      expect(result.data[0].amount).toBe(45000);
      expect(result.pagination.total_count).toBe(1);
    });
  });

  describe('getById', () => {
    it('稟議詳細を取得できる', async () => {
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [sampleRequestRow],
      });

      const result = await service.getById(TENANT_ID, USER_ID, REQUEST_ID);

      expect(result.id).toBe(REQUEST_ID);
      expect(result.title).toBe('PC周辺機器購入の件');
    });

    it('存在しないIDの場合 NotFound 例外を投げる', async () => {
      mockClient.query.mockResolvedValueOnce({
        rowCount: 0,
        rows: [],
      });

      await expect(service.getById(TENANT_ID, USER_ID, REQUEST_ID)).rejects.toThrow(
        AppException,
      );
    });
  });

  describe('create', () => {
    it('ドラフト稟議を作成できる (request_no自動採番, auditLog記録)', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: ATTACHMENT_ID }] }) // attachment check
        .mockResolvedValueOnce({ rows: [] }) // advisory lock
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // request_no count
        .mockResolvedValueOnce({ rows: [sampleRequestRow] }); // insert returning

      const result = await service.create(TENANT_ID, USER_ID, {
        title: 'PC周辺機器購入の件',
        description: '4Kモニターおよびキーボードの購入申請',
        category: 'equipment',
        amount: 45000,
        attachment_id: ATTACHMENT_ID,
      });

      expect(result.id).toBe(REQUEST_ID);
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({
          action: 'general_request.created',
          targetType: 'general_request',
          targetId: REQUEST_ID,
        }),
      );
    });

    it('存在しない添付ファイルIDを指定した場合はBadRequest例外を投げる', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // attachment check 0

      await expect(
        service.create(TENANT_ID, USER_ID, {
          title: 'テスト',
          description: 'テスト',
          attachment_id: ATTACHMENT_ID,
        }),
      ).rejects.toThrow(AppException);
    });
  });

  describe('update', () => {
    it('draft状態の稟議を正常に更新できる', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [sampleRequestRow] }) // existing draft
        .mockResolvedValueOnce({
          rows: [{ ...sampleRequestRow, title: '更新後タイトル' }],
        }); // update returning

      const result = await service.update(TENANT_ID, USER_ID, REQUEST_ID, {
        title: '更新後タイトル',
      });

      expect(result.title).toBe('更新後タイトル');
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({
          action: 'general_request.updated',
          targetId: REQUEST_ID,
        }),
      );
    });

    it('draft以外の稟議を更新しようとするとconflict例外を投げる', async () => {
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ ...sampleRequestRow, status: 'active' }],
      });

      await expect(
        service.update(TENANT_ID, USER_ID, REQUEST_ID, { title: '変更' }),
      ).rejects.toThrow(AppException);
    });
  });

  describe('delete', () => {
    it('draft状態の稟議を物理削除できる', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [sampleRequestRow] }) // existing
        .mockResolvedValueOnce({ rowCount: 1 }); // delete

      await service.delete(TENANT_ID, USER_ID, REQUEST_ID);

      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({
          action: 'general_request.deleted',
          targetId: REQUEST_ID,
        }),
      );
    });

    it('active状態の稟議を削除しようとするとconflict例外を投げる', async () => {
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ ...sampleRequestRow, status: 'active' }],
      });

      await expect(service.delete(TENANT_ID, USER_ID, REQUEST_ID)).rejects.toThrow(
        AppException,
      );
    });
  });

  describe('submitForApproval (承認ルール未設定・明示的自動承認・多段階承認)', () => {
    it('承認ルール未設定の場合: エラーを返し、自動的にactiveへ遷移しない (SoD偶発的無効化防止)', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [sampleRequestRow] }) // existing draft
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // rules check (0件 = 未設定)

      await expect(service.submitForApproval(TENANT_ID, USER_ID, REQUEST_ID)).rejects.toThrow(
        AppException,
      );
      expect(mockAuditLogs.record).not.toHaveBeenCalled();
    });

    it('明示的自動承認ルール(is_explicit_auto_approve=true)の場合: 即座にactive(自動承認)となりauto_approvedが記録される', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [sampleRequestRow] }) // existing draft
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ step_number: 0, is_explicit_auto_approve: true }],
        }) // rules check
        .mockResolvedValueOnce({
          rows: [
            {
              ...sampleRequestRow,
              status: 'active',
              approved_at: new Date('2026-09-04T12:00:00Z'),
            },
          ],
        }); // update returning active

      const result = await service.submitForApproval(TENANT_ID, USER_ID, REQUEST_ID);

      expect(result.status).toBe('active');
      expect(result.approved_at).not.toBeNull();
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({
          action: 'general_request.auto_approved',
          targetId: REQUEST_ID,
          afterData: { status: 'active', auto_approved: true },
        }),
      );
    });

    it('承認ルール設定済(多段階)の場合: pending_approvalに遷移しapproval_requestsが起票される', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [sampleRequestRow] }) // existing draft
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ step_number: 1, is_explicit_auto_approve: false }],
        }) // rules check
        .mockResolvedValueOnce({
          rows: [{ ...sampleRequestRow, status: 'pending_approval' }],
        }) // update returning pending
        .mockResolvedValueOnce({ rowCount: 1 }); // insert approval_requests

      const result = await service.submitForApproval(TENANT_ID, USER_ID, REQUEST_ID);

      expect(result.status).toBe('pending_approval');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO approval_requests'),
        expect.arrayContaining([TENANT_ID, REQUEST_ID, USER_ID, 1]),
      );
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({
          action: 'general_request.submitted_for_approval',
          targetId: REQUEST_ID,
          afterData: { status: 'pending_approval', total_steps: 1 },
        }),
      );
    });
  });
});
