import { Test, TestingModule } from '@nestjs/testing';
import { SalesDashboardService } from './sales-dashboard.service';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';

describe('SalesDashboardService', () => {
  let service: SalesDashboardService;
  let mockDb: any;
  let mockClient: any;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';

  beforeEach(async () => {
    mockClient = {
      query: jest.fn(),
    };

    mockDb = {
      query: jest.fn(),
      transaction: jest.fn(async (tId, uId, cb) => cb(mockClient)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesDashboardService,
        { provide: DatabaseService, useValue: mockDb },
      ],
    }).compile();

    service = module.get<SalesDashboardService>(SalesDashboardService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('RBAC checks', () => {
    it('should throw 403 Forbidden if role does not have dashboard.view', async () => {
      await expect(
        service.getSummary(tenantId, userId, ['viewer_external']),
      ).rejects.toThrow(AppException);

      await expect(
        service.getSummary(tenantId, userId, ['payroll_admin']),
      ).rejects.toThrow(AppException);
    });

    it('should allow employee, accountant, legal_admin, owner to view dashboard', async () => {
      // deals
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      // quotations
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      // alert contracts
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      // total renewal links
      mockClient.query.mockResolvedValueOnce({ rows: [{ count: 0 }] });
      // linked deals stage
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const res = await service.getSummary(tenantId, userId, ['employee']);
      expect(res).toBeDefined();
      expect(res.pipeline.win_rate).toBe(0);
      expect(res.quotations.conversion_rate).toBe(0);
      expect(res.renewals.renewal_proposal_rate).toBe(0);
    });
  });

  describe('Aggregation calculations', () => {
    it('should correctly calculate pipeline, win rate, quotation conversion, and renewal rate', async () => {
      // 1. deals クエリ結果モック
      mockClient.query.mockResolvedValueOnce({
        rows: [
          { stage: 'lead', count: 2, total_amount: '2000000' },
          { stage: 'qualified', count: 1, total_amount: '1500000' },
          { stage: 'proposal', count: 1, total_amount: '3000000' },
          { stage: 'negotiation', count: 1, total_amount: '2500000' },
          { stage: 'won', count: 3, total_amount: '9000000' },
          { stage: 'lost', count: 1, total_amount: '1000000' },
        ],
      });

      // 2. quotations クエリ結果モック
      mockClient.query.mockResolvedValueOnce({
        rows: [
          { status: 'draft', count: 3, total_amount: '1500000' },
          { status: 'sent', count: 2, total_amount: '2000000' },
          { status: 'accepted', count: 3, total_amount: '4500000' },
          { status: 'rejected', count: 1, total_amount: '500000' },
          { status: 'expired', count: 0, total_amount: '0' },
        ],
      });

      // 3. alert contracts クエリ結果モック
      mockClient.query.mockResolvedValueOnce({
        rows: [
          { id: 'c1', has_link: true },
          { id: 'c2', has_link: true },
          { id: 'c3', has_link: false },
          { id: 'c4', has_link: false },
        ],
      });

      // 4. total renewal links クエリ結果モック
      mockClient.query.mockResolvedValueOnce({
        rows: [{ count: 5 }],
      });

      // 5. linked deals stage クエリ結果モック
      mockClient.query.mockResolvedValueOnce({
        rows: [
          { stage: 'lead', count: 2, total_amount: '2000000' },
          { stage: 'won', count: 2, total_amount: '6000000' },
        ],
      });

      const summary = await service.getSummary(tenantId, userId, ['owner']);

      // 案件パイプライン検証
      expect(summary.pipeline.open_deals.count).toBe(5); // 2 + 1 + 1 + 1
      expect(summary.pipeline.open_deals.total_amount).toBe(9000000); // 2M + 1.5M + 3M + 2.5M
      expect(summary.pipeline.won_deals.count).toBe(3);
      expect(summary.pipeline.won_deals.total_amount).toBe(9000000);
      expect(summary.pipeline.lost_deals.count).toBe(1);
      expect(summary.pipeline.lost_deals.total_amount).toBe(1000000);
      expect(summary.pipeline.total_deals.count).toBe(9);
      expect(summary.pipeline.total_deals.total_amount).toBe(19000000);
      // win_rate = won / (won + lost) = 3 / (3 + 1) = 0.75
      expect(summary.pipeline.win_rate).toBe(0.75);

      // 見積集計検証
      expect(summary.quotations.draft.count).toBe(3);
      expect(summary.quotations.sent.count).toBe(2);
      expect(summary.quotations.accepted.count).toBe(3);
      expect(summary.quotations.rejected.count).toBe(1);
      expect(summary.quotations.total_quotations.count).toBe(9);
      expect(summary.quotations.total_quotations.total_amount).toBe(8500000);
      // actionable_count = sent(2) + accepted(3) + rejected(1) + expired(0) = 6
      expect(summary.quotations.actionable_count).toBe(6);
      // conversion_rate = accepted / actionable = 3 / 6 = 0.5
      expect(summary.quotations.conversion_rate).toBe(0.5);

      // 契約更新連携進捗検証
      expect(summary.renewals.expiring_contracts_count).toBe(4);
      expect(summary.renewals.linked_contracts_count).toBe(2);
      // renewal_proposal_rate = 2 / 4 = 0.5
      expect(summary.renewals.renewal_proposal_rate).toBe(0.5);
      expect(summary.renewals.total_renewal_links_count).toBe(5);
      expect(summary.renewals.linked_deals_stage_distribution.lead.count).toBe(2);
      expect(summary.renewals.linked_deals_stage_distribution.won.count).toBe(2);
      expect(summary.renewals.linked_deals_stage_distribution.total.count).toBe(4);
    });

    it('should safely handle zero denominators without divide-by-zero errors', async () => {
      // 全テーブル0件
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      mockClient.query.mockResolvedValueOnce({ rows: [{ count: 0 }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const summary = await service.getSummary(tenantId, userId, ['owner']);

      expect(summary.pipeline.win_rate).toBe(0);
      expect(summary.quotations.conversion_rate).toBe(0);
      expect(summary.renewals.renewal_proposal_rate).toBe(0);
    });
  });
});
