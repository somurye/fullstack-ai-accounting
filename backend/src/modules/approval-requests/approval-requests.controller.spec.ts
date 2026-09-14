import { ApprovalRequestsController } from './approval-requests.controller';
import { ApprovalRequestsService } from './approval-requests.service';
import { RequestContext, RequestContextStore } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';

describe('ApprovalRequestsController (APIなりすまし防御検証)', () => {
  let controller: ApprovalRequestsController;
  let mockService: jest.Mocked<Partial<ApprovalRequestsService>>;

  const TENANT_ID = '11111111-1111-1111-1111-111111111111';
  const AUTHENTICATED_USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const VICTIM_USER_ID = 'vvvvvvvv-vvvv-vvvv-vvvv-vvvvvvvvvvvv';
  const REQUEST_ID = '22222222-2222-2222-2222-222222222222';

  const baseStore: RequestContextStore = {
    tenantId: TENANT_ID,
    userId: AUTHENTICATED_USER_ID,
    requestId: 'req-test-123',
    ipAddress: '127.0.0.1',
    userAgent: 'JestTest',
  };

  beforeEach(() => {
    mockService = {
      approve: jest.fn().mockResolvedValue({
        id: REQUEST_ID,
        tenant_id: TENANT_ID,
        target_type: 'payroll',
        target_id: '33333333-3333-3333-3333-333333333333',
        status: 'approved',
        current_step: 1,
        total_steps: 1,
        submitted_by: 'ssssssss-ssss-ssss-ssss-ssssssssssss',
        submitted_at: '2026-09-15T00:00:00Z',
        completed_at: '2026-09-15T01:00:00Z',
        history: [],
      }),
      reject: jest.fn().mockResolvedValue({
        id: REQUEST_ID,
        tenant_id: TENANT_ID,
        target_type: 'payroll',
        target_id: '33333333-3333-3333-3333-333333333333',
        status: 'rejected',
        current_step: 1,
        total_steps: 1,
        submitted_by: 'ssssssss-ssss-ssss-ssss-ssssssssssss',
        submitted_at: '2026-09-15T00:00:00Z',
        completed_at: '2026-09-15T01:00:00Z',
        history: [],
      }),
      list: jest.fn(),
      findById: jest.fn(),
    };

    controller = new ApprovalRequestsController(mockService as unknown as ApprovalRequestsService);
  });

  describe('POST /approval-requests/:id/approve', () => {
    it('リクエストボディにapprover_id等の別ユーザーIDを指定しても無視され、常に認証セッションのuserIdがServiceに渡される', async () => {
      await RequestContext.run(baseStore, async () => {
        // 攻撃者がリクエストボディに他人のapprover_id / userId を含めて送信
        const maliciousBody = {
          comment: '悪意あるなりすまし承認試行',
          approver_id: VICTIM_USER_ID,
          userId: VICTIM_USER_ID,
          user_id: VICTIM_USER_ID,
        };

        const result = await controller.approve(REQUEST_ID, maliciousBody);

        expect(result.data.status).toBe('approved');
        expect(mockService.approve).toHaveBeenCalledTimes(1);

        // 第1引数: tenantId, 第2引数: userId, 第3引数: id, 第4引数: dto
        const [calledTenantId, calledUserId, calledId, calledDto] = (
          mockService.approve as jest.Mock
        ).mock.calls[0];

        // サービスに渡されたuserIdは、クライアントが指定したVICTIM_USER_IDではなく認証セッションのAUTHENTICATED_USER_ID
        expect(calledUserId).toBe(AUTHENTICATED_USER_ID);
        expect(calledTenantId).toBe(TENANT_ID);
        expect(calledId).toBe(REQUEST_ID);

        // DTOパースにより未許可の approver_id / userId は完全に除外(strip)されている
        expect(calledDto).toEqual({ comment: '悪意あるなりすまし承認試行' });
        expect(calledDto).not.toHaveProperty('approver_id');
        expect(calledDto).not.toHaveProperty('userId');
        expect(calledDto).not.toHaveProperty('user_id');
      });
    });

    it('未認証(RequestContextにuserIdが存在しない)の場合は 401 Unauthorized で拒否される', async () => {
      const unauthenticatedStore: RequestContextStore = {
        tenantId: TENANT_ID,
        userId: null,
        requestId: 'req-test-456',
        ipAddress: '127.0.0.1',
        userAgent: 'JestTest',
      };

      await RequestContext.run(unauthenticatedStore, async () => {
        await expect(controller.approve(REQUEST_ID, {})).rejects.toThrow(AppException);
        await expect(controller.approve(REQUEST_ID, {})).rejects.toMatchObject({
          errorCode: 'UNAUTHORIZED',
        });
      });
    });
  });

  describe('POST /approval-requests/:id/reject', () => {
    it('リクエストボディにapprover_id等の別ユーザーIDを指定しても無視され、常に認証セッションのuserIdがServiceに渡される', async () => {
      await RequestContext.run(baseStore, async () => {
        const maliciousBody = {
          comment: '悪意あるなりすまし却下試行',
          approver_id: VICTIM_USER_ID,
          userId: VICTIM_USER_ID,
        };

        const result = await controller.reject(REQUEST_ID, maliciousBody);

        expect(result.data.status).toBe('rejected');
        expect(mockService.reject).toHaveBeenCalledTimes(1);

        const [calledTenantId, calledUserId, calledId, calledDto] = (
          mockService.reject as jest.Mock
        ).mock.calls[0];

        expect(calledUserId).toBe(AUTHENTICATED_USER_ID);
        expect(calledTenantId).toBe(TENANT_ID);
        expect(calledId).toBe(REQUEST_ID);

        expect(calledDto).toEqual({ comment: '悪意あるなりすまし却下試行' });
        expect(calledDto).not.toHaveProperty('approver_id');
        expect(calledDto).not.toHaveProperty('userId');
      });
    });

    it('未認証(RequestContextにuserIdが存在しない)の場合は 401 Unauthorized で拒否される', async () => {
      const unauthenticatedStore: RequestContextStore = {
        tenantId: TENANT_ID,
        userId: null,
        requestId: 'req-test-456',
        ipAddress: '127.0.0.1',
        userAgent: 'JestTest',
      };

      await RequestContext.run(unauthenticatedStore, async () => {
        await expect(
          controller.reject(REQUEST_ID, { comment: '却下' }),
        ).rejects.toThrow(AppException);
        await expect(
          controller.reject(REQUEST_ID, { comment: '却下' }),
        ).rejects.toMatchObject({
          errorCode: 'UNAUTHORIZED',
        });
      });
    });
  });
});
