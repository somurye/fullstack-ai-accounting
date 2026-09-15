import { AppException } from '../../common/exceptions/app.exception';
import { DatabaseService } from '../../database/database.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { YearEndAdjustmentsService } from './year-end-adjustments.service';

describe('YearEndAdjustmentsService', () => {
  let service: YearEndAdjustmentsService;
  let mockDb: any;
  let mockAuditLogs: any;
  let mockClient: any;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';
  const employeeId = '33333333-3333-3333-3333-333333333333';
  const adjustmentId = '77777777-7777-7777-7777-777777777777';

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

    service = new YearEndAdjustmentsService(
      mockDb as unknown as DatabaseService,
      mockAuditLogs as unknown as AuditLogsService,
    );
  });

  describe('RBAC二重防御', () => {
    it('year_end_adjustment.create 権限がない場合、403 Forbidden をスローする', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // checkPermission failure

      await expect(
        service.calculate(tenantId, userId, {
          employee_id: employeeId,
          tax_year: 2026,
          spouse_deduction: 0,
          dependents_count: 0,
          life_insurance_deduction: 0,
          earthquake_insurance_deduction: 0,
          housing_loan_deduction: 0,
        }),
      ).rejects.toThrow(AppException);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT 1'),
        [tenantId, userId, 'year_end_adjustment.create'],
      );
    });

    it('year_end_adjustment.view 権限がない場合、一覧取得で 403 Forbidden をスローする', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // checkPermission failure

      await expect(
        service.list(tenantId, userId, { page: 1, page_size: 50 }),
      ).rejects.toThrow(AppException);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT 1'),
        [tenantId, userId, 'year_end_adjustment.view'],
      );
    });
  });

  describe('年末調整計算 (calculate) と WORM不変性', () => {
    it('既に active 確定済みの年末調整が存在する場合、再計算を拒否して 409 Conflict (ALREADY_EXISTS) をスローする', async () => {
      // 1. checkPermission: OK
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. empCheck: OK
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: employeeId, name: '山田 太郎' }],
      });
      // 3. existingRes: status = 'active'
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: adjustmentId, status: 'active' }],
      });

      await expect(
        service.calculate(tenantId, userId, {
          employee_id: employeeId,
          tax_year: 2026,
          spouse_deduction: 0,
          dependents_count: 0,
          life_insurance_deduction: 0,
          earthquake_insurance_deduction: 0,
          housing_loan_deduction: 0,
        }),
      ).rejects.toThrow(
        expect.objectContaining({
          errorCode: 'ALREADY_EXISTS',
        }),
      );
    });

    it('確定済み給与(active)の年間集計から各種控除・過不足税額を正しく計算して draft レコードを作成する', async () => {
      // 1. checkPermission: OK
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. empCheck: OK
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: employeeId, name: '山田 太郎' }],
      });
      // 3. existingRes: none
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
      // 4. payRes: 年間確定給与
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            gross_sum: '4800000', // 年間総支給
            social_sum: '700000',  // 年間社保
            withheld_sum: '120000', // 源泉徴収済み税額
          },
        ],
      });
      // 5. rateMasterRes
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: '99999999-9999-9999-9999-999999999999' }],
      });
      // 6. insert year_end_adjustments
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: adjustmentId,
            tenant_id: tenantId,
            employee_id: employeeId,
            tax_year: 2026,
            annual_gross_pay: '4800000',
            annual_taxable_pay: '4800000',
            annual_social_insurance: '700000',
            annual_withheld_tax: '120000',
            deductions: {
              basic_deduction: 480000,
              social_insurance_deduction: 700000,
              employment_income_deduction: 1360000,
            },
            total_deductions: '2540000',
            taxable_income_after_deductions: '2260000',
            final_annual_tax: '128500',
            adjustment_amount: '-8500',
            applied_rate_ids: ['99999999-9999-9999-9999-999999999999'],
            status: 'draft',
            approval_request_id: null,
            confirmed_at: null,
            created_at: new Date(),
            updated_at: new Date(),
            employee_name: '山田 太郎',
            employee_code: 'EMP-001',
            department_name: '開発部',
          },
        ],
      });

      const result = await service.calculate(tenantId, userId, {
        employee_id: employeeId,
        tax_year: 2026,
        spouse_deduction: 0,
        dependents_count: 0,
        life_insurance_deduction: 0,
        earthquake_insurance_deduction: 0,
        housing_loan_deduction: 0,
      });

      expect(result.id).toBe(adjustmentId);
      expect(result.status).toBe('draft');
      expect(result.annual_gross_pay).toBe(4800000);
      expect(mockAuditLogs.record).toHaveBeenCalledWith(
        mockClient,
        tenantId,
        expect.objectContaining({
          action: 'year_end_adjustment.calculated',
        }),
      );
    });
  });

  describe('承認フロー連携 (暗黙自動承認の防止 & 0-step / 多段階承認)', () => {
    it('承認ルールが未設定の場合、暗黙の自動承認を防ぐため 400 Bad Request (NO_APPROVAL_RULES_CONFIGURED) をスローする', async () => {
      // 1. checkPermission: OK
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. adjRes: draft
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: adjustmentId, status: 'draft', employee_id: employeeId }],
      });
      // 3. rulesRes: 未設定 (0件)
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(
        service.submitApproval(tenantId, userId, adjustmentId, { comment: '申請' }),
      ).rejects.toThrow(
        expect.objectContaining({
          errorCode: 'NO_APPROVAL_RULES_CONFIGURED',
        }),
      );
    });

    it('従業員自身が自分の年末調整を0-step自動確定しようとした場合、403 Forbidden で拒否する (自己確定防止)', async () => {
      // 1. checkPermission: OK
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. adjRes: draft
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: adjustmentId, status: 'draft', employee_id: employeeId }],
      });
      // 3. rulesRes: 0-step
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ step_number: 0, is_explicit_auto_approve: true }],
      });
      // 4. resolveEmployeeRestriction: rolesRes (一般従業員)
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ code: 'employee' }],
      });
      // 5. resolveEmployeeRestriction: empRes (申請者自身と同一ID)
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: employeeId }],
      });

      await expect(
        service.submitApproval(tenantId, userId, adjustmentId, {}),
      ).rejects.toThrow(
        expect.objectContaining({
          status: 403,
        }),
      );
    });

    it('管理者が明示的0-step自動承認ルール下で申請した場合、即座に status = active に遷移する', async () => {
      // 1. checkPermission: OK
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. adjRes: draft
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: adjustmentId, status: 'draft', employee_id: employeeId }],
      });
      // 3. rulesRes: 0-step
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ step_number: 0, is_explicit_auto_approve: true }],
      });
      // 4. resolveEmployeeRestriction: rolesRes (管理者)
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ code: 'payroll_admin' }],
      });
      // 5. insert approval_requests (pending)
      const arId = '88888888-8888-8888-8888-888888888888';
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: arId }],
      });
      // 6. update approval_requests (approved)
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: arId }],
      });
      // 7. update year_end_adjustments: active
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [],
      });
      // 8. select updated year_end_adjustments
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: adjustmentId,
            tenant_id: tenantId,
            employee_id: employeeId,
            tax_year: 2026,
            annual_gross_pay: '4800000',
            annual_taxable_pay: '4800000',
            annual_social_insurance: '700000',
            annual_withheld_tax: '120000',
            deductions: {},
            total_deductions: '2540000',
            taxable_income_after_deductions: '2260000',
            final_annual_tax: '128500',
            adjustment_amount: '-8500',
            applied_rate_ids: [],
            status: 'active',
            approval_request_id: arId,
            confirmed_at: new Date(),
            created_at: new Date(),
            updated_at: new Date(),
            employee_name: '山田 太郎',
            employee_code: 'EMP-001',
            department_name: '開発部',
          },
        ],
      });

      const result = await service.submitApproval(tenantId, userId, adjustmentId, {});

      expect(result.status).toBe('active');
      expect(result.approval_request_id).toBe(arId);
    });

    it('多段階承認ルールの場合、approval_requests を作成して pending_approval に遷移する', async () => {
      // 1. checkPermission: OK
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. adjRes: draft
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: adjustmentId, status: 'draft', employee_id: employeeId }],
      });
      // 3. rulesRes: 2 steps
      mockClient.query.mockResolvedValueOnce({
        rowCount: 2,
        rows: [
          { step_number: 1, is_explicit_auto_approve: false },
          { step_number: 2, is_explicit_auto_approve: false },
        ],
      });
      // 4. insert approval_requests
      const arId = '88888888-8888-8888-8888-888888888888';
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: arId }],
      });
      // 5. update year_end_adjustments: pending_approval
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [],
      });
      // 6. select updated year_end_adjustments
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: adjustmentId,
            tenant_id: tenantId,
            employee_id: employeeId,
            tax_year: 2026,
            annual_gross_pay: '4800000',
            annual_taxable_pay: '4800000',
            annual_social_insurance: '700000',
            annual_withheld_tax: '120000',
            deductions: {},
            total_deductions: '2540000',
            taxable_income_after_deductions: '2260000',
            final_annual_tax: '128500',
            adjustment_amount: '-8500',
            applied_rate_ids: [],
            status: 'pending_approval',
            approval_request_id: arId,
            confirmed_at: null,
            created_at: new Date(),
            updated_at: new Date(),
            employee_name: '山田 太郎',
            employee_code: 'EMP-001',
            department_name: '開発部',
          },
        ],
      });

      const result = await service.submitApproval(tenantId, userId, adjustmentId, {
        comment: '年末調整の申請です',
      });

      expect(result.status).toBe('pending_approval');
      expect(result.approval_request_id).toBe(arId);
    });
  });
});
