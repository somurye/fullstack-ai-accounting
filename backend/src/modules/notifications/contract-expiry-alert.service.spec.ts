import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service';
import { ContractExpiryAlertService } from './contract-expiry-alert.service';

describe('ContractExpiryAlertService', () => {
  let service: ContractExpiryAlertService;
  let mockDbService: {
    query: jest.Mock;
    transaction: jest.Mock;
  };

  beforeEach(async () => {
    mockDbService = {
      query: jest.fn(),
      transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractExpiryAlertService,
        {
          provide: DatabaseService,
          useValue: mockDbService,
        },
      ],
    }).compile();

    service = module.get<ContractExpiryAlertService>(ContractExpiryAlertService);
  });

  describe('runBatch', () => {
    it('全有効テナントをループし、各テナントに対して独立したトランザクションで処理する', async () => {
      const tenant1 = '11111111-1111-1111-1111-111111111111';
      const tenant2 = '22222222-2222-2222-2222-222222222222';

      mockDbService.query.mockResolvedValueOnce({
        rows: [{ id: tenant1 }, { id: tenant2 }],
      });

      // processTenant のモック
      jest.spyOn(service, 'processTenant')
        .mockResolvedValueOnce(2) // tenant1: 2件作成
        .mockResolvedValueOnce(1); // tenant2: 1件作成

      const result = await service.runBatch();

      expect(result.processedTenants).toBe(2);
      expect(result.createdNotifications).toBe(3);
      expect(result.failedTenantsCount).toBe(0);
      expect(service.processTenant).toHaveBeenCalledWith(tenant1);
      expect(service.processTenant).toHaveBeenCalledWith(tenant2);
    });

    it('1テナントでエラーが発生しても、他テナントの処理を継続する (障害隔離原則)', async () => {
      const tenant1 = '11111111-1111-1111-1111-111111111111';
      const tenant2 = '22222222-2222-2222-2222-222222222222';

      mockDbService.query.mockResolvedValueOnce({
        rows: [{ id: tenant1 }, { id: tenant2 }],
      });

      jest.spyOn(service, 'processTenant')
        .mockRejectedValueOnce(new Error('DB connection timeout on tenant 1'))
        .mockResolvedValueOnce(1); // tenant 2 は成功

      const result = await service.runBatch();

      expect(result.processedTenants).toBe(2);
      expect(result.createdNotifications).toBe(1);
      expect(result.failedTenantsCount).toBe(1);
      expect(service.processTenant).toHaveBeenCalledWith(tenant2);
    });
  });

  describe('processTenant', () => {
    it('期限間近の契約を抽出し、auto_renewalに応じて文面を分けて未読通知を作成する', async () => {
      const tenantId = '11111111-1111-1111-1111-111111111111';

      const mockClient = {
        query: jest.fn(),
      };

      mockDbService.transaction.mockImplementation(async (tId, uId, callback) => {
        expect(tId).toBe(tenantId);
        expect(uId).toBeNull();
        return callback(mockClient);
      });

      // 契約2件: 1件はauto_renewal=false(満了), 1件はauto_renewal=true(自動更新)
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'c1',
            contract_no: 'CNT-001',
            title: '業務委託契約書',
            end_date: '2026-04-30',
            auto_renewal: false,
            renewal_notice_days: 30,
          },
          {
            id: 'c2',
            contract_no: 'CNT-002',
            title: 'SaaS利用許諾契約',
            end_date: '2026-05-15',
            auto_renewal: true,
            renewal_notice_days: 30,
          },
        ],
      });

      // c1 の未読確認: なし (rowCount: 0)
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      // c1 の INSERT: 成功 (rowCount: 1)
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 });

      // c2 の未読確認: なし (rowCount: 0)
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      // c2 の INSERT: 成功 (rowCount: 1)
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 });

      const created = await service.processTenant(tenantId);

      expect(created).toBe(2);

      // c1 の INSERT 引数確認 (満了文面)
      const c1InsertCall = mockClient.query.mock.calls[2];
      expect(c1InsertCall[1][2]).toBe('契約満了通知: 業務委託契約書');
      expect(c1InsertCall[1][3]).toContain('満了します。更新手続きが必要です');

      // c2 の INSERT 引数確認 (自動更新文面)
      const c2InsertCall = mockClient.query.mock.calls[4];
      expect(c2InsertCall[1][2]).toBe('契約更新通知: SaaS利用許諾契約');
      expect(c2InsertCall[1][3]).toContain('自動更新されます');
    });

    it('既に未読通知が存在する場合は重複作成をスキップする (重複防止)', async () => {
      const tenantId = '11111111-1111-1111-1111-111111111111';

      const mockClient = {
        query: jest.fn(),
      };

      mockDbService.transaction.mockImplementation(async (tId, uId, callback) => {
        return callback(mockClient);
      });

      // 契約1件
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'c1',
            contract_no: 'CNT-001',
            title: '業務委託契約書',
            end_date: '2026-04-30',
            auto_renewal: false,
            renewal_notice_days: 30,
          },
        ],
      });

      // 未読通知が既に存在する (rowCount: 1)
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 'existing-notif-1' }],
      });

      const created = await service.processTenant(tenantId);

      expect(created).toBe(0);
      // INSERT クエリは呼ばれない
      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });
  });
});
