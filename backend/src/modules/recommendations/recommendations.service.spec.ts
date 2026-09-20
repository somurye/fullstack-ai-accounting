import { Test, TestingModule } from '@nestjs/testing';
import { RecommendationsService } from './recommendations.service';
import { DatabaseService } from '../../database/database.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ContractRenewalLinksService } from '../contract-renewal-links/contract-renewal-links.service';
import { ApprovalRequestsService } from '../approval-requests/approval-requests.service';
import { QuotationsService } from '../quotations/quotations.service';
import { AppException } from '../../common/exceptions/app.exception';

describe('RecommendationsService', () => {
  let service: RecommendationsService;
  let mockDb: any;
  let mockAuditLogs: any;
  let mockContractRenewalLinksService: any;
  let mockApprovalRequestsService: any;
  let mockQuotationsService: any;

  const tenantId = '00000000-0000-0000-0000-000000000001';
  const userId = '00000000-0000-0000-0000-000000000002';

  beforeEach(async () => {
    mockDb = {
      transaction: jest.fn().mockImplementation((tId, uId, cb) =>
        cb({
          query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
        }),
      ),
      query: jest.fn().mockResolvedValue({ rows: [] }),
    };

    mockAuditLogs = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    mockContractRenewalLinksService = {
      getUnlinkedExpiringContracts: jest.fn().mockResolvedValue([
        {
          id: 'c-1',
          contract_no: 'CNT-001',
          title: '保守契約A',
          counterparty_name: 'クライアントA',
          end_date: '2026-10-01',
          renewal_notice_days: 30,
          auto_renewal: false,
          days_until_expiry: 11,
        },
      ]),
    };

    mockApprovalRequestsService = {
      getStalePendingRequests: jest.fn().mockResolvedValue([
        {
          id: 'ar-1',
          target_type: 'contract',
          target_id: 'c-1',
          total_steps: 2,
          current_step: 1,
          submitted_by: 'user-1',
          created_at: '2026-09-10',
          days_pending: 10,
        },
      ]),
    };

    mockQuotationsService = {
      getStaleSentQuotations: jest.fn().mockResolvedValue([
        {
          id: 'q-1',
          quote_no: 'QT-001',
          title: '開発見積A',
          customer_id: 'cust-1',
          deal_id: null,
          subtotal: 1000000,
          tax_amount: 100000,
          total_amount: 1100000,
          issue_date: '2026-09-01',
          days_since_issue: 19,
        },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecommendationsService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: AuditLogsService, useValue: mockAuditLogs },
        { provide: ContractRenewalLinksService, useValue: mockContractRenewalLinksService },
        { provide: ApprovalRequestsService, useValue: mockApprovalRequestsService },
        { provide: QuotationsService, useValue: mockQuotationsService },
      ],
    }).compile();

    service = module.get<RecommendationsService>(RecommendationsService);
  });

  describe('generateRecommendations', () => {
    it('各既存ドメインServiceからデータを取得しrecommendationsテーブルへINSERTすること (業務テーブルSQLなし)', async () => {
      const querySpy = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
      mockDb.transaction.mockImplementation((tId: string, uId: string, cb: any) =>
        cb({ query: querySpy }),
      );

      await service.generateRecommendations(tenantId, userId);

      expect(mockContractRenewalLinksService.getUnlinkedExpiringContracts).toHaveBeenCalledWith(tenantId, userId);
      expect(mockApprovalRequestsService.getStalePendingRequests).toHaveBeenCalledWith(tenantId, userId, 5);
      expect(mockQuotationsService.getStaleSentQuotations).toHaveBeenCalledWith(tenantId, userId, 14);

      // 3件のレコメンドが INSERT される
      expect(querySpy).toHaveBeenCalledTimes(3);
      expect(querySpy.mock.calls[0][0]).toContain('INSERT INTO recommendations');
      expect(querySpy.mock.calls[0][1][1]).toBe('c-1');
      expect(querySpy.mock.calls[1][1][1]).toBe('ar-1');
      expect(querySpy.mock.calls[2][1][1]).toBe('q-1');
    });
  });

  describe('list', () => {
    it('閲覧権限のあるドメインのみフィルタリングして返却すること', async () => {
      const mockRows = [
        {
          id: 'rec-1',
          tenant_id: tenantId,
          type: 'approval_stale',
          target_domain: 'approval_requests',
          target_id: 'ar-1',
          title: '承認依頼の滞留アラート',
          message: '5日滞留',
          status: 'new',
          action_url: '/approval-requests',
          metadata: {},
          shown_at: null,
          responded_at: null,
          created_at: '2026-09-20',
          updated_at: '2026-09-20',
        },
      ];

      const querySpy = jest.fn().mockResolvedValue({ rows: mockRows });
      mockDb.transaction.mockImplementation((tId: string, uId: string, cb: any) =>
        cb({ query: querySpy }),
      );

      // payroll_admin: approval_requests のみアクセス可 (contracts, quotations は除外)
      const results = await service.list(tenantId, userId, ['payroll_admin']);

      expect(results.length).toBe(1);
      expect(results[0].type).toBe('approval_stale');
      // SQL 内で target_domain = ANY($2) のパラメータに approval_requests が含まれる
      const params = querySpy.mock.calls[querySpy.mock.calls.length - 1][1];
      expect(params[1]).toContain('approval_requests');
      expect(params[1]).not.toContain('contracts');
      expect(params[1]).not.toContain('quotations');
    });

    it('target_domain と target_id を指定した場合、SQLのWHERE句にtarget_domainおよびtarget_idが含まれること', async () => {
      const querySpy = jest.fn().mockResolvedValue({
        rows: [
          {
            id: 'rec-contract-1',
            tenant_id: tenantId,
            type: 'contract_renewal_pending',
            target_domain: 'contracts',
            target_id: 'c-1',
            title: '契約更新推奨',
            message: '契約更新案件作成',
            status: 'pending',
            action_url: '/deals/new?contract_id=c-1',
            metadata: {},
            shown_at: null,
            responded_at: null,
            created_at: '2026-09-20',
            updated_at: '2026-09-20',
          },
        ],
      });

      mockDb.transaction.mockImplementation((tId: string, uId: string, cb: any) =>
        cb({ query: querySpy }),
      );

      const results = await service.list(tenantId, userId, ['owner'], {
        target_domain: 'contracts',
        target_id: 'c-1',
      });

      expect(results.length).toBe(1);
      expect(results[0].target_id).toBe('c-1');
      const lastCall = querySpy.mock.calls[querySpy.mock.calls.length - 1];
      const sql = lastCall[0];
      const params = lastCall[1];
      expect(sql).toContain('target_domain = $');
      expect(sql).toContain('target_id = $');
      expect(params).toContain('contracts');
      expect(params).toContain('c-1');
    });
  });

  describe('accept', () => {
    it('recommendationsテーブルのステータスをacceptedに更新し、業務テーブルは変更しないこと', async () => {
      const existingRow = {
        id: 'rec-1',
        tenant_id: tenantId,
        type: 'contract_renewal_pending',
        target_domain: 'contracts',
        target_id: 'c-1',
        title: '契約更新推奨',
        message: '更新案件作成推奨',
        status: 'new',
        action_url: '/deals/new?contract_id=c-1',
        metadata: {},
        shown_at: null,
        responded_at: null,
        created_at: '2026-09-20',
        updated_at: '2026-09-20',
      };
      const updatedRow = {
        ...existingRow,
        status: 'accepted',
        responded_at: '2026-09-20T10:00:00Z',
      };

      const querySpy = jest.fn()
        .mockResolvedValueOnce({ rows: [existingRow] }) // fetch
        .mockResolvedValueOnce({ rows: [updatedRow] }); // update

      mockDb.transaction.mockImplementation((tId: string, uId: string, cb: any) =>
        cb({ query: querySpy }),
      );

      const res = await service.accept(tenantId, userId, ['owner'], 'rec-1');

      expect(res.recommendation.status).toBe('accepted');
      expect(res.next_action_url).toBe('/deals/new?contract_id=c-1');
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        expect.anything(),
        tenantId,
        expect.objectContaining({
          action: 'recommendation.accept',
          targetType: 'recommendation',
          targetId: 'rec-1',
        }),
      );

      // 発行されたクエリは recommendations テーブルの SELECT と UPDATE のみ
      expect(querySpy).toHaveBeenCalledTimes(2);
      expect(querySpy.mock.calls[0][0]).toContain('FROM recommendations');
      expect(querySpy.mock.calls[1][0]).toContain('UPDATE recommendations');
    });
  });

  describe('dismiss', () => {
    it('recommendationsテーブルのステータスをdismissedに更新すること', async () => {
      const existingRow = {
        id: 'rec-2',
        tenant_id: tenantId,
        type: 'approval_stale',
        target_domain: 'approval_requests',
        target_id: 'ar-1',
        title: '承認滞留',
        message: '確認推奨',
        status: 'new',
        action_url: '/approval-requests',
        metadata: {},
        shown_at: null,
        responded_at: null,
        created_at: '2026-09-20',
        updated_at: '2026-09-20',
      };
      const updatedRow = {
        ...existingRow,
        status: 'dismissed',
        responded_at: '2026-09-20T10:00:00Z',
      };

      const querySpy = jest.fn()
        .mockResolvedValueOnce({ rows: [existingRow] })
        .mockResolvedValueOnce({ rows: [updatedRow] });

      mockDb.transaction.mockImplementation((tId: string, uId: string, cb: any) =>
        cb({ query: querySpy }),
      );

      const res = await service.dismiss(tenantId, userId, ['owner'], 'rec-2');

      expect(res.recommendation.status).toBe('dismissed');
      expect(res.next_action_url).toBeNull();
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        expect.anything(),
        tenantId,
        expect.objectContaining({
          action: 'recommendation.dismiss',
          targetType: 'recommendation',
          targetId: 'rec-2',
        }),
      );
    });
  });

  describe('二重認可制御', () => {
    it('アクセス権のないドメインのレコメンド操作時は403を返すこと', async () => {
      const existingRow = {
        id: 'rec-1',
        tenant_id: tenantId,
        type: 'contract_renewal_pending',
        target_domain: 'contracts',
        target_id: 'c-1',
        status: 'new',
      };

      mockDb.transaction.mockImplementation((tId: string, uId: string, cb: any) =>
        cb({ query: jest.fn().mockResolvedValue({ rows: [existingRow] }) }),
      );

      // payroll_admin は contracts のアクセス権がない
      await expect(
        service.accept(tenantId, userId, ['payroll_admin'], 'rec-1'),
      ).rejects.toThrow(AppException);
    });
  });
});
