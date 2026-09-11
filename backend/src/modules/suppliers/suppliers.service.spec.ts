import { AppException } from '../../common/exceptions/app.exception';
import type { DatabaseService } from '../../database/database.service';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import { SuppliersService } from './suppliers.service';

describe('SuppliersService', () => {
  let service: SuppliersService;
  let mockDb: { transaction: jest.Mock };
  let mockAuditLogs: { record: jest.Mock };
  let mockClient: { query: jest.Mock };

  const TENANT_ID = '11111111-1111-1111-1111-111111111111';
  const USER_ID = '22222222-2222-2222-2222-222222222222';
  const SUPPLIER_ID = '33333333-3333-3333-3333-333333333333';

  const sampleSupplierRow = {
    id: SUPPLIER_ID,
    tenant_id: TENANT_ID,
    name: '株式会社サプライテスト',
    contact_name: '山田 太郎',
    contact_email: 'yamada@example.com',
    contact_phone: '03-1234-5678',
    payment_terms: '月末締め翌月末払い',
    status: 'active',
    created_by: USER_ID,
    created_at: new Date('2026-09-12T10:00:00Z'),
    updated_at: new Date('2026-09-12T10:00:00Z'),
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

    service = new SuppliersService(
      mockDb as unknown as DatabaseService,
      mockAuditLogs as unknown as AuditLogsService,
    );
  });

  describe('list', () => {
    it('サプライヤー一覧を取得できる', async () => {
      // 1. assertUserPermission
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
      // 2. COUNT
      mockClient.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
      // 3. SELECT
      mockClient.query.mockResolvedValueOnce({ rows: [sampleSupplierRow] });

      const result = await service.list(TENANT_ID, USER_ID, {
        page: 1,
        page_size: 20,
      });

      expect(result.suppliers).toHaveLength(1);
      expect(result.suppliers[0].name).toBe('株式会社サプライテスト');
      expect(result.pagination.total_count).toBe(1);
    });

    it('閲覧権限(supplier.view)がない場合は403 Forbidden', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(
        service.list(TENANT_ID, USER_ID, { page: 1, page_size: 20 }),
      ).rejects.toThrow(AppException);
    });
  });

  describe('getById', () => {
    it('サプライヤー詳細を取得できる', async () => {
      // 1. assertUserPermission
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
      // 2. SELECT
      mockClient.query.mockResolvedValueOnce({ rows: [sampleSupplierRow] });

      const result = await service.getById(TENANT_ID, USER_ID, SUPPLIER_ID);
      expect(result.id).toBe(SUPPLIER_ID);
      expect(result.name).toBe('株式会社サプライテスト');
    });

    it('存在しないサプライヤーIDの場合は404 NotFound', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.getById(TENANT_ID, USER_ID, SUPPLIER_ID),
      ).rejects.toThrow(AppException);
    });
  });

  describe('create', () => {
    it('サプライヤーを新規登録できる', async () => {
      // 1. assertUserPermission
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
      // 2. dupCheck
      mockClient.query.mockResolvedValueOnce({ rows: [] });
      // 3. INSERT RETURNING
      mockClient.query.mockResolvedValueOnce({ rows: [sampleSupplierRow] });

      const result = await service.create(TENANT_ID, USER_ID, {
        name: '株式会社サプライテスト',
        contact_name: '山田 太郎',
        contact_email: 'yamada@example.com',
        contact_phone: '03-1234-5678',
        payment_terms: '月末締め翌月末払い',
        status: 'active',
      });

      expect(result.name).toBe('株式会社サプライテスト');
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({
          action: 'supplier.created',
          targetType: 'supplier',
        }),
      );
    });

    it('同名サプライヤーが既に存在する場合は409 Conflict', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'other-id' }] });

      await expect(
        service.create(TENANT_ID, USER_ID, {
          name: '株式会社サプライテスト',
          status: 'active',
        }),
      ).rejects.toThrow(AppException);
    });

    it('作成権限(supplier.create)がない場合は403 Forbidden', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(
        service.create(TENANT_ID, USER_ID, {
          name: '株式会社サプライテスト',
          status: 'active',
        }),
      ).rejects.toThrow(AppException);
    });
  });

  describe('update', () => {
    it('サプライヤー情報を更新できる', async () => {
      // 1. assertUserPermission
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
      // 2. existingRes
      mockClient.query.mockResolvedValueOnce({ rows: [sampleSupplierRow] });
      // 3. UPDATE RETURNING
      const updatedRow = { ...sampleSupplierRow, contact_name: '佐藤 次郎' };
      mockClient.query.mockResolvedValueOnce({ rows: [updatedRow] });

      const result = await service.update(TENANT_ID, USER_ID, SUPPLIER_ID, {
        contact_name: '佐藤 次郎',
      });

      expect(result.contact_name).toBe('佐藤 次郎');
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({
          action: 'supplier.updated',
          targetType: 'supplier',
        }),
      );
    });

    it('存在しないサプライヤーの更新は404 NotFound', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        service.update(TENANT_ID, USER_ID, SUPPLIER_ID, { name: '新名称' }),
      ).rejects.toThrow(AppException);
    });

    it('名前変更時に別サプライヤーと同名になる場合は409 Conflict', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });
      mockClient.query.mockResolvedValueOnce({ rows: [sampleSupplierRow] });
      mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'other-id' }] }); // dupCheck

      await expect(
        service.update(TENANT_ID, USER_ID, SUPPLIER_ID, { name: '重複する会社名' }),
      ).rejects.toThrow(AppException);
    });

    it('編集権限(supplier.edit)がない場合は403 Forbidden', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(
        service.update(TENANT_ID, USER_ID, SUPPLIER_ID, { contact_name: '佐藤' }),
      ).rejects.toThrow(AppException);
    });
  });
});
