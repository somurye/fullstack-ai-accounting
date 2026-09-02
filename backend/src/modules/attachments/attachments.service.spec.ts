import { AttachmentsService, type UploadedFileLike } from './attachments.service';
import type { DatabaseService } from '../../database/database.service';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { AttachmentRow } from './attachments.mapper';

describe('AttachmentsService', () => {
  let service: AttachmentsService;
  let mockDb: { transaction: jest.Mock };
  let mockAuditLogs: { record: jest.Mock };
  let mockClient: { query: jest.Mock };

  const tenantId = '00000000-0000-0000-0000-000000000001';
  const userId = '00000000-0000-0000-0000-000000000010';

  const sampleFile: UploadedFileLike = {
    originalname: 'test_doc.pdf',
    mimetype: 'application/pdf',
    buffer: Buffer.from('test file content'),
    size: 17,
  };

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
    };
    mockDb = {
      transaction: jest.fn().mockImplementation((_tId, _uId, cb) => cb(mockClient)),
    };
    mockAuditLogs = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    service = new AttachmentsService(
      mockDb as unknown as DatabaseService,
      mockAuditLogs as unknown as AuditLogsService,
    );
  });

  describe('upload', () => {
    it('既存の証憑(receipt)アップロードが正常に動作し、3項目とdocument_categoryが保存される', async () => {
      const mockRow: AttachmentRow = {
        id: 'att-001',
        file_name: 'test_doc.pdf',
        storage_path: '/uploads/test_doc.pdf',
        mime_type: 'application/pdf',
        file_hash: 'mockhash123',
        document_category: 'receipt',
        transaction_date: '2026-09-01',
        amount: '10000.00',
        counterparty_name: '株式会社テスト',
        uploaded_by: userId,
        uploaded_at: new Date('2026-09-01T10:00:00Z'),
      };
      mockClient.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await service.upload(tenantId, userId, sampleFile, {
        document_category: 'receipt',
        transaction_date: '2026-09-01',
        amount: 10000,
        counterparty_name: '株式会社テスト',
      });

      expect(result.id).toBe('att-001');
      expect(result.document_category).toBe('receipt');
      expect(result.amount).toBe(10000);
      expect(result.counterparty_name).toBe('株式会社テスト');

      const insertCall = mockClient.query.mock.calls[0];
      expect(insertCall[0]).toContain('INSERT INTO attachments');
      expect(insertCall[1][5]).toBe('receipt');
      expect(insertCall[1][6]).toBe('2026-09-01');
      expect(insertCall[1][7]).toBe(10000);
      expect(insertCall[1][8]).toBe('株式会社テスト');

      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        tenantId,
        expect.objectContaining({
          action: 'attachment.uploaded',
          targetId: 'att-001',
          afterData: expect.objectContaining({
            document_category: 'receipt',
          }),
        }),
      );
    });

    it('新ドメイン(contract)の文書アップロードで金額なしでも登録でき、document_category=contractとなる', async () => {
      const mockRow: AttachmentRow = {
        id: 'att-002',
        file_name: 'contract_nda.pdf',
        storage_path: '/uploads/contract_nda.pdf',
        mime_type: 'application/pdf',
        file_hash: 'mockhash456',
        document_category: 'contract',
        transaction_date: null,
        amount: null,
        counterparty_name: '提携先株式会社',
        uploaded_by: userId,
        uploaded_at: new Date('2026-09-01T11:00:00Z'),
      };
      mockClient.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await service.upload(tenantId, userId, sampleFile, {
        document_category: 'contract',
        counterparty_name: '提携先株式会社',
      });

      expect(result.id).toBe('att-002');
      expect(result.document_category).toBe('contract');
      expect(result.amount).toBeUndefined();
      expect(result.counterparty_name).toBe('提携先株式会社');

      const insertCall = mockClient.query.mock.calls[0];
      expect(insertCall[1][5]).toBe('contract');
      expect(insertCall[1][6]).toBeNull();
      expect(insertCall[1][7]).toBeNull();
    });
  });

  describe('list', () => {
    it('document_category で絞り込みクエリが正しく構築される', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'att-002',
              file_name: 'contract.pdf',
              storage_path: '/uploads/contract.pdf',
              mime_type: 'application/pdf',
              file_hash: 'hash',
              document_category: 'contract',
              transaction_date: null,
              amount: null,
              counterparty_name: '取引先',
              uploaded_by: userId,
              uploaded_at: new Date(),
            },
          ],
        });

      const result = await service.list(tenantId, userId, {
        page: 1,
        page_size: 10,
        document_category: 'contract',
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].document_category).toBe('contract');

      const countCall = mockClient.query.mock.calls[0];
      expect(countCall[0]).toContain('document_category = $2');
      expect(countCall[1]).toEqual([tenantId, 'contract']);
    });

    it('電帳法3項目(日付範囲・金額・取引先名trgm)で複合検索できる', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({ rows: [] });

      await service.list(tenantId, userId, {
        page: 1,
        page_size: 20,
        transaction_date_from: '2026-08-01',
        transaction_date_to: '2026-08-31',
        amount: 50000,
        counterparty_name: 'サンプル',
      });

      const countCall = mockClient.query.mock.calls[0];
      expect(countCall[0]).toContain('transaction_date >= $2');
      expect(countCall[0]).toContain('transaction_date <= $3');
      expect(countCall[0]).toContain('amount = $4');
      expect(countCall[0]).toContain('counterparty_name ILIKE $5');
      expect(countCall[1]).toEqual([tenantId, '2026-08-01', '2026-08-31', 50000, '%サンプル%']);
    });
  });

  describe('findById', () => {
    it('存在する添付ファイルのメタデータを返す', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'att-001',
            file_name: 'test.pdf',
            storage_path: '/uploads/test.pdf',
            mime_type: 'application/pdf',
            file_hash: 'hash',
            document_category: 'invoice',
            transaction_date: '2026-09-01',
            amount: '30000.00',
            counterparty_name: '請求元',
            uploaded_by: userId,
            uploaded_at: new Date(),
          },
        ],
      });

      const result = await service.findById(tenantId, userId, 'att-001');
      expect(result.id).toBe('att-001');
      expect(result.document_category).toBe('invoice');
    });

    it('存在しない場合は 404 NotFound 例外をスローする', async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.findById(tenantId, userId, 'not-found-id')).rejects.toThrow(
        '指定された添付ファイルが見つかりません',
      );
    });
  });

  describe('link', () => {
    it('業務レコードへの関連付けが成功する', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 });

      await service.link(tenantId, userId, 'att-001', {
        linkable_type: 'journal_entry',
        linkable_id: '00000000-0000-0000-0000-000000000100',
      });

      expect(mockClient.query).toHaveBeenCalledTimes(2);
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        tenantId,
        expect.objectContaining({
          action: 'attachment.linked',
          targetType: 'journal_entry',
        }),
      );
    });
  });
});
