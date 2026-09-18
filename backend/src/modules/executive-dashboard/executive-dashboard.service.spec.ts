import { Test, TestingModule } from '@nestjs/testing';
import { ExecutiveDashboardService } from './executive-dashboard.service';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';

describe('ExecutiveDashboardService', () => {
  let service: ExecutiveDashboardService;
  let mockDb: {
    transaction: jest.Mock;
  };

  beforeEach(async () => {
    mockDb = {
      transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutiveDashboardService,
        {
          provide: DatabaseService,
          useValue: mockDb,
        },
      ],
    }).compile();

    service = module.get<ExecutiveDashboardService>(ExecutiveDashboardService);
  });

  describe('認可チェック (assertExecutiveAccess)', () => {
    it('dashboard.executive_view を持たないロール (employee) は 403 Forbidden をスローする', async () => {
      await expect(
        service.getSummary('t-1', 'u-1', ['employee']),
      ).rejects.toThrow(AppException);
    });

    it('dashboard.executive_view を持たない外部ロール (viewer_external) は 403 Forbidden をスローする', async () => {
      await expect(
        service.getSummary('t-1', 'u-1', ['viewer_external']),
      ).rejects.toThrow(AppException);
    });
  });

  describe('ドメイン別権限フィルタリング (二重認可)', () => {
    it('owner ロールは全ドメインのKPIデータが集計される', async () => {
      mockDb.transaction.mockImplementation(async (_tenantId, _userId, callback) => {
        const mockClient = {
          query: jest.fn().mockImplementation((sql: string) => {
            if (sql.includes('FROM approval_requests')) {
              return Promise.resolve({
                rows: [
                  { target_type: 'contract', count: 2 },
                  { target_type: 'general_request', count: 3 },
                ],
              });
            }
            if (sql.includes('FROM contracts') && sql.includes('active_count')) {
              return Promise.resolve({
                rows: [
                  { active_count: 10, expiring_soon: 2, within_30: 1, within_60: 2 },
                ],
              });
            }
            if (sql.includes('FROM purchase_requests')) {
              return Promise.resolve({
                rows: [
                  {
                    pending_count: 4,
                    pending_amount: '500000',
                    current_month_order_amount: '1200000',
                    pending_receipts_count: 1,
                  },
                ],
              });
            }
            if (sql.includes('active_employees')) {
              return Promise.resolve({
                rows: [
                  {
                    active_employees: 15,
                    unresolved_attendance: 1,
                    pending_attendance: 2,
                    overtime_alerts: 0,
                  },
                ],
              });
            }
            if (sql.includes('FROM deals')) {
              return Promise.resolve({
                rows: [
                  { stage: 'proposal', count: 3, total_amount: '3000000' },
                  { stage: 'won', count: 2, total_amount: '2000000' },
                  { stage: 'lost', count: 1, total_amount: '1000000' },
                ],
              });
            }
            if (sql.includes('FROM quotations')) {
              return Promise.resolve({
                rows: [
                  { status: 'sent', count: 3 },
                  { status: 'accepted', count: 2 },
                ],
              });
            }
            if (sql.includes('FROM contracts c') && sql.includes('has_link')) {
              return Promise.resolve({
                rows: [{ id: 'c-1', has_link: true }],
              });
            }
            return Promise.resolve({ rows: [] });
          }),
        };
        return callback(mockClient);
      });

      const res = await service.getSummary('t-1', 'u-1', ['owner']);

      expect(res.available_domains).toEqual([
        'approvals',
        'contracts',
        'purchase',
        'hr',
        'sales',
      ]);
      expect(res.approvals).not.toBeNull();
      expect(res.approvals?.pending_total_count).toBe(5);
      expect(res.approvals?.pending_by_target.contract).toBe(2);

      expect(res.contracts).not.toBeNull();
      expect(res.contracts?.active_contracts_count).toBe(10);
      expect(res.contracts?.expiring_soon_count).toBe(2);

      expect(res.purchase).not.toBeNull();
      expect(res.purchase?.pending_approval_count).toBe(4);
      expect(res.purchase?.pending_approval_amount).toBe(500000);

      expect(res.hr).not.toBeNull();
      expect(res.hr?.active_employees_count).toBe(15);
      expect(res.hr?.unresolved_attendance_count).toBe(1);

      expect(res.sales).not.toBeNull();
      expect(res.sales?.open_deals_count).toBe(3);
      expect(res.sales?.open_deals_amount).toBe(3000000);
      expect(res.sales?.win_rate).toBeCloseTo(0.6667, 4);
      expect(res.sales?.quotation_conversion_rate).toBeCloseTo(0.4, 4);
      expect(res.sales?.renewal_proposal_rate).toBe(1);
    });

    it('legal_admin ロールは労務権限を持たないため hr が null になる', async () => {
      mockDb.transaction.mockImplementation(async (_tenantId, _userId, callback) => {
        const mockClient = {
          query: jest.fn().mockImplementation((sql: string) => {
            if (sql.includes('FROM approval_requests')) {
              return Promise.resolve({ rows: [] });
            }
            if (sql.includes('FROM contracts') && sql.includes('active_count')) {
              return Promise.resolve({
                rows: [{ active_count: 5, expiring_soon: 1, within_30: 0, within_60: 1 }],
              });
            }
            if (sql.includes('FROM purchase_requests')) {
              return Promise.resolve({
                rows: [{ pending_count: 0, pending_amount: '0', current_month_order_amount: '0', pending_receipts_count: 0 }],
              });
            }
            if (sql.includes('FROM deals')) {
              return Promise.resolve({ rows: [] });
            }
            if (sql.includes('FROM quotations')) {
              return Promise.resolve({ rows: [] });
            }
            if (sql.includes('FROM contracts c') && sql.includes('has_link')) {
              return Promise.resolve({ rows: [] });
            }
            return Promise.resolve({ rows: [] });
          }),
        };
        return callback(mockClient);
      });

      const res = await service.getSummary('t-1', 'u-1', ['legal_admin']);

      expect(res.available_domains).toContain('contracts');
      expect(res.available_domains).not.toContain('hr');
      expect(res.hr).toBeNull();
      expect(res.contracts).not.toBeNull();
    });

    it('payroll_admin ロールは契約・購買・営業権限を持たないため hr のみ返却される', async () => {
      mockDb.transaction.mockImplementation(async (_tenantId, _userId, callback) => {
        const mockClient = {
          query: jest.fn().mockImplementation((sql: string) => {
            if (sql.includes('active_employees')) {
              return Promise.resolve({
                rows: [
                  {
                    active_employees: 8,
                    unresolved_attendance: 0,
                    pending_attendance: 1,
                    overtime_alerts: 0,
                  },
                ],
              });
            }
            return Promise.resolve({ rows: [] });
          }),
        };
        return callback(mockClient);
      });

      const res = await service.getSummary('t-1', 'u-1', ['payroll_admin']);

      expect(res.available_domains).toEqual(['hr']);
      expect(res.hr).not.toBeNull();
      expect(res.hr?.active_employees_count).toBe(8);
      expect(res.contracts).toBeNull();
      expect(res.purchase).toBeNull();
      expect(res.sales).toBeNull();
      expect(res.approvals).toBeNull();
    });
  });

  describe('ゼロ除算安全性 (Zero Division Safety)', () => {
    it('レコードが一切存在しない空テナントでも比率が安全に 0 になる', async () => {
      mockDb.transaction.mockImplementation(async (_tenantId, _userId, callback) => {
        const mockClient = {
          query: jest.fn().mockImplementation(() => {
            return Promise.resolve({ rows: [] });
          }),
        };
        return callback(mockClient);
      });

      const res = await service.getSummary('t-empty', 'u-1', ['owner']);

      expect(res.sales?.win_rate).toBe(0);
      expect(res.sales?.quotation_conversion_rate).toBe(0);
      expect(res.sales?.renewal_proposal_rate).toBe(0);
      expect(res.contracts?.active_contracts_count).toBe(0);
      expect(res.purchase?.pending_approval_amount).toBe(0);
      expect(res.hr?.active_employees_count).toBe(0);
    });
  });
});
