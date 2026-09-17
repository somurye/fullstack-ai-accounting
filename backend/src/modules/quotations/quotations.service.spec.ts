import { AppException } from '../../common/exceptions/app.exception';
import type { DatabaseService } from '../../database/database.service';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { QuotationPdfService } from './quotation-pdf.service';
import { QuotationsService } from './quotations.service';

describe('QuotationsService', () => {
  let service: QuotationsService;
  let mockDb: { transaction: jest.Mock };
  let mockAuditLogs: { record: jest.Mock };
  let mockPdfService: { generatePdf: jest.Mock };
  let mockClient: { query: jest.Mock };

  const TENANT_ID = '11111111-1111-1111-1111-111111111111';
  const USER_ID = '22222222-2222-2222-2222-222222222222';
  const CUSTOMER_ID = '33333333-3333-3333-3333-333333333333';
  const QUOTATION_ID = '44444444-4444-4444-4444-444444444444';
  const INVOICE_ID = '55555555-5555-5555-5555-555555555555';

  const sampleQuotationRow = {
    id: QUOTATION_ID,
    tenant_id: TENANT_ID,
    customer_id: CUSTOMER_ID,
    customer_code: 'CUST-001',
    customer_name: 'テスト株式会社',
    deal_id: null,
    quote_no: 'QT-2026-0001',
    title: 'システム開発見積',
    status: 'draft',
    valid_until: '2026-10-31',
    issue_date: '2026-09-17',
    subtotal: '100000.00',
    tax_amount: '10000.00',
    total_amount: '110000.00',
    currency_code: 'JPY',
    version: 1,
    superseded_by: null,
    superseded_by_quote_no: null,
    notes: '納品後30日以内支払い',
    converted_invoice_id: null,
    converted_invoice_no: null,
    converted_at: null,
    converted_by: null,
    created_by: USER_ID,
    creator_name: '営業担当者',
    created_at: new Date('2026-09-17T09:00:00Z'),
    updated_at: new Date('2026-09-17T09:00:00Z'),
  };

  const sampleLineRows = [
    {
      id: '66666666-6666-6666-6666-666666666661',
      tenant_id: TENANT_ID,
      quotation_id: QUOTATION_ID,
      line_no: 1,
      item_name: '要件定義・設計費',
      description: '初期設計',
      quantity: '1.00',
      unit: '式',
      unit_price: '100000.00',
      amount: '100000.00',
      tax_rate: '0.1000',
      tax_category_id: null,
      tax_category_name: '標準税率(10%)',
      created_at: new Date('2026-09-17T09:00:00Z'),
      updated_at: new Date('2026-09-17T09:00:00Z'),
    },
  ];

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
    mockPdfService = {
      generatePdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock pdf data')),
    };

    service = new QuotationsService(
      mockDb as unknown as DatabaseService,
      mockAuditLogs as unknown as AuditLogsService,
      mockPdfService as unknown as QuotationPdfService,
    );
  });

  describe('list', () => {
    it('見積一覧とページネーション情報を正しく取得できること', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ total: '1' }] }) // count
        .mockResolvedValueOnce({ rows: [sampleQuotationRow] }); // select

      const result = await service.list(TENANT_ID, USER_ID, { page: 1, limit: 20 });

      expect(result.quotations).toHaveLength(1);
      expect(result.quotations[0].quote_no).toBe('QT-2026-0001');
      expect(result.quotations[0].total_amount).toBe(110000);
      expect(result.pagination.total_count).toBe(1);
    });
  });

  describe('findById', () => {
    it('存在する見積書の詳細と明細を取得できること', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [sampleQuotationRow] }) // quote
        .mockResolvedValueOnce({ rows: sampleLineRows }); // lines

      const result = await service.findById(TENANT_ID, USER_ID, QUOTATION_ID);

      expect(result.id).toBe(QUOTATION_ID);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].item_name).toBe('要件定義・設計費');
      expect(result.lines[0].amount).toBe(100000);
    });

    it('存在しない見積書の場合はNotFound例外を送出すること', async () => {
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      await expect(service.findById(TENANT_ID, USER_ID, 'non-existent-id')).rejects.toThrow(
        AppException,
      );
    });
  });

  describe('create', () => {
    it('顧客確認・採番・金額計算・明細作成・監査ログ記録を経て新規作成できること', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ id: CUSTOMER_ID }] }) // customer check
        .mockResolvedValueOnce({ rows: [] }) // advisory lock
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // count quote_no
        .mockResolvedValueOnce({ rows: [{ id: QUOTATION_ID }] }) // insert quotation
        .mockResolvedValueOnce({ rows: [] }) // insert line item
        .mockResolvedValueOnce({ rows: [sampleQuotationRow] }) // findByIdInternal quote
        .mockResolvedValueOnce({ rows: sampleLineRows }); // findByIdInternal lines

      const result = await service.create(TENANT_ID, USER_ID, {
        customer_id: CUSTOMER_ID,
        title: 'システム開発見積',
        lines: [
          {
            item_name: '要件定義・設計費',
            description: '初期設計',
            quantity: 1,
            unit: '式',
            unit_price: 100000,
            tax_rate: 0.1,
          },
        ],
      });

      expect(result.id).toBe(QUOTATION_ID);
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({
          action: 'quotation.create',
          targetId: QUOTATION_ID,
        }),
      );
    });
  });

  describe('update', () => {
    it('draft状態の見積書を正しく更新できること', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [sampleQuotationRow] }) // lock existing
        .mockResolvedValueOnce({ rows: [] }) // delete lines
        .mockResolvedValueOnce({ rows: [] }) // insert line
        .mockResolvedValueOnce({ rows: [] }) // update quotation
        .mockResolvedValueOnce({ rows: [{ ...sampleQuotationRow, title: '更新後タイトル' }] }) // findById quote
        .mockResolvedValueOnce({ rows: sampleLineRows }); // findById lines

      const result = await service.update(TENANT_ID, USER_ID, QUOTATION_ID, {
        title: '更新後タイトル',
        lines: [
          {
            item_name: '要件定義・設計費',
            quantity: 1,
            unit: '式',
            unit_price: 100000,
            tax_rate: 0.1,
          },
        ],
      });

      expect(result.title).toBe('更新後タイトル');
    });

    it('sent状態の見積書の直接更新はBadRequest例外となること (WORM原則)', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ ...sampleQuotationRow, status: 'sent' }],
      });

      await expect(
        service.update(TENANT_ID, USER_ID, QUOTATION_ID, { title: '改変タイトル' }),
      ).rejects.toThrow(AppException);
    });
  });

  describe('send', () => {
    it('draft状態の見積書をsentに遷移できること', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [sampleQuotationRow] }) // lock
        .mockResolvedValueOnce({ rows: [] }) // update status
        .mockResolvedValueOnce({ rows: [{ ...sampleQuotationRow, status: 'sent' }] }) // findById quote
        .mockResolvedValueOnce({ rows: sampleLineRows }); // findById lines

      const result = await service.send(TENANT_ID, USER_ID, QUOTATION_ID);

      expect(result.status).toBe('sent');
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({ action: 'quotation.send' }),
      );
    });
  });

  describe('revise', () => {
    it('sent状態の見積書から新バージョン(v2)を発行し、旧見積にsuperseded_byをリンクすること', async () => {
      const NEW_QUOTATION_ID = '77777777-7777-7777-7777-777777777777';
      const sentQuotationRow = { ...sampleQuotationRow, status: 'sent' };

      mockClient.query
        .mockResolvedValueOnce({ rows: [sentQuotationRow] }) // lock old
        .mockResolvedValueOnce({ rows: sampleLineRows }) // get old lines
        .mockResolvedValueOnce({ rows: [{ id: NEW_QUOTATION_ID }] }) // insert new quotation (v2)
        .mockResolvedValueOnce({ rows: [] }) // copy lines
        .mockResolvedValueOnce({ rows: [] }) // update old quotation superseded_by
        .mockResolvedValueOnce({
          rows: [{ ...sampleQuotationRow, id: NEW_QUOTATION_ID, version: 2, status: 'draft' }],
        }) // findById quote
        .mockResolvedValueOnce({ rows: sampleLineRows }); // findById lines

      const result = await service.revise(TENANT_ID, USER_ID, QUOTATION_ID, { notes: '仕様変更改訂' });

      expect(result.id).toBe(NEW_QUOTATION_ID);
      expect(result.version).toBe(2);
      expect(result.status).toBe('draft');
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({ action: 'quotation.revise' }),
      );
    });

    it('既にsuperseded_byが設定されている見積からの二重改訂はエラーとなること', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ ...sampleQuotationRow, status: 'sent', superseded_by: 'already-revised-id' }],
      });

      await expect(
        service.revise(TENANT_ID, USER_ID, QUOTATION_ID, { notes: '二重改訂' }),
      ).rejects.toThrow(AppException);
    });
  });

  describe('convert', () => {
    it('accepted状態の見積から売上請求書(invoices)を作成し多重転換防止IDを記録すること', async () => {
      const acceptedQuotationRow = { ...sampleQuotationRow, status: 'accepted' };

      mockClient.query
        .mockResolvedValueOnce({ rows: [acceptedQuotationRow] }) // lock quote
        .mockResolvedValueOnce({ rows: sampleLineRows }) // lines
        .mockResolvedValueOnce({ rows: [] }) // lock invoice_no
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // invoice count
        .mockResolvedValueOnce({ rows: [{ id: 'account-revenue-id' }] }) // revenue account
        .mockResolvedValueOnce({ rows: [{ id: 'tax-10-id' }] }) // tax category
        .mockResolvedValueOnce({ rows: [{ id: INVOICE_ID }] }) // insert invoice
        .mockResolvedValueOnce({ rows: [] }) // insert invoice_lines
        .mockResolvedValueOnce({ rows: [] }) // update quotation converted_invoice_id
        .mockResolvedValueOnce({
          rows: [
            {
              ...acceptedQuotationRow,
              converted_invoice_id: INVOICE_ID,
              converted_invoice_no: 'INV-2026-0001',
            },
          ],
        }) // findById quote
        .mockResolvedValueOnce({ rows: sampleLineRows }); // findById lines

      const result = await service.convert(TENANT_ID, USER_ID, QUOTATION_ID);

      expect(result.invoiceId).toBe(INVOICE_ID);
      expect(result.quotation.converted_invoice_id).toBe(INVOICE_ID);
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({ action: 'quotation.convert' }),
      );
    });

    it('既に受注転換済みの見積書の再転換はBadRequest例外となること (多重転換防止)', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ ...sampleQuotationRow, status: 'accepted', converted_invoice_id: INVOICE_ID }],
      });

      await expect(service.convert(TENANT_ID, USER_ID, QUOTATION_ID)).rejects.toThrow(
        AppException,
      );
    });
  });
});
