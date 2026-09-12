import { AppException } from '../../common/exceptions/app.exception';
import type { DatabaseService } from '../../database/database.service';
import type { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PurchaseRequestsService } from './purchase-requests.service';

describe('PurchaseRequestsService', () => {
  let service: PurchaseRequestsService;
  let mockDb: { transaction: jest.Mock };
  let mockAuditLogs: { record: jest.Mock };
  let mockClient: { query: jest.Mock };

  const TENANT_ID = '11111111-1111-1111-1111-111111111111';
  const USER_ID = '22222222-2222-2222-2222-222222222222';
  const REQUEST_ID = '33333333-3333-3333-3333-333333333333';
  const ATTACHMENT_ID = '44444444-4444-4444-4444-444444444444';

  const samplePurchaseRequestRow = {
    id: REQUEST_ID,
    tenant_id: TENANT_ID,
    request_no: 'PR-2026-0001',
    title: '開発用サーバー機器購入申請',
    supplier_name: '株式会社テックサプライ',
    item_description: 'Dell PowerEdge R650 サーバー (32Core, 128GB RAM)',
    quantity: '2.00',
    unit_price: '450000.00',
    total_amount: '900000.00',
    currency: 'JPY',
    requested_delivery_date: '2026-10-15',
    status: 'draft',
    attachment_id: ATTACHMENT_ID,
    description: '新機能開発用インフラ増設のため',
    approved_at: null,
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

    service = new PurchaseRequestsService(
      mockDb as unknown as DatabaseService,
      mockAuditLogs as unknown as AuditLogsService,
    );
  });

  describe('list', () => {
    it('発注申請一覧を取得できる (ページネーション・フィルタ適用)', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ count: '1' }] }) // count
        .mockResolvedValueOnce({ rows: [samplePurchaseRequestRow] }); // select

      const result = await service.list(TENANT_ID, USER_ID, {
        status: 'draft',
        supplier_name: 'テックサプライ',
        page: 1,
        page_size: 20,
      });

      expect(result.purchaseRequests).toHaveLength(1);
      expect(result.purchaseRequests[0].id).toBe(REQUEST_ID);
      expect(result.purchaseRequests[0].request_no).toBe('PR-2026-0001');
      expect(result.purchaseRequests[0].quantity).toBe(2);
      expect(result.purchaseRequests[0].unit_price).toBe(450000);
      expect(result.purchaseRequests[0].total_amount).toBe(900000);
      expect(result.pagination.total_count).toBe(1);
    });
  });

  describe('getById', () => {
    it('発注申請詳細（添付ファイルメタデータ・承認履歴含む）を取得できる', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1, rows: [samplePurchaseRequestRow] }) // request row
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: ATTACHMENT_ID,
              file_name: 'quote_server.pdf',
              mime_type: 'application/pdf',
              file_size: 1048576,
            },
          ],
        }) // attachment row
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'hist-1',
              step_number: 1,
              approver_id: USER_ID,
              approver_name: '承認者 田中',
              action: 'approve',
              comment: '承認します',
              acted_at: new Date('2026-09-12T12:00:00Z'),
            },
          ],
        }) // approval history
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'rec-1',
              tenant_id: TENANT_ID,
              purchase_request_id: REQUEST_ID,
              received_quantity: '1.00',
              received_date: '2026-09-13',
              notes: '納品完了',
              received_by: USER_ID,
              received_by_name: '検収者 山田',
              created_at: new Date('2026-09-13T10:00:00Z'),
            },
          ],
        }) // receipts
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'bill-1',
              bill_no: 'BILL-2026-0001',
              vendor_id: '55555555-5555-5555-5555-555555555555',
              bill_date: '2026-09-14',
              due_date: '2026-10-31',
              status: 'pending_approval',
              total_amount: '900000.00',
            },
          ],
        }); // linked vendor bills

      const result = await service.getById(TENANT_ID, USER_ID, REQUEST_ID);

      expect(result.id).toBe(REQUEST_ID);
      expect(result.attachment).not.toBeNull();
      expect(result.attachment?.file_name).toBe('quote_server.pdf');
      expect(result.approval_history).toHaveLength(1);
      expect(result.approval_history[0].approver_name).toBe('承認者 田中');
      expect(result.receipts).toHaveLength(1);
      expect(result.receipts[0].received_quantity).toBe(1);
      expect(result.total_received_quantity).toBe(1);
      expect(result.remaining_quantity).toBe(1); // 2 - 1 = 1
      expect(result.linked_vendor_bills).toHaveLength(1);
      expect(result.linked_vendor_bills[0].bill_no).toBe('BILL-2026-0001');
    });

    it('存在しないIDの場合 NotFound 例外を投げる', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(service.getById(TENANT_ID, USER_ID, REQUEST_ID)).rejects.toThrow(AppException);
    });
  });

  describe('create', () => {
    it('新規ドラフト発注申請を正常に作成できる (自動採番・金額計算整合性・監査ログ)', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // assertUserPermission
        .mockResolvedValueOnce({ rowCount: 1 }) // attachment check
        .mockResolvedValueOnce({ rows: [] }) // advisory lock
        .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // count for request_no
        .mockResolvedValueOnce({ rows: [samplePurchaseRequestRow] }); // insert returning

      const result = await service.create(TENANT_ID, USER_ID, {
        title: '開発用サーバー機器購入申請',
        supplier_name: '株式会社テックサプライ',
        item_description: 'Dell PowerEdge R650 サーバー (32Core, 128GB RAM)',
        quantity: 2,
        unit_price: 450000,
        total_amount: 900000,
        currency: 'JPY',
        requested_delivery_date: '2026-10-15',
        attachment_id: ATTACHMENT_ID,
        description: '新機能開発用インフラ増設のため',
      });

      expect(result.id).toBe(REQUEST_ID);
      expect(result.status).toBe('draft');
      expect(result.total_amount).toBe(900000);
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({
          action: 'purchase_request.created',
          targetType: 'purchase_request',
          targetId: REQUEST_ID,
        }),
      );
    });

    it('権限を持たないユーザーが作成しようとした場合 Forbidden 例外を投げる (Service層二重防御)', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 0 }); // assertUserPermission fails

      await expect(
        service.create(TENANT_ID, USER_ID, {
          title: '開発用サーバー機器購入申請',
          supplier_name: '株式会社テックサプライ',
          item_description: 'Dell PowerEdge',
          quantity: 1,
          unit_price: 100000,
        }),
      ).rejects.toThrow(AppException);
    });

    it('数量 × 単価 と 合計金額 が不整合の場合 BadRequest 例外を投げる', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 }); // assertUserPermission

      await expect(
        service.create(TENANT_ID, USER_ID, {
          title: '開発用サーバー機器購入申請',
          supplier_name: '株式会社テックサプライ',
          item_description: 'Dell PowerEdge',
          quantity: 2,
          unit_price: 450000,
          total_amount: 800000, // 不正な金額 (900000が正しい)
        }),
      ).rejects.toThrow(AppException);
    });
  });

  describe('update', () => {
    it('draft状態の発注申請を正常に更新できる', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // assertUserPermission
        .mockResolvedValueOnce({ rowCount: 1, rows: [samplePurchaseRequestRow] }) // select existing
        .mockResolvedValueOnce({
          rows: [
            {
              ...samplePurchaseRequestRow,
              title: '更新後のタイトル',
              quantity: '3.00',
              total_amount: '1350000.00',
            },
          ],
        }); // update returning

      const result = await service.update(TENANT_ID, USER_ID, REQUEST_ID, {
        title: '更新後のタイトル',
        quantity: 3,
        unit_price: 450000,
        total_amount: 1350000,
      });

      expect(result.title).toBe('更新後のタイトル');
      expect(result.quantity).toBe(3);
      expect(result.total_amount).toBe(1350000);
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({ action: 'purchase_request.updated' }),
      );
    });

    it('active状態の発注申請を更新しようとすると Conflict 例外を投げる', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // assertUserPermission
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ ...samplePurchaseRequestRow, status: 'active' }],
        });

      await expect(
        service.update(TENANT_ID, USER_ID, REQUEST_ID, { title: '改ざん試行' }),
      ).rejects.toThrow(AppException);
    });
  });

  describe('delete', () => {
    it('draft状態の発注申請を正常に削除できる', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // assertUserPermission
        .mockResolvedValueOnce({ rowCount: 1, rows: [samplePurchaseRequestRow] }) // select existing
        .mockResolvedValueOnce({ rowCount: 1 }); // delete

      await service.delete(TENANT_ID, USER_ID, REQUEST_ID);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM purchase_requests'),
        [TENANT_ID, REQUEST_ID],
      );
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({ action: 'purchase_request.deleted' }),
      );
    });

    it('active状態の発注申請を削除しようとすると Conflict 例外を投げる', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // assertUserPermission
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ ...samplePurchaseRequestRow, status: 'active' }],
        });

      await expect(service.delete(TENANT_ID, USER_ID, REQUEST_ID)).rejects.toThrow(AppException);
    });
  });

  describe('submitForApproval (1人テナント vs 多段階承認)', () => {
    it('承認ルール未設定の場合: エラーを返し、自動的にactiveへ遷移しない (SoD偶発的無効化防止)', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // assertUserPermission
        .mockResolvedValueOnce({ rowCount: 1, rows: [samplePurchaseRequestRow] }) // select existing
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // select approval_rules (未設定)

      await expect(service.submitForApproval(TENANT_ID, USER_ID, REQUEST_ID)).rejects.toThrow(
        AppException,
      );
    });

    it('明示的自動承認ルール(is_explicit_auto_approve=true)の場合: 即座にactive(自動承認)となりpurchase_request.auto_approvedが記録される', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // assertUserPermission
        .mockResolvedValueOnce({ rowCount: 1, rows: [samplePurchaseRequestRow] }) // select existing
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ step_number: 0, is_explicit_auto_approve: true }],
        }) // auto_approve rule
        .mockResolvedValueOnce({
          rows: [{ ...samplePurchaseRequestRow, status: 'active', approved_at: new Date() }],
        }); // update returning

      const result = await service.submitForApproval(TENANT_ID, USER_ID, REQUEST_ID);

      expect(result.status).toBe('active');
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({
          action: 'purchase_request.auto_approved',
          afterData: expect.objectContaining({ status: 'active', auto_approved: true }),
        }),
      );
    });

    it('承認ルール設定済(多段階)の場合: pending_approvalに遷移しapproval_requestsが起票される', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // assertUserPermission
        .mockResolvedValueOnce({ rowCount: 1, rows: [samplePurchaseRequestRow] }) // select existing
        .mockResolvedValueOnce({
          rowCount: 2,
          rows: [
            { step_number: 1, is_explicit_auto_approve: false },
            { step_number: 2, is_explicit_auto_approve: false },
          ],
        }) // 2段階承認ルール
        .mockResolvedValueOnce({
          rows: [{ ...samplePurchaseRequestRow, status: 'pending_approval' }],
        }) // update purchase_requests returning
        .mockResolvedValueOnce({ rowCount: 1 }); // insert approval_requests

      const result = await service.submitForApproval(TENANT_ID, USER_ID, REQUEST_ID);

      expect(result.status).toBe('pending_approval');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO approval_requests'),
        expect.arrayContaining([TENANT_ID, REQUEST_ID, USER_ID, 2]),
      );
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({
          action: 'purchase_request.submitted_for_approval',
          afterData: { status: 'pending_approval', total_steps: 2 },
        }),
      );
    });

    it('既にactive状態の発注申請を申請しようとすると Conflict 例外を投げる', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // assertUserPermission
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ ...samplePurchaseRequestRow, status: 'active' }],
        });

      await expect(service.submitForApproval(TENANT_ID, USER_ID, REQUEST_ID)).rejects.toThrow(
        AppException,
      );
    });
  });

  describe('terminate', () => {
    it('active状態の発注申請を正常にterminated(解約・取消)できる', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // assertUserPermission
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ ...samplePurchaseRequestRow, status: 'active' }],
        }) // select existing
        .mockResolvedValueOnce({
          rows: [{ ...samplePurchaseRequestRow, status: 'terminated' }],
        }); // update returning

      const result = await service.terminate(TENANT_ID, USER_ID, REQUEST_ID);

      expect(result.status).toBe('terminated');
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({
          action: 'purchase_request.terminated',
          targetType: 'purchase_request',
          targetId: REQUEST_ID,
        }),
      );
    });

    it('draft状態の発注申請をterminateしようとすると Conflict 例外を投げる', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // assertUserPermission
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ ...samplePurchaseRequestRow, status: 'draft' }],
        });

      await expect(service.terminate(TENANT_ID, USER_ID, REQUEST_ID)).rejects.toThrow(
        AppException,
      );
    });
  });

  describe('addReceipt', () => {
    it('active状態の発注申請に検収記録を正常に追加できる', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // assertUserPermission
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ status: 'active', quantity: '2.00' }],
        }) // select existing
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'rec-1',
              tenant_id: TENANT_ID,
              purchase_request_id: REQUEST_ID,
              received_quantity: '2.00',
              received_date: '2026-09-15',
              notes: '全量受領完了',
              received_by: USER_ID,
              created_at: new Date('2026-09-15T10:00:00Z'),
            },
          ],
        }); // insert returning

      const result = await service.addReceipt(TENANT_ID, USER_ID, REQUEST_ID, {
        received_quantity: 2,
        received_date: '2026-09-15',
        notes: '全量受領完了',
      });

      expect(result.id).toBe('rec-1');
      expect(result.received_quantity).toBe(2);
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({
          action: 'purchase_request.receipt_added',
          targetType: 'purchase_request',
          targetId: REQUEST_ID,
        }),
      );
    });

    it('draft状態の発注申請に検収記録を追加しようとすると BadRequest 例外を投げる', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // assertUserPermission
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ status: 'draft', quantity: '2.00' }],
        });

      await expect(
        service.addReceipt(TENANT_ID, USER_ID, REQUEST_ID, {
          received_quantity: 1,
          received_date: '2026-09-15',
        }),
      ).rejects.toThrow(AppException);
    });
  });

  describe('linkVendorBill', () => {
    it('active状態の発注申請に仕入請求書を正常に紐付けできる', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // assertUserPermission
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ status: 'active' }],
        }) // select PR
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 'bill-1', purchase_request_id: null }],
        }) // select VB
        .mockResolvedValueOnce({ rowCount: 1 }); // update VB

      await service.linkVendorBill(TENANT_ID, USER_ID, REQUEST_ID, {
        vendor_bill_id: '55555555-5555-5555-5555-555555555555',
      });

      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        TENANT_ID,
        expect.objectContaining({
          action: 'purchase_request.bill_linked',
          targetType: 'purchase_request',
          targetId: REQUEST_ID,
        }),
      );
    });

    it('draft状態の発注申請に請求書を紐付けようとすると BadRequest 例外を投げる', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rowCount: 1 }) // assertUserPermission
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ status: 'draft' }],
        });

      await expect(
        service.linkVendorBill(TENANT_ID, USER_ID, REQUEST_ID, {
          vendor_bill_id: '55555555-5555-5555-5555-555555555555',
        }),
      ).rejects.toThrow(AppException);
    });
  });
});
