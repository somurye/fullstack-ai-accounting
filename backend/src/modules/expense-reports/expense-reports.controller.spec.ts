import { ExpenseReportsController } from './expense-reports.controller';
import { ExpenseReportsService } from './expense-reports.service';
import { RequestContext, RequestContextStore } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';

describe('ExpenseReportsController (APIなりすまし防御検証)', () => {
  let controller: ExpenseReportsController;
  let mockService: jest.Mocked<Partial<ExpenseReportsService>>;

  const TENANT_ID = '11111111-1111-1111-1111-111111111111';
  const AUTHENTICATED_USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const VICTIM_USER_ID = 'vvvvvvvv-vvvv-vvvv-vvvv-vvvvvvvvvvvv';
  const REPORT_ID = '33333333-3333-3333-3333-333333333333';

  const baseStore: RequestContextStore = {
    tenantId: TENANT_ID,
    userId: AUTHENTICATED_USER_ID,
    requestId: 'req-test-expense-123',
    ipAddress: '127.0.0.1',
    userAgent: 'JestTest',
  };

  beforeEach(() => {
    mockService = {
      approve: jest.fn().mockResolvedValue({
        id: REPORT_ID,
        tenant_id: TENANT_ID,
        title: '出張経費',
        status: 'approved',
        submitted_by: 'ssssssss-ssss-ssss-ssss-ssssssssssss',
        total_amount: '10000',
        lines: [],
        approval_history: [],
      } as any),
      reject: jest.fn().mockResolvedValue({
        id: REPORT_ID,
        tenant_id: TENANT_ID,
        title: '出張経費',
        status: 'rejected',
        submitted_by: 'ssssssss-ssss-ssss-ssss-ssssssssssss',
        total_amount: '10000',
        lines: [],
        approval_history: [],
      } as any),
    };

    controller = new ExpenseReportsController(mockService as unknown as ExpenseReportsService);
  });

  describe('POST /expense-reports/:id/approve', () => {
    it('リクエストボディにapprover_id等の別ユーザーIDを指定しても無視され、常に認証セッションのuserIdがServiceに渡される', async () => {
      await RequestContext.run(baseStore, async () => {
        const maliciousBody = {
          comment: '経費承認します',
          approver_id: VICTIM_USER_ID,
          userId: VICTIM_USER_ID,
          user_id: VICTIM_USER_ID,
        };

        const result = await controller.approve(REPORT_ID, maliciousBody);

        expect(result.data.status).toBe('approved');
        expect(mockService.approve).toHaveBeenCalledTimes(1);

        const [calledTenantId, calledUserId, calledId, calledDto] = (
          mockService.approve as jest.Mock
        ).mock.calls[0];

        expect(calledUserId).toBe(AUTHENTICATED_USER_ID);
        expect(calledTenantId).toBe(TENANT_ID);
        expect(calledId).toBe(REPORT_ID);

        expect(calledDto).toEqual({ comment: '経費承認します' });
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
        await expect(controller.approve(REPORT_ID, {})).rejects.toThrow(AppException);
        await expect(controller.approve(REPORT_ID, {})).rejects.toMatchObject({
          errorCode: 'UNAUTHORIZED',
        });
      });
    });
  });

  describe('POST /expense-reports/:id/reject', () => {
    it('リクエストボディにapprover_id等の別ユーザーIDを指定しても無視され、常に認証セッションのuserIdがServiceに渡される', async () => {
      await RequestContext.run(baseStore, async () => {
        const maliciousBody = {
          comment: '領収書不備のため却下',
          approver_id: VICTIM_USER_ID,
          userId: VICTIM_USER_ID,
        };

        const result = await controller.reject(REPORT_ID, maliciousBody);

        expect(result.data.status).toBe('rejected');
        expect(mockService.reject).toHaveBeenCalledTimes(1);

        const [calledTenantId, calledUserId, calledId, calledDto] = (
          mockService.reject as jest.Mock
        ).mock.calls[0];

        expect(calledUserId).toBe(AUTHENTICATED_USER_ID);
        expect(calledTenantId).toBe(TENANT_ID);
        expect(calledId).toBe(REPORT_ID);

        expect(calledDto).toEqual({ comment: '領収書不備のため却下' });
        expect(calledDto).not.toHaveProperty('approver_id');
      });
    });
  });
});
