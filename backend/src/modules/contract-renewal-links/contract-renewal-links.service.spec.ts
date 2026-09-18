import { Test, TestingModule } from '@nestjs/testing';
import { ContractRenewalLinksService } from './contract-renewal-links.service';
import { DatabaseService } from '../../database/database.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { DealsService } from '../deals/deals.service';
import { AppException } from '../../common/exceptions/app.exception';

describe('ContractRenewalLinksService', () => {
  let service: ContractRenewalLinksService;
  let mockDb: any;
  let mockAuditLogs: any;
  let mockDealsService: any;
  let mockClient: any;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';
  const contractId = '33333333-3333-3333-3333-333333333333';
  const customerId = '44444444-4444-4444-4444-444444444444';
  const dealId = '55555555-5555-5555-5555-555555555555';

  beforeEach(async () => {
    mockClient = {
      query: jest.fn(),
    };

    mockDb = {
      query: jest.fn(),
      transaction: jest.fn(async (tId, uId, cb) => cb(mockClient)),
    };

    mockAuditLogs = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    mockDealsService = {
      create: jest.fn().mockResolvedValue({
        id: dealId,
        title: '契約更新: クラウド利用規約',
        stage: 'lead',
        expected_amount: 1200000,
        expected_close_date: '2026-12-31',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractRenewalLinksService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: AuditLogsService, useValue: mockAuditLogs },
        { provide: DealsService, useValue: mockDealsService },
      ],
    }).compile();

    service = module.get<ContractRenewalLinksService>(ContractRenewalLinksService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createRenewalDeal RBAC', () => {
    it('should throw 403 if role does not have contract_renewal_link.create', async () => {
      await expect(
        service.createRenewalDeal(tenantId, userId, ['accountant'], { contract_id: contractId }),
      ).rejects.toThrow(AppException);
    });

    it('should allow employee to create renewal deal', async () => {
      // 契約SELECT
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: contractId,
            tenant_id: tenantId,
            contract_no: 'CON-2026-001',
            title: 'クラウド利用規約',
            counterparty_name: 'テスト顧客株式会社',
            contract_type: 'service',
            contract_amount: '1200000',
            currency: 'JPY',
            start_date: '2026-01-01',
            end_date: '2026-12-31',
            auto_renewal: true,
            status: 'active',
          },
        ],
      });

      // 顧客同名検索
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: customerId }],
      });

      // link INSERT
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'link-123',
            tenant_id: tenantId,
            contract_id: contractId,
            deal_id: dealId,
            quotation_id: null,
            created_by: userId,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      });

      const result = await service.createRenewalDeal(tenantId, userId, ['employee'], {
        contract_id: contractId,
      });

      expect(result.link.id).toBe('link-123');
      expect(result.deal.id).toBe(dealId);
      expect(mockDealsService.create).toHaveBeenCalledWith(
        tenantId,
        userId,
        ['employee'],
        expect.objectContaining({
          customer_id: customerId,
          stage: 'lead',
          expected_amount: 1200000,
        }),
        { skipPermissionCheck: true },
      );
      expect(mockAuditLogs.record).toHaveBeenCalled();
    });

    it('should throw 404 if contract does not exist in tenant', async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.createRenewalDeal(tenantId, userId, ['employee'], { contract_id: contractId }),
      ).rejects.toThrow(AppException);
    });

    it('should throw 400 if customer cannot be resolved (0 matches)', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: contractId,
            tenant_id: tenantId,
            contract_no: 'CON-2026-001',
            title: 'クラウド利用規約',
            counterparty_name: '未知の取引先',
            contract_type: 'service',
            contract_amount: '1200000',
            currency: 'JPY',
            start_date: '2026-01-01',
            end_date: '2026-12-31',
            auto_renewal: false,
            status: 'active',
          },
        ],
      });

      // 顧客検索 0件
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.createRenewalDeal(tenantId, userId, ['employee'], { contract_id: contractId }),
      ).rejects.toThrow(AppException);
    });

    it('should throw 400 fail-closed if customer has multiple candidates (2 or more matches)', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: contractId,
            tenant_id: tenantId,
            contract_no: 'CON-2026-001',
            title: 'クラウド利用規約',
            counterparty_name: '同名複数顧客株式会社',
            contract_type: 'service',
            contract_amount: '1200000',
            currency: 'JPY',
            start_date: '2026-01-01',
            end_date: '2026-12-31',
            auto_renewal: false,
            status: 'active',
          },
        ],
      });

      // 顧客検索 2件以上返却 (LIMIT 2)
      mockClient.query.mockResolvedValueOnce({
        rows: [
          { id: 'c1111111-1111-1111-1111-111111111111' },
          { id: 'c2222222-2222-2222-2222-222222222222' },
        ],
      });

      await expect(
        service.createRenewalDeal(tenantId, userId, ['employee'], { contract_id: contractId }),
      ).rejects.toThrow('一致する顧客が複数存在します');
    });
  });

  describe('findByDealId', () => {
    it('should throw 403 if role does not have contract_renewal_link.view', async () => {
      await expect(
        service.findByDealId(tenantId, userId, ['viewer_external'], dealId),
      ).rejects.toThrow(AppException);
    });

    it('should return link with contract details if exists', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'link-123',
            tenant_id: tenantId,
            contract_id: contractId,
            deal_id: dealId,
            quotation_id: null,
            created_by: userId,
            created_at: '2026-09-18T00:00:00Z',
            updated_at: '2026-09-18T00:00:00Z',
            contract_no: 'CON-2026-001',
            contract_title: 'クラウド利用規約',
            counterparty_name: 'テスト顧客株式会社',
            contract_type: 'service',
            contract_amount: '1200000',
            start_date: '2026-01-01',
            end_date: '2026-12-31',
            auto_renewal: true,
            contract_status: 'active',
          },
        ],
      });

      const result = await service.findByDealId(tenantId, userId, ['employee'], dealId);

      expect(result).not.toBeNull();
      expect(result?.contract?.contract_no).toBe('CON-2026-001');
      expect(result?.contract?.title).toBe('クラウド利用規約');
    });

    it('should return null if no link exists for deal', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.findByDealId(tenantId, userId, ['employee'], dealId);
      expect(result).toBeNull();
    });
  });

  describe('attachQuotation', () => {
    const quotationId = '66666666-6666-6666-6666-666666666666';

    it('should throw 403 if role does not have contract_renewal_link.create', async () => {
      await expect(
        service.attachQuotation(tenantId, userId, ['accountant'], dealId, quotationId),
      ).rejects.toThrow(AppException);
    });

    it('should throw 404 if link does not exist for deal', async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.attachQuotation(tenantId, userId, ['employee'], dealId, quotationId),
      ).rejects.toThrow(AppException);
    });

    it('should throw 400 if quotation is already attached (WORM once-only)', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'link-123', quotation_id: 'existing-quotation-id' }],
      });

      await expect(
        service.attachQuotation(tenantId, userId, ['employee'], dealId, quotationId),
      ).rejects.toThrow('既に見積書が紐付けられています');
    });

    it('should successfully attach quotation from NULL and record audit log', async () => {
      // 1. link SELECT (quotation_id is NULL)
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'link-123', quotation_id: null }],
      });
      // 2. UPDATE query
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 });
      // 3. row fetch (client.query)
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'link-123',
            tenant_id: tenantId,
            contract_id: contractId,
            deal_id: dealId,
            quotation_id: quotationId,
            created_by: userId,
            created_at: '2026-09-18T00:00:00Z',
            updated_at: '2026-09-18T00:00:00Z',
            contract_no: 'CON-2026-001',
            contract_title: 'クラウド利用規約',
            counterparty_name: 'テスト顧客株式会社',
            contract_type: 'service',
            contract_amount: '1200000',
            start_date: '2026-01-01',
            end_date: '2026-12-31',
            auto_renewal: true,
            contract_status: 'active',
          },
        ],
      });

      const result = await service.attachQuotation(tenantId, userId, ['employee'], dealId, quotationId);

      expect(result.quotation_id).toBe(quotationId);
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        tenantId,
        expect.objectContaining({
          action: 'contract_renewal_link.attach_quotation',
          targetType: 'contract_renewal_link',
          targetId: 'link-123',
        }),
      );
    });
  });
});
