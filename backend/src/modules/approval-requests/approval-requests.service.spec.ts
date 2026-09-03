import { AppException } from '../../common/exceptions/app.exception';
import type { DatabaseService } from '../../database/database.service';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ApprovalRequestsService } from './approval-requests.service';

describe('ApprovalRequestsService', () => {
  let service: ApprovalRequestsService;
  let mockDb: { transaction: jest.Mock };
  let mockAuditLogs: { record: jest.Mock };
  let mockClient: { query: jest.Mock };

  const TENANT_ID = '11111111-1111-1111-1111-111111111111';
  const SUBMITTER_USER_ID = '22222222-2222-2222-2222-222222222222';
  const APPROVER_USER_ID = '33333333-3333-3333-3333-333333333333';
  const THIRD_PARTY_USER_ID = '44444444-4444-4444-4444-444444444444';
  const REQUEST_ID = '55555555-5555-5555-5555-555555555555';
  const TARGET_ID = '66666666-6666-6666-6666-666666666666';

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

    service = new ApprovalRequestsService(
      mockDb as unknown as DatabaseService,
      mockAuditLogs as unknown as AuditLogsService,
    );
  });

  describe('list', () => {
    it('target_type や status 等の条件で一覧を取得できる (contract / purchase_request 含む)', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // COUNT(*)
        .mockResolvedValueOnce({
          rows: [
            {
              id: REQUEST_ID,
              target_type: 'contract',
              target_id: TARGET_ID,
              submitted_by: SUBMITTER_USER_ID,
              total_steps: 1,
              current_step: 1,
              status: 'pending',
            },
          ],
        }) // SELECT approval_requests
        .mockResolvedValueOnce({ rows: [] }); // fetchHistoryForRequests

      const result = await service.list(TENANT_ID, APPROVER_USER_ID, APPROVER_USER_ID, {
        target_type: 'contract',
        status: 'pending',
        page: 1,
        page_size: 50,
      });

      expect(result.requests).toHaveLength(1);
      expect(result.requests[0].target_type).toBe('contract');
      expect(result.pagination.total_count).toBe(1);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('ar.target_type = $3'),
        expect.arrayContaining([TENANT_ID, 'pending', 'contract']),
      );
    });
  });

  describe('approve (新ドメイン: contract / purchase_request)', () => {
    it('target_type = "contract" で正常に承認できる (1段階承認・最終ステップ完了)', async () => {
      // 1. fetchPendingRequest
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: REQUEST_ID,
            target_type: 'contract',
            target_id: TARGET_ID,
            submitted_by: SUBMITTER_USER_ID,
            total_steps: 1,
            current_step: 1,
            status: 'pending',
          },
        ],
      });
      // 2. assertAssignedApprover: contract.approve 権限チェック
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
      // 3. assertAssignedApprover: 割当承認者チェック
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
      // 4. INSERT INTO approval_history
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      // 5. UPDATE approval_requests SET status = 'approved'
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      // 6. UPDATE contracts SET status = 'active'
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      // 7. fetchDetail: approval_requests
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: REQUEST_ID,
            target_type: 'contract',
            target_id: TARGET_ID,
            submitted_by: SUBMITTER_USER_ID,
            total_steps: 1,
            current_step: 1,
            status: 'approved',
          },
        ],
      });
      // 8. fetchDetail: approval_history
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: '77777777-7777-7777-7777-777777777777',
            step_number: 1,
            approver_id: APPROVER_USER_ID,
            action: 'approve',
            comment: '契約内容確認済み',
            acted_at: new Date('2026-09-02T10:00:00Z'),
          },
        ],
      });

      const res = await service.approve(TENANT_ID, APPROVER_USER_ID, REQUEST_ID, {
        comment: '契約内容確認済み',
      });

      expect(res.status).toBe('approved');
      expect(res.target_type).toBe('contract');
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({
          action: 'contract.approved',
          targetType: 'contract',
          targetId: TARGET_ID,
        }),
      );
    });

    it('contract.approve 権限を持たないユーザーの承認は 403 で拒否される (DEBT-005)', async () => {
      // 1. fetchPendingRequest
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: REQUEST_ID,
            target_type: 'contract',
            target_id: TARGET_ID,
            submitted_by: SUBMITTER_USER_ID,
            total_steps: 1,
            current_step: 1,
            status: 'pending',
          },
        ],
      });
      // 2. assertAssignedApprover: contract.approve 権限なし (0件)
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(
        service.approve(TENANT_ID, APPROVER_USER_ID, REQUEST_ID, { comment: '承認試行' }),
      ).rejects.toThrow(AppException);
    });

    it('target_type = "purchase_request" で多段階承認の中間ステップが進行する', async () => {
      // 1. fetchPendingRequest (2段階承認のステップ1)
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: REQUEST_ID,
            target_type: 'purchase_request',
            target_id: TARGET_ID,
            submitted_by: SUBMITTER_USER_ID,
            total_steps: 2,
            current_step: 1,
            status: 'pending',
          },
        ],
      });
      // 2. assertAssignedApprover
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
      // 3. INSERT INTO approval_history
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      // 4. UPDATE approval_requests SET current_step = 2
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      // 5. fetchDetail
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: REQUEST_ID,
            target_type: 'purchase_request',
            target_id: TARGET_ID,
            submitted_by: SUBMITTER_USER_ID,
            total_steps: 2,
            current_step: 2,
            status: 'pending',
          },
        ],
      });
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const res = await service.approve(TENANT_ID, APPROVER_USER_ID, REQUEST_ID, {});

      expect(res.status).toBe('pending');
      expect(res.current_step).toBe(2);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE approval_requests SET current_step = $2'),
        [REQUEST_ID, 2],
      );
    });
  });

  describe('reject (新ドメイン: contract / purchase_request)', () => {
    it('target_type = "contract" で正常に却下できる', async () => {
      // 1. fetchPendingRequest
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: REQUEST_ID,
            target_type: 'contract',
            target_id: TARGET_ID,
            submitted_by: SUBMITTER_USER_ID,
            total_steps: 1,
            current_step: 1,
            status: 'pending',
          },
        ],
      });
      // 2. assertAssignedApprover: contract.approve 権限チェック
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
      // 3. assertAssignedApprover: 割当承認者チェック
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
      // 4. INSERT INTO approval_history
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      // 5. UPDATE approval_requests SET status = 'rejected'
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      // 6. UPDATE contracts SET status = 'rejected'
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      // 7. fetchDetail: approval_requests
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: REQUEST_ID,
            target_type: 'contract',
            target_id: TARGET_ID,
            submitted_by: SUBMITTER_USER_ID,
            total_steps: 1,
            current_step: 1,
            status: 'rejected',
          },
        ],
      });
      // 8. fetchDetail: approval_history
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [],
      });

      const res = await service.reject(TENANT_ID, APPROVER_USER_ID, REQUEST_ID, {
        comment: '条項修正が必要',
      });

      expect(res.status).toBe('rejected');
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({
          action: 'contract.rejected',
          targetType: 'contract',
          targetId: TARGET_ID,
        }),
      );
    });
  });

  describe('自己承認禁止 & 権限外承認のガード', () => {
    it('新target_type (contract) でも自己承認トリガー(DB 23514)による例外発生時に拒否される', async () => {
      // 1. fetchPendingRequest
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: REQUEST_ID,
            target_type: 'contract',
            target_id: TARGET_ID,
            submitted_by: SUBMITTER_USER_ID,
            total_steps: 1,
            current_step: 1,
            status: 'pending',
          },
        ],
      });
      // 2. assertAssignedApprover (もしルール上で割り当てられていたとしても)
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
      // 3. INSERT INTO approval_history -> fn_prevent_self_approval() トリガーが発火
      const triggerError = new Error('self-approval is not permitted (submitter=..., approver=...)');
      (triggerError as unknown as { code: string }).code = '23514';
      mockClient.query.mockRejectedValueOnce(triggerError);

      await expect(
        service.approve(TENANT_ID, SUBMITTER_USER_ID, REQUEST_ID, { comment: '自己承認' }),
      ).rejects.toThrow('self-approval is not permitted');
    });

    it('割り当てられていない第三者による承認は 403 Forbidden で拒否される', async () => {
      // 1. fetchPendingRequest
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: REQUEST_ID,
            target_type: 'contract',
            target_id: TARGET_ID,
            submitted_by: SUBMITTER_USER_ID,
            total_steps: 1,
            current_step: 1,
            status: 'pending',
          },
        ],
      });
      // 2. assertAssignedApprover -> 該当なし (0件)
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(
        service.approve(TENANT_ID, THIRD_PARTY_USER_ID, REQUEST_ID, {}),
      ).rejects.toThrow(AppException);
    });
  });

  describe('既存ドメインの回帰検証 (デグレなし確認)', () => {
    it('target_type = "expense_report" の承認フローが正常に動作し、関連テーブルを更新する', async () => {
      const JOURNAL_ENTRY_ID = '88888888-8888-8888-8888-888888888888';
      // 1. fetchPendingRequest
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: REQUEST_ID,
            target_type: 'expense_report',
            target_id: TARGET_ID,
            submitted_by: SUBMITTER_USER_ID,
            total_steps: 1,
            current_step: 1,
            status: 'pending',
          },
        ],
      });
      // 2. assertAssignedApprover
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
      // 3. INSERT INTO approval_history
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      // 4. UPDATE approval_requests SET status = 'approved'
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      // 5. finalizeApproval: SELECT journal_entry_id FROM expense_reports
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ journal_entry_id: JOURNAL_ENTRY_ID }],
      });
      // 6. finalizeApproval: UPDATE expense_reports SET status = 'approved'
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      // 7. finalizeApproval: UPDATE journal_entries SET status = 'posted'
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      // 8. fetchDetail
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: REQUEST_ID,
            target_type: 'expense_report',
            target_id: TARGET_ID,
            submitted_by: SUBMITTER_USER_ID,
            total_steps: 1,
            current_step: 1,
            status: 'approved',
          },
        ],
      });
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const res = await service.approve(TENANT_ID, APPROVER_USER_ID, REQUEST_ID, {});

      expect(res.status).toBe('approved');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE expense_reports SET status = \'approved\''),
        [TENANT_ID, TARGET_ID],
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE journal_entries SET status = \'posted\''),
        [TENANT_ID, JOURNAL_ENTRY_ID, APPROVER_USER_ID],
      );
    });

    it('target_type = "journal_entry" の承認で仕訳が posted に遷移する', async () => {
      // 1. fetchPendingRequest
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: REQUEST_ID,
            target_type: 'journal_entry',
            target_id: TARGET_ID,
            submitted_by: SUBMITTER_USER_ID,
            total_steps: 1,
            current_step: 1,
            status: 'pending',
          },
        ],
      });
      // 2. assertAssignedApprover
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
      // 3. INSERT INTO approval_history
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      // 4. UPDATE approval_requests SET status = 'approved'
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      // 5. finalizeApproval: UPDATE journal_entries SET status = 'posted'
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
      // 6. fetchDetail
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: REQUEST_ID,
            target_type: 'journal_entry',
            target_id: TARGET_ID,
            submitted_by: SUBMITTER_USER_ID,
            total_steps: 1,
            current_step: 1,
            status: 'approved',
          },
        ],
      });
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const res = await service.approve(TENANT_ID, APPROVER_USER_ID, REQUEST_ID, {});

      expect(res.status).toBe('approved');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE journal_entries SET status = \'posted\''),
        [TENANT_ID, TARGET_ID, APPROVER_USER_ID],
      );
    });
  });
});
