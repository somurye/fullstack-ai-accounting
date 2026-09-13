import { AppException } from '../../common/exceptions/app.exception';
import { DatabaseService } from '../../database/database.service';
import { PurchaseDashboardService } from './purchase-dashboard.service';

describe('PurchaseDashboardService', () => {
  let service: PurchaseDashboardService;
  let mockDb: { transaction: jest.Mock };
  let mockClient: { query: jest.Mock };

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
    };
    mockDb = {
      transaction: jest.fn().mockImplementation((_tenantId, _userId, callback) => callback(mockClient)),
    };
    service = new PurchaseDashboardService(mockDb as unknown as DatabaseService);
  });

  describe('RBAC二重防御 (assertUserPermission)', () => {
    it('userIdがnullの場合、unauthorized例外をスローすること', async () => {
      await expect(
        service.getSummary('tenant-1', null, { supplier_limit: 5 }),
      ).rejects.toThrow(AppException);
    });

    it('purchase_request.view権限を持たない場合、forbidden例外をスローすること', async () => {
      // permCheck query が 0 件
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(
        service.getSummary('tenant-1', 'user-1', { supplier_limit: 5 }),
      ).rejects.toThrow(AppException);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('p.code = $3'),
        ['tenant-1', 'user-1', 'purchase_request.view'],
      );
    });
  });

  describe('集計ロジック (正常系)', () => {
    beforeEach(() => {
      // 1. RBACチェック成功 (rowCount: 1)
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ ok: 1 }] });
      // 2. ステータス別件数・金額
      mockClient.query.mockResolvedValueOnce({
        rows: [
          { status: 'draft', count: '2', total_amount: '20000.00' },
          { status: 'active', count: '5', total_amount: '500000.00' },
          { status: 'pending_approval', count: '1', total_amount: '100000.00' },
        ],
      });
      // 3. サプライヤー別発注金額ランキング
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            supplier_id: 'sup-1',
            supplier_name: 'テストサプライヤーA',
            request_count: '3',
            total_amount: '350000.00',
          },
          {
            supplier_id: null,
            supplier_name: 'フリーテキスト仕入先B',
            request_count: '2',
            total_amount: '150000.00',
          },
        ],
      });
      // 4. 今期判定 (fiscal_years)
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'fy-1',
            start_date: '2026-04-01',
            end_date: '2027-03-31',
          },
        ],
      });
      // 5. 今月/今期発注金額集計
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            month_active: '250000.00',
            month_total: '350000.00',
            period_active: '500000.00',
            period_total: '620000.00',
          },
        ],
      });
      // 6. 検収待ち発注件数 (pending_receipts)
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            total_pending: '3',
            unreceived: '2',
            partially_received: '1',
          },
        ],
      });
      // 7. 月次推移 (monthly_trends)
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            month: '2026-09',
            request_count: '3',
            active_amount: '250000.00',
            total_amount: '350000.00',
          },
        ],
      });
    });

    it('ダッシュボードサマリー集計データを正しく集計・整形して返却すること', async () => {
      const summary = await service.getSummary('tenant-1', 'user-1', { supplier_limit: 5 });

      // ステータス別集計検証
      expect(summary.status_counts.draft).toEqual({ count: 2, total_amount: 20000 });
      expect(summary.status_counts.active).toEqual({ count: 5, total_amount: 500000 });
      expect(summary.status_counts.pending_approval).toEqual({ count: 1, total_amount: 100000 });
      expect(summary.status_counts.rejected).toEqual({ count: 0, total_amount: 0 });
      expect(summary.status_counts.terminated).toEqual({ count: 0, total_amount: 0 });
      expect(summary.status_counts.total).toEqual({ count: 8, total_amount: 620000 });

      // サプライヤーランキング検証
      expect(summary.supplier_ranking).toHaveLength(2);
      expect(summary.supplier_ranking[0]).toEqual({
        supplier_id: 'sup-1',
        supplier_name: 'テストサプライヤーA',
        request_count: 3,
        total_amount: 350000,
      });

      // 今月 / 今期集計検証
      expect(summary.amount_summary.current_month_active_amount).toBe(250000);
      expect(summary.amount_summary.current_month_total_amount).toBe(350000);
      expect(summary.amount_summary.current_period_active_amount).toBe(500000);
      expect(summary.amount_summary.current_period_total_amount).toBe(620000);
      expect(summary.amount_summary.current_period_label).toContain('2026-04-01〜2027-03-31');

      // 検収待ち集計検証
      expect(summary.pending_receipts.total_pending_receipt_count).toBe(3);
      expect(summary.pending_receipts.unreceived_count).toBe(2);
      expect(summary.pending_receipts.partially_received_count).toBe(1);

      // 月次推移検証
      expect(summary.monthly_trends).toHaveLength(6);
    });

    it('全集計クエリでtenant_idがパラメータに渡されていること（二重防御確認）', async () => {
      await service.getSummary('tenant-alpha', 'user-1', { supplier_limit: 5 });

      // 呼び出された全クエリで tenant-alpha が第1引数に含まれていることを検証
      for (const call of mockClient.query.mock.calls) {
        const sql = call[0] as string;
        const params = call[1] as unknown[];
        if (typeof sql === 'string' && sql.includes('tenant_id')) {
          expect(params).toContain('tenant-alpha');
        }
      }
    });
  });
});
