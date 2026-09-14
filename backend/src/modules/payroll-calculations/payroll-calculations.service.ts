import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AppException } from '../../common/exceptions/app.exception';
import { DatabaseService } from '../../database/database.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type {
  CalculatePayrollInput,
  ClosePayrollProfileInput,
  CreatePayrollPeriodInput,
  CreatePayrollProfileInput,
  SubmitApprovalInput,
} from './dto/payroll-calculations.schemas';

export interface AppliedRateEntry {
  type: 'health_insurance' | 'care_insurance' | 'pension' | 'employment_insurance' | 'income_tax';
  rate_id: string;
  name?: string;
  rate?: number;
  base_amount?: number;
  dependents_count?: number;
  taxable_income?: number;
  tax_amount?: number;
}

export interface PayrollProfileRow {
  id: string;
  tenant_id: string;
  employee_id: string;
  salary_type: 'monthly' | 'hourly';
  base_salary: string;
  hourly_wage: string;
  standard_monthly_remuneration: string;
  dependents_count: number;
  has_health_insurance: boolean;
  has_care_insurance: boolean;
  has_pension: boolean;
  has_employment_insurance: boolean;
  resident_tax_amount: string;
  prefecture: string | null;
  effective_from: string;
  effective_to: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface PayrollPeriodRow {
  id: string;
  tenant_id: string;
  name: string;
  period_start: string;
  period_end: string;
  payment_date: string;
  status: 'draft' | 'calculating' | 'calculated' | 'approved' | 'closed';
  created_at: Date;
  updated_at: Date;
}

export interface PayrollCalculationRow {
  id: string;
  tenant_id: string;
  payroll_period_id: string;
  employee_id: string;
  regular_hours: string;
  overtime_hours: string;
  late_night_hours: string;
  holiday_hours: string;
  salary_type: string;
  base_salary: string;
  hourly_wage: string;
  regular_pay: string;
  overtime_pay: string;
  late_night_pay: string;
  holiday_pay: string;
  total_gross_pay: string;
  health_insurance_amount: string;
  care_insurance_amount: string;
  pension_amount: string;
  employment_insurance_amount: string;
  income_tax_amount: string;
  resident_tax_amount: string;
  total_deductions: string;
  net_pay: string;
  applied_rate_ids: AppliedRateEntry[];
  status: 'draft' | 'pending_approval' | 'active' | 'rejected';
  created_by: string;
  approved_at: Date | null;
  approval_request_id: string | null;
  created_at: Date;
  updated_at: Date;
  employee_name?: string;
  employee_no?: string;
}

@Injectable()
export class PayrollCalculationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * Service層二重RBAC防御: 実行ユーザーが要求されたパーミッションを持つか検証
   */
  private async enforcePermission(
    client: PoolClient,
    tenantId: string,
    userId: string,
    requiredPermission: string,
  ): Promise<void> {
    const res = await client.query(
      `SELECT 1
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.tenant_id = $1 AND ur.user_id = $2
         AND p.code = $3
       LIMIT 1`,
      [tenantId, userId, requiredPermission],
    );
    if (res.rowCount === 0) {
      throw AppException.forbidden(`操作に必要な権限 (${requiredPermission}) がありません`);
    }
  }

  // --------------------------------------------------------------------------
  // 1. 従業員給与プロファイル (employee_payroll_profiles)
  // --------------------------------------------------------------------------

  async createProfile(
    tenantId: string,
    userId: string,
    input: CreatePayrollProfileInput,
  ): Promise<PayrollProfileRow> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.enforcePermission(client, tenantId, userId, 'payroll.create');

      try {
        const result = await client.query<PayrollProfileRow>(
          `INSERT INTO employee_payroll_profiles (
            tenant_id, employee_id, salary_type, base_salary, hourly_wage,
            standard_monthly_remuneration, dependents_count,
            has_health_insurance, has_care_insurance, has_pension, has_employment_insurance,
            resident_tax_amount, prefecture, effective_from, effective_to
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          RETURNING *`,
          [
            tenantId,
            input.employee_id,
            input.salary_type,
            input.base_salary,
            input.hourly_wage,
            input.standard_monthly_remuneration,
            input.dependents_count,
            input.has_health_insurance,
            input.has_care_insurance,
            input.has_pension,
            input.has_employment_insurance,
            input.resident_tax_amount,
            input.prefecture ?? null,
            input.effective_from,
            input.effective_to ?? null,
          ],
        );

        const profile = result.rows[0];
        await this.auditLogs.record(client, tenantId, {
          actorUserId: userId,
          action: 'payroll_profile.created',
          targetType: 'employee_payroll_profile',
          targetId: profile.id,
          afterData: profile,
        });

        return profile;
      } catch (err: unknown) {
        this.handleDbError(err);
      }
    });
  }

  async closeProfile(
    tenantId: string,
    userId: string,
    profileId: string,
    input: ClosePayrollProfileInput,
  ): Promise<PayrollProfileRow> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.enforcePermission(client, tenantId, userId, 'payroll.create');

      try {
        const result = await client.query<PayrollProfileRow>(
          `UPDATE employee_payroll_profiles
           SET effective_to = $3, updated_at = now()
           WHERE tenant_id = $1 AND id = $2
           RETURNING *`,
          [tenantId, profileId, input.effective_to],
        );

        if (result.rowCount === 0) {
          throw AppException.notFound('指定された給与プロファイルが見つかりません');
        }

        const profile = result.rows[0];
        await this.auditLogs.record(client, tenantId, {
          actorUserId: userId,
          action: 'payroll_profile.closed',
          targetType: 'employee_payroll_profile',
          targetId: profile.id,
          afterData: profile,
        });

        return profile;
      } catch (err: unknown) {
        this.handleDbError(err);
      }
    });
  }

  async getProfilesByEmployee(
    tenantId: string,
    userId: string,
    employeeId: string,
  ): Promise<PayrollProfileRow[]> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.enforcePermission(client, tenantId, userId, 'payroll.view');

      const result = await client.query<PayrollProfileRow>(
        `SELECT * FROM employee_payroll_profiles
         WHERE tenant_id = $1 AND employee_id = $2
         ORDER BY effective_from ASC`,
        [tenantId, employeeId],
      );

      return result.rows;
    });
  }

  // --------------------------------------------------------------------------
  // 2. 給与計算期間 (payroll_periods)
  // --------------------------------------------------------------------------

  async createPeriod(
    tenantId: string,
    userId: string,
    input: CreatePayrollPeriodInput,
  ): Promise<PayrollPeriodRow> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.enforcePermission(client, tenantId, userId, 'payroll.create');

      try {
        const result = await client.query<PayrollPeriodRow>(
          `INSERT INTO payroll_periods (
            tenant_id, name, period_start, period_end, payment_date, status
          ) VALUES ($1, $2, $3, $4, $5, 'draft')
          RETURNING *`,
          [tenantId, input.name, input.period_start, input.period_end, input.payment_date],
        );

        const period = result.rows[0];
        await this.auditLogs.record(client, tenantId, {
          actorUserId: userId,
          action: 'payroll_period.created',
          targetType: 'payroll_period',
          targetId: period.id,
          afterData: period,
        });

        return period;
      } catch (err: unknown) {
        this.handleDbError(err);
      }
    });
  }

  async listPeriods(
    tenantId: string,
    userId: string,
  ): Promise<PayrollPeriodRow[]> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.enforcePermission(client, tenantId, userId, 'payroll.view');

      const result = await client.query<PayrollPeriodRow>(
        `SELECT * FROM payroll_periods
         WHERE tenant_id = $1
         ORDER BY period_start DESC`,
        [tenantId],
      );

      return result.rows;
    });
  }

  async getPeriod(
    tenantId: string,
    userId: string,
    periodId: string,
  ): Promise<PayrollPeriodRow> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.enforcePermission(client, tenantId, userId, 'payroll.view');

      const result = await client.query<PayrollPeriodRow>(
        `SELECT * FROM payroll_periods
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, periodId],
      );

      if (result.rowCount === 0) {
        throw AppException.notFound('指定された給与計算期間が見つかりません');
      }

      return result.rows[0];
    });
  }

  // --------------------------------------------------------------------------
  // 3. 給与計算エンジン (提案生成)
  // --------------------------------------------------------------------------

  /**
   * ルールエンジンによる給与計算の実行
   * 勤怠実績 × 従業員給与プロファイル × 料率・税率マスタ から提案 (draft) を生成する
   */
  async calculateForPeriod(
    tenantId: string,
    userId: string,
    periodId: string,
    input: CalculatePayrollInput = {},
  ): Promise<PayrollCalculationRow[]> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.enforcePermission(client, tenantId, userId, 'payroll.create');

      // 1. 給与期間の取得と検証
      const periodRes = await client.query<PayrollPeriodRow>(
        `SELECT * FROM payroll_periods WHERE tenant_id = $1 AND id = $2`,
        [tenantId, periodId],
      );
      if (periodRes.rowCount === 0) {
        throw AppException.notFound('指定された給与計算期間が見つかりません');
      }
      const period = periodRes.rows[0];

      // 2. 同一期間に対する並行計算の競合を防ぐ advisory lock
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('payroll_period_' || $1))`,
        [periodId],
      );

      // 3. 対象従業員の選定
      let employeeQuery = `SELECT id, employee_no, name FROM employees WHERE tenant_id = $1 AND status = 'active'`;
      const employeeParams: unknown[] = [tenantId];
      if (input.employee_ids && input.employee_ids.length > 0) {
        employeeParams.push(input.employee_ids);
        employeeQuery += ` AND id = ANY($2)`;
      }
      employeeQuery += ` ORDER BY employee_no ASC`;

      const employeesRes = await client.query<{ id: string; employee_no: string; name: string }>(
        employeeQuery,
        employeeParams,
      );
      if (employeesRes.rowCount === 0) {
        throw AppException.badRequest('計算対象となる有効な従業員が存在しません');
      }

      const calculations: PayrollCalculationRow[] = [];

      for (const emp of employeesRes.rows) {
        // A. 従業員の有効な給与プロファイルの取得 (期間末日時点で有効なもの)
        const profileRes = await client.query<PayrollProfileRow>(
          `SELECT * FROM employee_payroll_profiles
           WHERE tenant_id = $1 AND employee_id = $2
             AND effective_from <= $3
             AND (effective_to IS NULL OR effective_to >= $3)
           ORDER BY effective_from DESC
           LIMIT 1`,
          [tenantId, emp.id, period.period_end],
        );

        if (profileRes.rowCount === 0) {
          throw AppException.badRequest(
            `従業員 ${emp.name} (${emp.employee_no}) の有効な給与プロファイルが設定されていません`,
          );
        }
        const profile = profileRes.rows[0];

        // B. 対象期間の勤怠集計
        const attRes = await client.query<{
          reg_hours: string | null;
          ot_hours: string | null;
          night_hours: string | null;
          hol_hours: string | null;
        }>(
          `SELECT
             COALESCE(SUM(regular_hours), 0)::text AS reg_hours,
             COALESCE(SUM(overtime_hours), 0)::text AS ot_hours,
             COALESCE(SUM(late_night_hours), 0)::text AS night_hours,
             COALESCE(SUM(holiday_hours), 0)::text AS hol_hours
           FROM attendance_records
           WHERE tenant_id = $1 AND employee_id = $2
             AND work_date >= $3 AND work_date <= $4`,
          [tenantId, emp.id, period.period_start, period.period_end],
        );

        const regularHours = Number(attRes.rows[0]?.reg_hours ?? 0);
        const overtimeHours = Number(attRes.rows[0]?.ot_hours ?? 0);
        const lateNightHours = Number(attRes.rows[0]?.night_hours ?? 0);
        const holidayHours = Number(attRes.rows[0]?.hol_hours ?? 0);

        // C. 支給額の計算
        let regularPay = 0;
        let overtimePay = 0;
        let lateNightPay = 0;
        let holidayPay = 0;
        let totalGrossPay = 0;

        const baseSalary = Number(profile.base_salary);
        const hourlyWage = Number(profile.hourly_wage);

        if (profile.salary_type === 'monthly') {
          // 月給制: 月平均所定労働時間を160時間として基礎時給を算出
          const standardHours = 160.0;
          const hourlyBase = standardHours > 0 ? baseSalary / standardHours : 0;

          regularPay = baseSalary;
          overtimePay = Math.round(overtimeHours * hourlyBase * 1.25);
          lateNightPay = Math.round(lateNightHours * hourlyBase * 0.25);
          holidayPay = Math.round(holidayHours * hourlyBase * 1.35);
          totalGrossPay = regularPay + overtimePay + lateNightPay + holidayPay;
        } else {
          // 時給制
          regularPay = Math.round(regularHours * hourlyWage);
          overtimePay = Math.round(overtimeHours * hourlyWage * 1.25);
          lateNightPay = Math.round(lateNightHours * hourlyWage * 1.25);
          holidayPay = Math.round(holidayHours * hourlyWage * 1.35);
          totalGrossPay = regularPay + overtimePay + lateNightPay + holidayPay;
        }

        // D. 社会保険料控除の計算 (マスタ参照・料率ID追跡・スナップショット)
        const appliedRates: AppliedRateEntry[] = [];
        let healthInsuranceAmount = 0;
        let careInsuranceAmount = 0;
        let pensionAmount = 0;
        let employmentInsuranceAmount = 0;

        const smr = Number(profile.standard_monthly_remuneration) > 0
          ? Number(profile.standard_monthly_remuneration)
          : totalGrossPay;

        // 健康保険
        if (profile.has_health_insurance) {
          const hiRes = await client.query<{ id: string; description: string | null; rate_employee: string }>(
            `SELECT id, description, rate_employee
             FROM insurance_rate_tables
             WHERE tenant_id = $1 AND rate_type = 'health_insurance'
               AND (prefecture = $2 OR prefecture IS NULL)
               AND effective_from <= $3
               AND (effective_to IS NULL OR effective_to >= $3)
             ORDER BY prefecture DESC NULLS LAST, effective_from DESC
             LIMIT 1`,
            [tenantId, profile.prefecture ?? null, period.period_end],
          );
          if (hiRes.rowCount && hiRes.rowCount > 0) {
            const row = hiRes.rows[0];
            const rate = Number(row.rate_employee);
            healthInsuranceAmount = Math.round(smr * rate);
            appliedRates.push({
              type: 'health_insurance',
              rate_id: row.id,
              name: row.description ?? '健康保険',
              rate,
              base_amount: smr,
            });
          }
        }

        // 介護保険
        if (profile.has_care_insurance) {
          const ciRes = await client.query<{ id: string; description: string | null; rate_employee: string }>(
            `SELECT id, description, rate_employee
             FROM insurance_rate_tables
             WHERE tenant_id = $1 AND rate_type = 'care_insurance'
               AND (prefecture = $2 OR prefecture IS NULL)
               AND effective_from <= $3
               AND (effective_to IS NULL OR effective_to >= $3)
             ORDER BY prefecture DESC NULLS LAST, effective_from DESC
             LIMIT 1`,
            [tenantId, profile.prefecture ?? null, period.period_end],
          );
          if (ciRes.rowCount && ciRes.rowCount > 0) {
            const row = ciRes.rows[0];
            const rate = Number(row.rate_employee);
            careInsuranceAmount = Math.round(smr * rate);
            appliedRates.push({
              type: 'care_insurance',
              rate_id: row.id,
              name: row.description ?? '介護保険',
              rate,
              base_amount: smr,
            });
          }
        }

        // 厚生年金
        if (profile.has_pension) {
          const penRes = await client.query<{ id: string; description: string | null; rate_employee: string }>(
            `SELECT id, description, rate_employee
             FROM insurance_rate_tables
             WHERE tenant_id = $1 AND rate_type = 'pension'
               AND (prefecture = $2 OR prefecture IS NULL)
               AND effective_from <= $3
               AND (effective_to IS NULL OR effective_to >= $3)
             ORDER BY prefecture DESC NULLS LAST, effective_from DESC
             LIMIT 1`,
            [tenantId, profile.prefecture ?? null, period.period_end],
          );
          if (penRes.rowCount && penRes.rowCount > 0) {
            const row = penRes.rows[0];
            const rate = Number(row.rate_employee);
            pensionAmount = Math.round(smr * rate);
            appliedRates.push({
              type: 'pension',
              rate_id: row.id,
              name: row.description ?? '厚生年金',
              rate,
              base_amount: smr,
            });
          }
        }

        // 雇用保険 (総支給額が算定基礎)
        if (profile.has_employment_insurance) {
          const eiRes = await client.query<{ id: string; description: string | null; rate_employee: string }>(
            `SELECT id, description, rate_employee
             FROM insurance_rate_tables
             WHERE tenant_id = $1 AND rate_type = 'employment_insurance'
               AND effective_from <= $2
               AND (effective_to IS NULL OR effective_to >= $2)
             ORDER BY effective_from DESC
             LIMIT 1`,
            [tenantId, period.period_end],
          );
          if (eiRes.rowCount && eiRes.rowCount > 0) {
            const row = eiRes.rows[0];
            const rate = Number(row.rate_employee);
            employmentInsuranceAmount = Math.round(totalGrossPay * rate);
            appliedRates.push({
              type: 'employment_insurance',
              rate_id: row.id,
              name: row.description ?? '雇用保険',
              rate,
              base_amount: totalGrossPay,
            });
          }
        }

        const socialInsuranceDeductions =
          healthInsuranceAmount + careInsuranceAmount + pensionAmount + employmentInsuranceAmount;

        // E. 所得税源泉徴収税額の計算 (社保等控除後の給与額 × 扶養親族数)
        const taxableIncome = Math.max(0, totalGrossPay - socialInsuranceDeductions);
        let incomeTaxAmount = 0;

        const taxRes = await client.query<{ id: string; tax_amount: string }>(
          `SELECT id, tax_amount
           FROM income_tax_withholding_brackets
           WHERE tenant_id = $1
             AND dependents_count = $2
             AND effective_from <= $3
             AND (effective_to IS NULL OR effective_to >= $3)
             AND income_min <= $4
             AND (income_max IS NULL OR income_max > $4)
           ORDER BY income_min DESC
           LIMIT 1`,
          [tenantId, profile.dependents_count, period.period_end, taxableIncome],
        );

        if (taxRes.rowCount && taxRes.rowCount > 0) {
          const row = taxRes.rows[0];
          incomeTaxAmount = Number(row.tax_amount);
          appliedRates.push({
            type: 'income_tax',
            rate_id: row.id,
            dependents_count: profile.dependents_count,
            taxable_income: taxableIncome,
            tax_amount: incomeTaxAmount,
          });
        }

        // F. 住民税及び控除合計・差引支給額
        const residentTaxAmount = Number(profile.resident_tax_amount);
        const totalDeductions = socialInsuranceDeductions + incomeTaxAmount + residentTaxAmount;
        const netPay = Math.max(0, totalGrossPay - totalDeductions);

        // G. payroll_calculations レコードの保存 (UPSERT: 未確定draft時のみ再計算更新を許可、active時はDBトリガーでエラー)
        try {
          const calcResult = await client.query<PayrollCalculationRow>(
            `INSERT INTO payroll_calculations (
              tenant_id, payroll_period_id, employee_id,
              regular_hours, overtime_hours, late_night_hours, holiday_hours,
              salary_type, base_salary, hourly_wage,
              regular_pay, overtime_pay, late_night_pay, holiday_pay, total_gross_pay,
              health_insurance_amount, care_insurance_amount, pension_amount, employment_insurance_amount,
              income_tax_amount, resident_tax_amount, total_deductions, net_pay,
              applied_rate_ids, status, created_by
            ) VALUES (
              $1, $2, $3,
              $4, $5, $6, $7,
              $8, $9, $10,
              $11, $12, $13, $14, $15,
              $16, $17, $18, $19,
              $20, $21, $22, $23,
              $24, 'draft', $25
            )
            ON CONFLICT (tenant_id, payroll_period_id, employee_id)
            DO UPDATE SET
              regular_hours = EXCLUDED.regular_hours,
              overtime_hours = EXCLUDED.overtime_hours,
              late_night_hours = EXCLUDED.late_night_hours,
              holiday_hours = EXCLUDED.holiday_hours,
              salary_type = EXCLUDED.salary_type,
              base_salary = EXCLUDED.base_salary,
              hourly_wage = EXCLUDED.hourly_wage,
              regular_pay = EXCLUDED.regular_pay,
              overtime_pay = EXCLUDED.overtime_pay,
              late_night_pay = EXCLUDED.late_night_pay,
              holiday_pay = EXCLUDED.holiday_pay,
              total_gross_pay = EXCLUDED.total_gross_pay,
              health_insurance_amount = EXCLUDED.health_insurance_amount,
              care_insurance_amount = EXCLUDED.care_insurance_amount,
              pension_amount = EXCLUDED.pension_amount,
              employment_insurance_amount = EXCLUDED.employment_insurance_amount,
              income_tax_amount = EXCLUDED.income_tax_amount,
              resident_tax_amount = EXCLUDED.resident_tax_amount,
              total_deductions = EXCLUDED.total_deductions,
              net_pay = EXCLUDED.net_pay,
              applied_rate_ids = EXCLUDED.applied_rate_ids,
              status = 'draft',
              updated_at = now()
            RETURNING *`,
            [
              tenantId,
              periodId,
              emp.id,
              regularHours,
              overtimeHours,
              lateNightHours,
              holidayHours,
              profile.salary_type,
              baseSalary,
              hourlyWage,
              regularPay,
              overtimePay,
              lateNightPay,
              holidayPay,
              totalGrossPay,
              healthInsuranceAmount,
              careInsuranceAmount,
              pensionAmount,
              employmentInsuranceAmount,
              incomeTaxAmount,
              residentTaxAmount,
              totalDeductions,
              netPay,
              JSON.stringify(appliedRates),
              userId,
            ],
          );

          const calc = calcResult.rows[0];
          calc.employee_name = emp.name;
          calc.employee_no = emp.employee_no;
          calculations.push(calc);
        } catch (err: unknown) {
          this.handleDbError(err);
        }
      }

      // 給与期間ステータスを calculated に更新
      await client.query(
        `UPDATE payroll_periods SET status = 'calculated', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, periodId],
      );

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'payroll_calculation.generated',
        targetType: 'payroll_period',
        targetId: periodId,
        afterData: { count: calculations.length },
      });

      return calculations;
    });
  }

  async listCalculations(
    tenantId: string,
    userId: string,
    periodId: string,
  ): Promise<PayrollCalculationRow[]> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.enforcePermission(client, tenantId, userId, 'payroll.view');

      const result = await client.query<PayrollCalculationRow>(
        `SELECT pc.*, e.name AS employee_name, e.employee_no
         FROM payroll_calculations pc
         JOIN employees e ON e.id = pc.employee_id
         WHERE pc.tenant_id = $1 AND pc.payroll_period_id = $2
         ORDER BY e.employee_no ASC`,
        [tenantId, periodId],
      );

      return result.rows;
    });
  }

  async getCalculation(
    tenantId: string,
    userId: string,
    calculationId: string,
  ): Promise<PayrollCalculationRow> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.enforcePermission(client, tenantId, userId, 'payroll.view');

      const result = await client.query<PayrollCalculationRow>(
        `SELECT pc.*, e.name AS employee_name, e.employee_no
         FROM payroll_calculations pc
         JOIN employees e ON e.id = pc.employee_id
         WHERE pc.tenant_id = $1 AND pc.id = $2`,
        [tenantId, calculationId],
      );

      if (result.rowCount === 0) {
        throw AppException.notFound('指定された給与計算レコードが見つかりません');
      }

      return result.rows[0];
    });
  }

  // --------------------------------------------------------------------------
  // 4. 承認フロー連携 (既存 approval_requests / approval_rules の再利用)
  // --------------------------------------------------------------------------

  /**
   * 単一給与計算レコードの承認申請
   */
  async submitApproval(
    tenantId: string,
    userId: string,
    calculationId: string,
    input: SubmitApprovalInput = {},
  ): Promise<PayrollCalculationRow> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.enforcePermission(client, tenantId, userId, 'payroll.create');

      // 1. 対象レコードの取得とステータス検証
      const calcRes = await client.query<PayrollCalculationRow>(
        `SELECT * FROM payroll_calculations WHERE tenant_id = $1 AND id = $2`,
        [tenantId, calculationId],
      );
      if (calcRes.rowCount === 0) {
        throw AppException.notFound('指定された給与計算レコードが見つかりません');
      }
      const calc = calcRes.rows[0];
      if (calc.status !== 'draft' && calc.status !== 'rejected') {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          `draft または rejected 状態の給与計算のみ申請可能です (現在: ${calc.status})`,
        );
      }

      // 2. target_type = 'payroll' の有効な承認ルールの取得
      const rulesResult = await client.query<{
        step_number: number;
        is_explicit_auto_approve: boolean;
      }>(
        `SELECT step_number, is_explicit_auto_approve
         FROM approval_rules
         WHERE tenant_id = $1 AND target_type = 'payroll' AND is_active = TRUE
         ORDER BY step_number ASC`,
        [tenantId],
      );

      if (!rulesResult.rowCount || rulesResult.rowCount === 0) {
        // 承認ルールが未設定の場合はエラー (SoDの偶発的無効化・暗黙自動承認を防止)
        throw AppException.badRequest(
          '給与計算の承認ルールが設定されていません。承認ルールの設定を行ってください',
        );
      }

      // 3. 明示的な0-step自動承認ルール (is_explicit_auto_approve = TRUE) の確認 (1人テナント運用)
      const autoApproveRule = rulesResult.rows.find((r) => r.is_explicit_auto_approve);
      if (autoApproveRule) {
        // 承認リクエストを approved 状態で起票/更新 (監査証跡および確定境界のDB実在証明)
        const arResult = await client.query<{ id: string }>(
          `INSERT INTO approval_requests (
            tenant_id, target_type, target_id, submitted_by, total_steps, current_step, status
          ) VALUES ($1, 'payroll', $2, $3, 1, 1, 'approved')
          ON CONFLICT (target_type, target_id)
          DO UPDATE SET
            status = 'approved',
            current_step = 1,
            total_steps = 1,
            submitted_by = $3,
            updated_at = now()
          RETURNING id`,
          [tenantId, calculationId, userId],
        );
        const approvalRequestId = arResult.rows[0].id;

        const updateResult = await client.query<PayrollCalculationRow>(
          `UPDATE payroll_calculations
           SET status = 'active', approved_at = now(), approval_request_id = $3, updated_at = now()
           WHERE tenant_id = $1 AND id = $2
           RETURNING *`,
          [tenantId, calculationId, approvalRequestId],
        );
        const activeCalc = updateResult.rows[0];

        await this.auditLogs.record(client, tenantId, {
          actorUserId: userId,
          action: 'payroll.auto_approved',
          targetType: 'payroll',
          targetId: calculationId,
          afterData: { status: 'active', auto_approved: true, approval_request_id: approvalRequestId },
        });

        return activeCalc;
      }

      // 4. 承認ステップ >= 1: approval_requests を作成し pending_approval へ遷移
      const totalSteps = Math.max(...rulesResult.rows.map((r) => r.step_number));

      const arResult = await client.query<{ id: string }>(
        `INSERT INTO approval_requests (
          tenant_id, target_type, target_id, submitted_by, total_steps, current_step, status
        ) VALUES ($1, 'payroll', $2, $3, $4, 1, 'pending')
        ON CONFLICT (target_type, target_id)
        DO UPDATE SET
          status = 'pending',
          current_step = 1,
          submitted_by = $3,
          total_steps = $4,
          updated_at = now()
        RETURNING id`,
        [tenantId, calculationId, userId, totalSteps],
      );
      const approvalRequestId = arResult.rows[0].id;

      const updateResult = await client.query<PayrollCalculationRow>(
        `UPDATE payroll_calculations
         SET status = 'pending_approval', approval_request_id = $3, updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [tenantId, calculationId, approvalRequestId],
      );

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'payroll.approval_submitted',
        targetType: 'payroll',
        targetId: calculationId,
        afterData: { status: 'pending_approval', approval_request_id: approvalRequestId },
      });

      return updateResult.rows[0];
    });
  }

  /**
   * 期間全体の全ドラフト給与計算の一括承認申請
   */
  async submitPeriodApproval(
    tenantId: string,
    userId: string,
    periodId: string,
    input: SubmitApprovalInput = {},
  ): Promise<{ submitted_count: number }> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.enforcePermission(client, tenantId, userId, 'payroll.create');

      const calcs = await client.query<{ id: string }>(
        `SELECT id FROM payroll_calculations
         WHERE tenant_id = $1 AND payroll_period_id = $2 AND status IN ('draft', 'rejected')`,
        [tenantId, periodId],
      );

      if (calcs.rowCount === 0) {
        throw AppException.badRequest('承認申請対象の給与計算（draft / rejected）が存在しません');
      }

      // 承認ルール確認
      const rulesResult = await client.query<{
        step_number: number;
        is_explicit_auto_approve: boolean;
      }>(
        `SELECT step_number, is_explicit_auto_approve
         FROM approval_rules
         WHERE tenant_id = $1 AND target_type = 'payroll' AND is_active = TRUE
         ORDER BY step_number ASC`,
        [tenantId],
      );

      if (!rulesResult.rowCount || rulesResult.rowCount === 0) {
        throw AppException.badRequest(
          '給与計算の承認ルールが設定されていません。承認ルールの設定を行ってください',
        );
      }

      const autoApprove = rulesResult.rows.some((r) => r.is_explicit_auto_approve);
      const totalSteps = autoApprove ? 0 : Math.max(...rulesResult.rows.map((r) => r.step_number));

      for (const row of calcs.rows) {
        if (autoApprove) {
          const arResult = await client.query<{ id: string }>(
            `INSERT INTO approval_requests (
              tenant_id, target_type, target_id, submitted_by, total_steps, current_step, status
            ) VALUES ($1, 'payroll', $2, $3, 1, 1, 'approved')
            ON CONFLICT (target_type, target_id)
            DO UPDATE SET
              status = 'approved',
              current_step = 1,
              total_steps = 1,
              submitted_by = $3,
              updated_at = now()
            RETURNING id`,
            [tenantId, row.id, userId],
          );
          await client.query(
            `UPDATE payroll_calculations
             SET status = 'active', approved_at = now(), approval_request_id = $3, updated_at = now()
             WHERE tenant_id = $1 AND id = $2`,
            [tenantId, row.id, arResult.rows[0].id],
          );
        } else {
          const arResult = await client.query<{ id: string }>(
            `INSERT INTO approval_requests (
              tenant_id, target_type, target_id, submitted_by, total_steps, current_step, status
            ) VALUES ($1, 'payroll', $2, $3, $4, 1, 'pending')
            ON CONFLICT (target_type, target_id)
            DO UPDATE SET
              status = 'pending',
              current_step = 1,
              submitted_by = $3,
              total_steps = $4,
              updated_at = now()
            RETURNING id`,
            [tenantId, row.id, userId, totalSteps],
          );
          await client.query(
            `UPDATE payroll_calculations
             SET status = 'pending_approval', approval_request_id = $3, updated_at = now()
             WHERE tenant_id = $1 AND id = $2`,
            [tenantId, row.id, arResult.rows[0].id],
          );
        }
      }

      // 全件確定した場合は期間ステータスも approved に更新
      if (autoApprove) {
        await client.query(
          `UPDATE payroll_periods SET status = 'approved', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
          [tenantId, periodId],
        );
      }

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'payroll_period.approval_submitted',
        targetType: 'payroll_period',
        targetId: periodId,
        afterData: { count: calcs.rowCount, auto_approved: autoApprove },
      });

      return { submitted_count: calcs.rowCount ?? 0 };
    });
  }

  // --------------------------------------------------------------------------
  // DBエラーハンドリング (WORMトリガー等のわかりやすい例外変換)
  // --------------------------------------------------------------------------

  private handleDbError(err: unknown): never {
    const error = err as { code?: string; message?: string };
    if (error.code === '55000') {
      throw AppException.badRequest(error.message ?? '確定済みレコードまたは過去データの改変は禁止されています');
    }
    if (error.code === '23P01') {
      throw AppException.conflict('PERIOD_OVERLAP', '適用期間が重複するレコードが既に存在します');
    }
    if (error.code === '23505') {
      throw AppException.conflict('DUPLICATE_RECORD', '既に同一キーのレコードが存在します');
    }
    if (error.code === '23503') {
      throw AppException.badRequest(error.message ?? '関連データが存在しないか、テナント整合性が不正です');
    }
    throw err;
  }
}
