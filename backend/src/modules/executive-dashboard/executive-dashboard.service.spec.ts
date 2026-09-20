import { Test, TestingModule } from '@nestjs/testing';
import { ExecutiveDashboardService } from './executive-dashboard.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ApprovalRequestsService } from '../approval-requests/approval-requests.service';
import { ContractsService } from '../contracts/contracts.service';
import { PurchaseDashboardService } from '../purchase-dashboard/purchase-dashboard.service';
import { AttendanceService } from '../attendance/attendance.service';
import { SalesDashboardService } from '../sales-dashboard/sales-dashboard.service';

describe('ExecutiveDashboardService', () => {
  let service: ExecutiveDashboardService;
  let mockApprovalRequestsService: { getPendingSummary: jest.Mock };
  let mockContractsService: { getExpirySummary: jest.Mock };
  let mockPurchaseDashboardService: { getExecutivePurchaseKpi: jest.Mock };
  let mockAttendanceService: { getHrKpiSummary: jest.Mock };
  let mockSalesDashboardService: { getExecutiveSalesKpi: jest.Mock };

  beforeEach(async () => {
    mockApprovalRequestsService = {
      getPendingSummary: jest.fn().mockResolvedValue({
        pending_total_count: 5,
        pending_by_target: { contract: 2, general_request: 3 },
      }),
    };
    mockContractsService = {
      getExpirySummary: jest.fn().mockResolvedValue({
        active_contracts_count: 10,
        expiring_soon_count: 2,
        expiring_within_30_days: 1,
        expiring_within_60_days: 2,
      }),
    };
    mockPurchaseDashboardService = {
      getExecutivePurchaseKpi: jest.fn().mockResolvedValue({
        pending_approval_count: 4,
        pending_approval_amount: 500000,
        current_month_order_amount: 1200000,
        pending_receipts_count: 1,
      }),
    };
    mockAttendanceService = {
      getHrKpiSummary: jest.fn().mockResolvedValue({
        active_employees_count: 15,
        unresolved_attendance_count: 1,
        pending_attendance_approvals: 2,
        overtime_alert_count: 0,
      }),
    };
    mockSalesDashboardService = {
      getExecutiveSalesKpi: jest.fn().mockResolvedValue({
        open_deals_count: 3,
        open_deals_amount: 3000000,
        win_rate: 0.6667,
        quotation_conversion_rate: 0.4,
        renewal_proposal_rate: 1.0,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutiveDashboardService,
        { provide: ApprovalRequestsService, useValue: mockApprovalRequestsService },
        { provide: ContractsService, useValue: mockContractsService },
        { provide: PurchaseDashboardService, useValue: mockPurchaseDashboardService },
        { provide: AttendanceService, useValue: mockAttendanceService },
        { provide: SalesDashboardService, useValue: mockSalesDashboardService },
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

  describe('ドメイン別権限フィルタリング (二重認可 & Service委譲)', () => {
    it('owner ロールは全ドメインのServiceが呼び出されデータが集計される', async () => {
      const res = await service.getSummary('t-1', 'u-1', ['owner']);

      expect(res.available_domains).toEqual([
        'approvals',
        'contracts',
        'purchase',
        'hr',
        'sales',
      ]);
      expect(mockApprovalRequestsService.getPendingSummary).toHaveBeenCalledWith('t-1', 'u-1');
      expect(mockContractsService.getExpirySummary).toHaveBeenCalledWith('t-1', 'u-1');
      expect(mockPurchaseDashboardService.getExecutivePurchaseKpi).toHaveBeenCalledWith('t-1', 'u-1');
      expect(mockAttendanceService.getHrKpiSummary).toHaveBeenCalledWith('t-1', 'u-1');
      expect(mockSalesDashboardService.getExecutiveSalesKpi).toHaveBeenCalledWith('t-1', 'u-1', ['owner']);

      expect(res.approvals?.pending_total_count).toBe(5);
      expect(res.contracts?.active_contracts_count).toBe(10);
      expect(res.purchase?.pending_approval_count).toBe(4);
      expect(res.hr?.active_employees_count).toBe(15);
      expect(res.sales?.open_deals_count).toBe(3);
    });

    it('legal_admin ロールは労務権限を持たないため hr が null になり、AttendanceServiceは呼び出されない', async () => {
      const res = await service.getSummary('t-1', 'u-1', ['legal_admin']);

      expect(res.contracts).not.toBeNull();
      expect(res.approvals).not.toBeNull();
      expect(res.sales).not.toBeNull();
      expect(res.hr).toBeNull();
      expect(res.available_domains.includes('hr')).toBe(false);
      expect(mockAttendanceService.getHrKpiSummary).not.toHaveBeenCalled();
    });

    it('payroll_admin ロールは契約・購買・営業権限を持たないため hr のみ呼び出されて返却される', async () => {
      const res = await service.getSummary('t-1', 'u-1', ['payroll_admin']);

      expect(res.hr).not.toBeNull();
      expect(res.contracts).toBeNull();
      expect(res.purchase).toBeNull();
      expect(res.sales).toBeNull();
      expect(res.available_domains).toEqual(['hr']);
      expect(res.hr?.active_employees_count).toBe(15);

      expect(mockAttendanceService.getHrKpiSummary).toHaveBeenCalledWith('t-1', 'u-1');
      expect(mockContractsService.getExpirySummary).not.toHaveBeenCalled();
      expect(mockPurchaseDashboardService.getExecutivePurchaseKpi).not.toHaveBeenCalled();
      expect(mockSalesDashboardService.getExecutiveSalesKpi).not.toHaveBeenCalled();
    });
  });
});
