import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockDbService: {
    transaction: jest.Mock;
  };

  beforeEach(async () => {
    mockDbService = {
      transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: DatabaseService,
          useValue: mockDbService,
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  describe('list', () => {
    it('一覧と未読件数を取得できる', async () => {
      const tenantId = '11111111-1111-1111-1111-111111111111';
      const mockClient = {
        query: jest.fn(),
      };

      mockDbService.transaction.mockImplementation(async (tId, uId, callback) => {
        return callback(mockClient);
      });

      // 未読件数カウント
      mockClient.query.mockResolvedValueOnce({
        rows: [{ cnt: 3 }],
      });

      // 一覧
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'n1',
            tenant_id: tenantId,
            type: 'contract_expiry',
            target_type: 'contract',
            target_id: 'c1',
            title: '契約満了通知: 業務委託契約書',
            body: '満了します',
            status: 'unread',
            read_at: null,
            created_at: '2026-04-01T00:00:00Z',
            updated_at: '2026-04-01T00:00:00Z',
          },
        ],
      });

      const result = await service.list(tenantId, { limit: 20, offset: 0 });

      expect(result.unread_count).toBe(3);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('n1');
    });
  });

  describe('markAsRead', () => {
    it('通知を既読化し更新後レコードを返す', async () => {
      const tenantId = '11111111-1111-1111-1111-111111111111';
      const notifId = '22222222-2222-2222-2222-222222222222';
      const mockClient = {
        query: jest.fn(),
      };

      mockDbService.transaction.mockImplementation(async (tId, uId, callback) => {
        return callback(mockClient);
      });

      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: notifId,
            tenant_id: tenantId,
            type: 'contract_expiry',
            target_type: 'contract',
            target_id: 'c1',
            title: '契約満了通知',
            body: '満了します',
            status: 'read',
            read_at: '2026-04-01T12:00:00Z',
            created_at: '2026-04-01T00:00:00Z',
            updated_at: '2026-04-01T12:00:00Z',
          },
        ],
      });

      const result = await service.markAsRead(tenantId, notifId);
      expect(result.status).toBe('read');
      expect(result.read_at).not.toBeNull();
    });

    it('存在しない(または他テナントの)通知を既読化しようとすると NotFoundException を投げる', async () => {
      const tenantId = '11111111-1111-1111-1111-111111111111';
      const notifId = 'unknown-id';
      const mockClient = {
        query: jest.fn(),
      };

      mockDbService.transaction.mockImplementation(async (tId, uId, callback) => {
        return callback(mockClient);
      });

      mockClient.query.mockResolvedValueOnce({
        rows: [],
      });

      await expect(service.markAsRead(tenantId, notifId)).rejects.toThrow(NotFoundException);
    });
  });
});
