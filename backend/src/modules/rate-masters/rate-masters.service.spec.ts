import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RateMastersService } from './rate-masters.service';

describe('RateMastersService', () => {
  let service: RateMastersService;
  let mockDb: any;
  let mockAuditLogs: any;
  let mockClient: any;

  beforeEach(async () => {
    mockClient = {
      query: jest.fn(),
    };

    mockDb = {
      transaction: jest.fn((tenantId, userId, cb) => cb(mockClient)),
    };

    mockAuditLogs = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateMastersService,
        { provide: DatabaseService, useValue: mockDb },
        { provide: AuditLogsService, useValue: mockAuditLogs },
      ],
    }).compile();

    service = module.get<RateMastersService>(RateMastersService);
  });

  describe('二重RBAC認可チェック (assertUserPermission)', () => {
    it('パーミッション未保持ユーザーは403例外をスローする', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // 権限なし

      await expect(
        service.listInsuranceRates('tenant-1', 'user-no-perm', { page: 1, limit: 20 }),
      ).rejects.toThrow(AppException);
    });
  });

  describe('社会保険料率マスタ (insurance_rate_tables)', () => {
    it('保険料率を正常に登録し、監査ログを記録する', async () => {
      // 1. assertUserPermission PASS
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. INSERT 成功
      const createdRow = {
        id: 'rate-1',
        tenant_id: 'tenant-1',
        rate_type: 'health_insurance',
        prefecture: 'tokyo',
        rate_employee: '0.04985',
        rate_employer: '0.04985',
        effective_from: '2026-04-01',
        effective_to: null,
        description: '令和8年度 健康保険料率 (東京)',
        created_by: 'user-1',
        created_at: new Date('2026-04-01T00:00:00Z'),
        updated_at: new Date('2026-04-01T00:00:00Z'),
      };
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [createdRow],
      });

      const res = await service.createInsuranceRate('tenant-1', 'user-1', {
        rate_type: 'health_insurance',
        prefecture: 'tokyo',
        rate_employee: 0.04985,
        rate_employer: 0.04985,
        effective_from: '2026-04-01',
        effective_to: null,
        description: '令和8年度 健康保険料率 (東京)',
      });

      expect(res.id).toBe('rate-1');
      expect(res.rate_employee).toBe(0.04985);
      expect(res.rate_employer).toBe(0.04985);
      expect(res.rate_total).toBe(0.0997);
      expect(mockAuditLogs.record).toHaveBeenCalled();
    });

    it('有効期間重複エラー(23P01)発生時に400 Bad Request例外をスローする', async () => {
      // 1. assertUserPermission PASS
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. INSERT 失敗 (PostgreSQL exclusion_violation)
      const excludeErr: any = new Error('conflicting key value violates exclusion constraint');
      excludeErr.code = '23P01';
      mockClient.query.mockRejectedValueOnce(excludeErr);

      await expect(
        service.createInsuranceRate('tenant-1', 'user-1', {
          rate_type: 'health_insurance',
          prefecture: 'tokyo',
          rate_employee: 0.05,
          rate_employer: 0.05,
          effective_from: '2026-05-01',
          effective_to: null,
        }),
      ).rejects.toThrow(AppException);
    });

    it('指定日時点で有効な保険料率(effective_toがNULLの現行有効分含む)を正しく取得できる', async () => {
      // 1. assertUserPermission PASS
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. SELECT 結果
      const matchedRow = {
        id: 'rate-pension-1',
        tenant_id: 'tenant-1',
        rate_type: 'pension',
        prefecture: null,
        rate_employee: '0.09150',
        rate_employer: '0.09150',
        effective_from: '2026-04-01',
        effective_to: null,
        description: '厚生年金保険料率 (全国一律)',
        created_by: 'user-1',
        created_at: new Date(),
        updated_at: new Date(),
      };
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [matchedRow],
      });

      const res = await service.getEffectiveInsuranceRate('tenant-1', 'user-1', {
        date: '2026-10-15',
        rate_type: 'pension',
      });

      expect(res).not.toBeNull();
      expect(res?.rate_type).toBe('pension');
      expect(res?.rate_employee).toBe(0.0915);
      expect(res?.effective_to).toBeNull();
    });
  });

  describe('所得税源泉徴収税額表 (income_tax_withholding_brackets)', () => {
    it('税額帯を一括登録し、監査ログを記録する', async () => {
      // 1. assertUserPermission PASS
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. INSERT 1件目
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 'bracket-1',
            tenant_id: 'tenant-1',
            dependents_count: 0,
            income_min: '88000',
            income_max: '89000',
            tax_amount: '130',
            effective_from: '2026-04-01',
            effective_to: null,
            description: null,
            created_by: 'user-1',
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });
      // 3. INSERT 2件目
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 'bracket-2',
            tenant_id: 'tenant-1',
            dependents_count: 0,
            income_min: '89000',
            income_max: '90000',
            tax_amount: '160',
            effective_from: '2026-04-01',
            effective_to: null,
            description: null,
            created_by: 'user-1',
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const res = await service.bulkCreateTaxBrackets('tenant-1', 'user-1', {
        items: [
          {
            dependents_count: 0,
            income_min: 88000,
            income_max: 89000,
            tax_amount: 130,
            effective_from: '2026-04-01',
          },
          {
            dependents_count: 0,
            income_min: 89000,
            income_max: 90000,
            tax_amount: 160,
            effective_from: '2026-04-01',
          },
        ],
      });

      expect(res.length).toBe(2);
      expect(res[0]?.income_min).toBe(88000);
      expect(res[0]?.tax_amount).toBe(130);
      expect(res[1]?.income_min).toBe(89000);
      expect(res[1]?.tax_amount).toBe(160);
      expect(mockAuditLogs.record).toHaveBeenCalled();
    });

    it('指定日・所得・扶養人数から該当税額を取得できる', async () => {
      // 1. assertUserPermission PASS
      mockClient.query.mockResolvedValueOnce({ rowCount: 1, rows: [{}] });
      // 2. SELECT
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 'bracket-hit',
            tenant_id: 'tenant-1',
            dependents_count: 1,
            income_min: '250000',
            income_max: '252000',
            tax_amount: '3520',
            effective_from: '2026-04-01',
            effective_to: null,
            description: null,
            created_by: 'user-1',
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const res = await service.getEffectiveTaxAmount('tenant-1', 'user-1', {
        date: '2026-10-25',
        income: 251000,
        dependents_count: 1,
      });

      expect(res).not.toBeNull();
      expect(res?.dependents_count).toBe(1);
      expect(res?.tax_amount).toBe(3520);
    });
  });
});
