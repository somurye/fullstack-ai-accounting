import { Test, TestingModule } from '@nestjs/testing';
import { DealsService } from './deals.service';
import { DatabaseService } from '../../database/database.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AppException } from '../../common/exceptions/app.exception';
import type { DealRow } from './deals.mapper';

describe('DealsService', () => {
  let service: DealsService;
  let db: {
    transaction: jest.Mock;
    query: jest.Mock;
  };
  let auditLogs: {
    record: jest.Mock;
  };

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';
  const customerId = '33333333-3333-3333-3333-333333333333';
  const dealId = '44444444-4444-4444-4444-444444444444';

  const mockDealRow: DealRow = {
    id: dealId,
    tenant_id: tenantId,
    customer_id: customerId,
    title: '基幹システム導入商談',
    stage: 'lead',
    expected_amount: '1000000',
    currency_code: 'JPY',
    expected_close_date: '2026-10-31',
    owner_user_id: userId,
    lost_reason: null,
    closed_at: null,
    created_by: userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    customer_name: 'テスト株式会社',
    customer_code: 'CUST-001',
    owner_name: '山田 太郎',
    created_by_name: '山田 太郎',
  };

  const mockClient = {
    query: jest.fn(),
  };

  beforeEach(async () => {
    db = {
      transaction: jest.fn((tId, uId, cb) => cb(mockClient)),
      query: jest.fn(),
    };
    auditLogs = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DealsService,
        { provide: DatabaseService, useValue: db },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();

    service = module.get<DealsService>(DealsService);
  });

  describe('RBAC permission checks', () => {
    it('throws ForbiddenException if user lacks deal.view permission on list', async () => {
      await expect(
        service.list(tenantId, userId, ['viewer_external'], { page: 1, limit: 20 }),
      ).rejects.toThrow(AppException);
    });

    it('throws ForbiddenException if user lacks deal.create permission on create', async () => {
      await expect(
        service.create(tenantId, userId, ['accountant'], {
          customer_id: customerId,
          title: '商談',
          stage: 'lead',
          expected_amount: 0,
          currency_code: 'JPY',
        }),
      ).rejects.toThrow(AppException);
    });
  });

  describe('create', () => {
    it('creates deal successfully for user with employee role', async () => {
      // 顧客チェック
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: customerId }] });
      // INSERT RETURNING id
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: dealId }] });
      // 詳細取得
      mockClient.query.mockResolvedValueOnce({ rows: [mockDealRow] });

      const res = await service.create(tenantId, userId, ['employee'], {
        customer_id: customerId,
        title: '基幹システム導入商談',
        stage: 'lead',
        expected_amount: 1000000,
        currency_code: 'JPY',
      });

      expect(res.id).toBe(dealId);
      expect(res.title).toBe('基幹システム導入商談');
      expect(res.stage).toBe('lead');
      expect(auditLogs.record).toHaveBeenCalledWith(
        mockClient,
        tenantId,
        expect.objectContaining({
          actorUserId: userId,
          action: 'deal.create',
          targetType: 'deal',
          targetId: dealId,
        }),
      );
    });

    it('throws NotFound if customer does not exist in tenant', async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.create(tenantId, userId, ['employee'], {
          customer_id: customerId,
          title: '無効商談',
          stage: 'lead',
          expected_amount: 0,
          currency_code: 'JPY',
        }),
      ).rejects.toThrow(AppException);
    });
  });

  describe('update', () => {
    it('updates deal successfully when in lead stage', async () => {
      // SELECT FOR UPDATE
      mockClient.query.mockResolvedValueOnce({ rows: [mockDealRow] });
      // UPDATE
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 });
      // 詳細取得
      mockClient.query.mockResolvedValueOnce({
        rows: [{ ...mockDealRow, stage: 'proposal', expected_amount: '1500000' }],
      });

      const res = await service.update(tenantId, userId, ['employee'], dealId, {
        stage: 'proposal',
        expected_amount: 1500000,
      });

      expect(res.stage).toBe('proposal');
      expect(res.expected_amount).toBe(1500000);
      expect(auditLogs.record).toHaveBeenCalledWith(
        mockClient,
        tenantId,
        expect.objectContaining({
          actorUserId: userId,
          action: 'deal.update',
          targetType: 'deal',
          targetId: dealId,
        }),
      );
    });

    it('throws error if updating terminal deal (won)', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ ...mockDealRow, stage: 'won' }],
      });

      await expect(
        service.update(tenantId, userId, ['employee'], dealId, {
          title: '変更不可の商談',
        }),
      ).rejects.toThrow(AppException);
    });
  });

  describe('close', () => {
    it('closes deal with won successfully', async () => {
      // SELECT FOR UPDATE
      mockClient.query.mockResolvedValueOnce({ rows: [mockDealRow] });
      // UPDATE
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 });
      // 詳細取得
      mockClient.query.mockResolvedValueOnce({
        rows: [{ ...mockDealRow, stage: 'won', closed_at: new Date().toISOString() }],
      });

      const res = await service.close(tenantId, userId, ['employee'], dealId, {
        stage: 'won',
      });

      expect(res.stage).toBe('won');
      expect(res.is_terminal).toBe(true);
      expect(auditLogs.record).toHaveBeenCalledWith(
        mockClient,
        tenantId,
        expect.objectContaining({
          actorUserId: userId,
          action: 'deal.close',
          targetType: 'deal',
          targetId: dealId,
        }),
      );
    });

    it('throws error if closing with lost without lost_reason', async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [mockDealRow] });

      await expect(
        service.close(tenantId, userId, ['employee'], dealId, {
          stage: 'lost',
          lost_reason: '',
        }),
      ).rejects.toThrow(AppException);
    });
  });

  describe('delete', () => {
    it('throws error if deleting terminal deal', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ ...mockDealRow, stage: 'lost' }],
      });

      await expect(
        service.delete(tenantId, userId, ['employee'], dealId),
      ).rejects.toThrow(AppException);
    });

    it('throws error if linked quotations exist', async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [mockDealRow] });
      // 紐づく見積あり
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'quote-1', quote_no: 'QT-2026-0001' }],
      });

      await expect(
        service.delete(tenantId, userId, ['employee'], dealId),
      ).rejects.toThrow(AppException);
    });
  });
});
