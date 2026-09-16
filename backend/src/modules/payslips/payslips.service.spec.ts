import { AppException } from '../../common/exceptions/app.exception';
import { DatabaseService } from '../../database/database.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PayslipsService } from './payslips.service';
import { PayslipPdfService } from './payslip-pdf.service';

describe('PayslipsService', () => {
  let service: PayslipsService;
  let mockDb: any;
  let mockAuditLogs: any;
  let mockPdfService: any;
  let mockClient: any;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';
  const employeeId = '33333333-3333-3333-3333-333333333333';
  const calcId = '55555555-5555-5555-5555-555555555555';
  const payslipId = '66666666-6666-6666-6666-666666666666';

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
    };
    mockDb = {
      transaction: jest.fn((_tenantId, _userId, callback) => callback(mockClient)),
    };
    mockAuditLogs = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    mockPdfService = {
      generatePdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock pdf')),
    };

    service = new PayslipsService(
      mockDb as unknown as DatabaseService,
      mockAuditLogs as unknown as AuditLogsService,
      mockPdfService as unknown as PayslipPdfService,
    );
  });

  describe('RBAC二重防御', () => {
    it('payslip.create 権限がない場合、403 Forbidden をスローする', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // checkPermission failure

      await expect(
        service.create(tenantId, userId, {
          payroll_calculation_id: calcId,
          status: 'draft',
        }),
      ).rejects.toThrow(AppException);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT 1'),
        [tenantId, userId, 'payslip.create'],
      );
    });

    it('payslip.view 権限がない場合、一覧取得で 403 Forbidden をスローする', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // checkPermission failure

      await expect(
        service.list(tenantId, userId, { page: 1, page_size: 50 }),
      ).rejects.toThrow(AppException);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT 1'),
        [tenantId, userId, 'payslip.view'],
      );
    });
  });

  describe('給与明細作成 (create)', () => {
    it('confirmed で作成時、給与計算レコードが active でない場合は 409 Conflict をスローする', async () => {
      // 1. checkPermission: OK
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. calcResult: draft
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: calcId,
            status: 'draft',
            employee_id: employeeId,
            employee_code: 'EMP-001',
            employee_name: '山田 太郎',
            department_name: '開発部',
          },
        ],
      });

      await expect(
        service.create(tenantId, userId, {
          payroll_calculation_id: calcId,
          status: 'confirmed',
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          errorCode: 'INVALID_STATE_TRANSITION',
        }),
      );
    });

    it('既に payslip が存在する場合は 409 Conflict (ALREADY_EXISTS) をスローする', async () => {
      // 1. checkPermission: OK
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. calcResult: active
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: calcId,
            status: 'active',
            employee_id: employeeId,
            employee_code: 'EMP-001',
            employee_name: '山田 太郎',
            department_name: '開発部',
          },
        ],
      });
      // 3. existing payslip
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: payslipId }],
      });

      await expect(
        service.create(tenantId, userId, {
          payroll_calculation_id: calcId,
          status: 'draft',
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          errorCode: 'ALREADY_EXISTS',
        }),
      );
    });

    it('正常に確定済み給与計算から confirmed 給与明細を発行できる', async () => {
      // 1. checkPermission: OK
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. calcResult: active
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: calcId,
            status: 'active',
            employee_id: employeeId,
            employee_code: 'EMP-001',
            employee_name: '山田 太郎',
            department_name: '開発部',
            period_name: '2026年5月度給与',
            payment_date: new Date('2026-06-10'),
            regular_hours: '160',
            overtime_hours: '10',
            late_night_hours: '0',
            holiday_hours: '0',
            absent_days: '0',
            base_salary: '300000',
            overtime_pay: '25000',
            commuting_allowance: '15000',
            housing_allowance: '20000',
            other_allowances: '0',
            total_gross_pay: '360000',
            health_insurance_amount: '17928',
            care_insurance_amount: '0',
            pension_amount: '32940',
            employment_insurance_amount: '2160',
            total_social_insurance: '53028',
            taxable_gross_pay: '345000',
            income_tax_amount: '8420',
            resident_tax_amount: '18000',
            total_deductions: '79448',
            net_pay: '280552',
            company_social_insurance: '53028',
          },
        ],
      });
      // 3. existing: none
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      // 4. insert payslip
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: payslipId,
            tenant_id: tenantId,
            payroll_calculation_id: calcId,
            employee_id: employeeId,
            status: 'confirmed',
            snapshot_data: { employee: { name: '山田 太郎' } },
            issued_at: new Date(),
            created_at: new Date(),
            updated_at: new Date(),
            employee_name: '山田 太郎',
            employee_code: 'EMP-001',
            department_name: '開発部',
            payroll_period: '2026-05',
            total_gross_pay: '360000',
            total_deductions: '79448',
            net_pay: '280552',
          },
        ],
      });

      const result = await service.create(tenantId, userId, {
        payroll_calculation_id: calcId,
        status: 'confirmed',
      });

      expect(result.id).toBe(payslipId);
      expect(result.status).toBe('confirmed');
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        tenantId,
        expect.objectContaining({
          action: 'payslip.created',
        }),
      );
    });
  });

  describe('給与明細確定 (confirm)', () => {
    it('既に confirmed の明細を再度 confirm しようとすると 409 Conflict をスローする (WORM)', async () => {
      // 1. checkPermission: OK
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. current payslip: already confirmed
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ status: 'confirmed', calc_status: 'active' }],
      });

      await expect(service.confirm(tenantId, userId, payslipId)).rejects.toThrow(
        expect.objectContaining({
          errorCode: 'INVALID_STATE_TRANSITION',
        }),
      );
    });
  });

  describe('PDF生成 (getPdf)', () => {
    it('明細レコードを取得して PDF バッファとファイル名を返す', async () => {
      // 1. checkPermission (findById内): OK
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. resolveEmployeeRestriction: admin/manager
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ code: 'payroll_admin' }],
      });
      // 3. fetch payslip
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: payslipId,
            tenant_id: tenantId,
            payroll_calculation_id: calcId,
            employee_id: employeeId,
            status: 'confirmed',
            snapshot_data: {
              employee: { id: employeeId, employee_code: 'EMP-001', name: '山田 太郎' },
              attendance: { regular_hours: 160, overtime_hours: 10, late_night_hours: 0, holiday_hours: 0, absent_days: 0 },
              earnings: { base_salary: 300000, overtime_pay: 25000, commuting_allowance: 15000, housing_allowance: 20000, other_allowances: 0, total_gross_pay: 360000 },
              deductions: { health_insurance: 17928, nursing_insurance: 0, welfare_pension: 32940, employment_insurance: 2160, total_social_insurance: 53028, income_tax: 8420, resident_tax: 18000, total_deductions: 79448 },
              net_pay: 280552,
            },
            issued_at: new Date(),
            created_at: new Date(),
            updated_at: new Date(),
            employee_name: '山田 太郎',
            employee_code: 'EMP-001',
            department_name: '開発部',
            payroll_period: '2026-05',
            total_gross_pay: '360000',
            total_deductions: '79448',
            net_pay: '280552',
          },
        ],
      });

      const { buffer, filename } = await service.getPdf(tenantId, userId, payslipId);

      expect(buffer).toBeDefined();
      expect(filename).toContain('payslip_2026-05_EMP-001.pdf');
      expect(mockPdfService.generatePdf).toHaveBeenCalled();
    });
  });
});
