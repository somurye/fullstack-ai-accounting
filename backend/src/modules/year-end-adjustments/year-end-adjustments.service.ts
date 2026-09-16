import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, PaginationMeta } from '../../common/http/envelope';
import {
  YearEndAdjustmentCalculateInput,
  YearEndAdjustmentListQuery,
  YearEndAdjustmentSubmitApprovalInput,
} from './dto/year-end-adjustment.schemas';
import {
  mapYearEndAdjustmentRow,
  YEAR_END_ADJUSTMENT_COLUMNS,
  YearEndAdjustmentDeductions,
  YearEndAdjustmentDto,
  YearEndAdjustmentRow,
} from './year-end-adjustments.mapper';

@Injectable()
export class YearEndAdjustmentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * 年末調整一覧取得
   */
  async list(
    tenantId: string,
    userId: string,
    query: YearEndAdjustmentListQuery,
  ): Promise<{ adjustments: YearEndAdjustmentDto[]; pagination: PaginationMeta }> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.checkPermission(client, tenantId, userId, 'year_end_adjustment.view');

      const empFilter = await this.resolveEmployeeRestriction(client, tenantId, userId);

      const conditions: string[] = ['y.tenant_id = $1'];
      const values: unknown[] = [tenantId];
      let paramIdx = 2;

      if (empFilter) {
        conditions.push(`y.employee_id = $${paramIdx++}`);
        values.push(empFilter);
      } else if (query.employee_id) {
        conditions.push(`y.employee_id = $${paramIdx++}`);
        values.push(query.employee_id);
      }

      if (query.tax_year) {
        conditions.push(`y.tax_year = $${paramIdx++}`);
        values.push(query.tax_year);
      }

      if (query.status) {
        conditions.push(`y.status = $${paramIdx++}`);
        values.push(query.status);
      }

      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ total: string }>(
        `SELECT COUNT(*) AS total
         FROM year_end_adjustments y
         WHERE ${whereClause}`,
        values,
      );
      const totalCount = parseInt(countResult.rows[0]?.total ?? '0', 10);

      const offset = (query.page - 1) * query.page_size;
      const listValues = [...values, query.page_size, offset];

      const listResult = await client.query<YearEndAdjustmentRow>(
        `SELECT ${YEAR_END_ADJUSTMENT_COLUMNS}
         FROM year_end_adjustments y
         JOIN employees e ON e.id = y.employee_id
         LEFT JOIN departments d ON d.id = e.department_id
         WHERE ${whereClause}
         ORDER BY y.tax_year DESC, e.employee_no ASC
         LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        listValues,
      );

      const adjustments = listResult.rows.map(mapYearEndAdjustmentRow);
      return {
        adjustments,
        pagination: buildPagination(query.page, query.page_size, totalCount),
      };
    });
  }

  /**
   * 年末調整詳細取得
   */
  async findById(tenantId: string, userId: string, id: string): Promise<YearEndAdjustmentDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.checkPermission(client, tenantId, userId, 'year_end_adjustment.view');

      const empFilter = await this.resolveEmployeeRestriction(client, tenantId, userId);

      const result = await client.query<YearEndAdjustmentRow>(
        `SELECT ${YEAR_END_ADJUSTMENT_COLUMNS}
         FROM year_end_adjustments y
         JOIN employees e ON e.id = y.employee_id
         LEFT JOIN departments d ON d.id = e.department_id
         WHERE y.tenant_id = $1 AND y.id = $2`,
        [tenantId, id],
      );

      if (result.rowCount === 0) {
        throw AppException.notFound('指定された年末調整レコードが見つかりません');
      }

      const adjustment = mapYearEndAdjustmentRow(result.rows[0]);
      if (empFilter && adjustment.employee_id !== empFilter) {
        throw AppException.forbidden('他の従業員の年末調整を閲覧する権限がありません');
      }

      return adjustment;
    });
  }

  /**
   * 年間確定給与から年末調整を計算 (ドラフト作成または再計算)
   */
  async calculate(
    tenantId: string,
    userId: string,
    dto: YearEndAdjustmentCalculateInput,
  ): Promise<YearEndAdjustmentDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.checkPermission(client, tenantId, userId, 'year_end_adjustment.create');

      // 0. サポート対象年度の検証 (現在は2026年分・令和8年分の簡略モデルのみサポート)
      if (dto.tax_year !== 2026) {
        throw new AppException(
          'UNSUPPORTED_TAX_YEAR',
          `年末調整機能は現在、2026年分(令和8年分)の簡略税制モデルのみサポートしています (指定年度: ${dto.tax_year})`,
          400,
        );
      }

      // 1. 従業員存在確認
      const empCheck = await client.query(
        `SELECT id, name FROM employees WHERE tenant_id = $1 AND id = $2`,
        [tenantId, dto.employee_id],
      );
      if (empCheck.rowCount === 0) {
        throw AppException.notFound('指定された従業員が見つかりません');
      }

      // 2. 既存レコードの確認
      const existingRes = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM year_end_adjustments
         WHERE tenant_id = $1 AND employee_id = $2 AND tax_year = $3`,
        [tenantId, dto.employee_id, dto.tax_year],
      );

      if ((existingRes.rowCount ?? 0) > 0 && existingRes.rows[0].status === 'active') {
        throw AppException.conflict(
          'ALREADY_EXISTS',
          `この従業員の ${dto.tax_year} 年分年末調整は既に確定(active)しており再計算できません`,
        );
      }

      // 3. 対象年度の確定済み給与(payroll_calculations, status='active')の年間集計
      const payRes = await client.query<{
        gross_sum: string;
        social_sum: string;
        withheld_sum: string;
      }>(
        `SELECT
           COALESCE(SUM(c.total_gross_pay), 0) AS gross_sum,
           COALESCE(SUM(
             c.health_insurance_amount + c.care_insurance_amount +
             c.pension_amount + c.employment_insurance_amount
           ), 0) AS social_sum,
           COALESCE(SUM(c.income_tax_amount), 0) AS withheld_sum
         FROM payroll_calculations c
         JOIN payroll_periods pp ON pp.id = c.payroll_period_id
         WHERE c.tenant_id = $1 AND c.employee_id = $2 AND c.status = 'active'
           AND EXTRACT(YEAR FROM pp.period_start) = $3`,
        [tenantId, dto.employee_id, dto.tax_year],
      );

      const annualGrossPay = Math.round(Number(payRes.rows[0]?.gross_sum ?? 0));
      const annualSocialInsurance = Math.round(Number(payRes.rows[0]?.social_sum ?? 0));
      const annualWithheldTax = Math.round(Number(payRes.rows[0]?.withheld_sum ?? 0));

      // 4. 給与所得控除後の給与等の金額 (annual_taxable_pay) の算出 (簡略速算式)
      const employmentIncomeDeduction = this.calcEmploymentIncomeDeduction(annualGrossPay);
      const annualTaxablePay = Math.max(0, annualGrossPay - employmentIncomeDeduction);

      // 5. 所得控除額の算出
      const basicDeduction = annualGrossPay <= 24000000 ? 480000 : 0;
      const spouseDeduction = Math.min(dto.spouse_deduction, 380000);
      const dependentsDeduction = dto.dependents_count * 380000;
      const lifeInsuranceDeduction = Math.min(dto.life_insurance_deduction, 120000);
      const earthquakeInsuranceDeduction = Math.min(dto.earthquake_insurance_deduction, 50000);
      const housingLoanDeduction = dto.housing_loan_deduction;

      const deductions: YearEndAdjustmentDeductions = {
        basic_deduction: basicDeduction,
        spouse_deduction: spouseDeduction,
        dependents_deduction: dependentsDeduction,
        life_insurance_deduction: lifeInsuranceDeduction,
        earthquake_insurance_deduction: earthquakeInsuranceDeduction,
        housing_loan_deduction: housingLoanDeduction,
        social_insurance_deduction: annualSocialInsurance,
      };

      const totalDeductions =
        basicDeduction +
        spouseDeduction +
        dependentsDeduction +
        lifeInsuranceDeduction +
        earthquakeInsuranceDeduction +
        annualSocialInsurance;

      // 6. 課税給与所得金額 (taxable_income_after_deductions)
      const rawTaxableIncome = Math.max(0, annualTaxablePay - (totalDeductions - annualSocialInsurance));
      // 1,000円未満切り捨て
      const taxableIncomeAfterDeductions = Math.floor(rawTaxableIncome / 1000) * 1000;

      // 7. 算出年税額 (final_annual_tax)
      const baseIncomeTax = this.calcIncomeTaxFromBrackets(taxableIncomeAfterDeductions);
      // 復興特別所得税 102.1% + 住宅借入金等特別控除の適用
      const incomeTaxWithReconstruction = Math.floor((baseIncomeTax * 1.021) / 100) * 100;
      const finalAnnualTax = Math.max(0, incomeTaxWithReconstruction - housingLoanDeduction);

      // 8. 過不足税額 (adjustment_amount: プラス=還付, マイナス=追徴)
      const adjustmentAmount = annualWithheldTax - finalAnnualTax;

      // 9. 計算根拠マスタIDの取得 (所得金額・扶養人数・対象年度に合致する所得税ブラケットを実際に検索)
      const targetDate = `${dto.tax_year}-12-31`;
      const bracketRes = await client.query<{ id: string }>(
        `SELECT id
         FROM income_tax_withholding_brackets
         WHERE tenant_id = $1
           AND dependents_count = $2
           AND effective_from <= $3::date
           AND (effective_to IS NULL OR effective_to >= $3::date)
           AND income_min <= $4
           AND (income_max IS NULL OR income_max > $4)
         ORDER BY income_min DESC
         LIMIT 1`,
        [tenantId, dto.dependents_count, targetDate, taxableIncomeAfterDeductions],
      );

      if ((bracketRes.rowCount ?? 0) === 0) {
        throw new AppException(
          'TAX_BRACKET_NOT_FOUND',
          `対象年度(${dto.tax_year}年)・扶養親族等の数(${dto.dependents_count}人)・課税給与所得金額(${taxableIncomeAfterDeductions}円)に合致する所得税源泉徴収税額表がマスタに登録されていません`,
          400,
        );
      }

      const appliedRateIds = bracketRes.rows.map((r) => r.id);

      let adjustmentRecord: YearEndAdjustmentRow;

      if ((existingRes.rowCount ?? 0) > 0) {
        // 既存draft/rejectedの更新
        const updateRes = await client.query<YearEndAdjustmentRow>(
          `UPDATE year_end_adjustments
           SET annual_gross_pay = $1,
               annual_taxable_pay = $2,
               annual_social_insurance = $3,
               annual_withheld_tax = $4,
               deductions = $5,
               total_deductions = $6,
               taxable_income_after_deductions = $7,
               final_annual_tax = $8,
               adjustment_amount = $9,
               applied_rate_ids = $10,
               status = 'draft',
               updated_at = now()
           WHERE id = $11
           RETURNING *`,
          [
            annualGrossPay,
            annualTaxablePay,
            annualSocialInsurance,
            annualWithheldTax,
            JSON.stringify(deductions),
            totalDeductions,
            taxableIncomeAfterDeductions,
            finalAnnualTax,
            adjustmentAmount,
            JSON.stringify(appliedRateIds),
            existingRes.rows[0].id,
          ],
        );
        adjustmentRecord = {
          employee_name: empCheck.rows[0]?.name ?? '',
          ...updateRes.rows[0],
        };
      } else {
        // 新規INSERT
        const insertRes = await client.query<YearEndAdjustmentRow>(
          `INSERT INTO year_end_adjustments (
              tenant_id, employee_id, tax_year, annual_gross_pay,
              annual_taxable_pay, annual_social_insurance, annual_withheld_tax,
              deductions, total_deductions, taxable_income_after_deductions,
              final_annual_tax, adjustment_amount, applied_rate_ids,
              status, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'draft', $14)
            RETURNING *`,
          [
            tenantId,
            dto.employee_id,
            dto.tax_year,
            annualGrossPay,
            annualTaxablePay,
            annualSocialInsurance,
            annualWithheldTax,
            JSON.stringify(deductions),
            totalDeductions,
            taxableIncomeAfterDeductions,
            finalAnnualTax,
            adjustmentAmount,
            JSON.stringify(appliedRateIds),
            userId,
          ],
        );
        adjustmentRecord = {
          employee_name: empCheck.rows[0]?.name ?? '',
          ...insertRes.rows[0],
        };
      }

      const dtoResult = mapYearEndAdjustmentRow(adjustmentRecord);

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'year_end_adjustment.calculated',
        targetType: 'year_end_adjustment',
        targetId: dtoResult.id,
        afterData: {
          employee_id: dtoResult.employee_id,
          tax_year: dtoResult.tax_year,
          annual_gross_pay: dtoResult.annual_gross_pay,
          final_annual_tax: dtoResult.final_annual_tax,
          adjustment_amount: dtoResult.adjustment_amount,
        },
      });

      return dtoResult;
    });
  }

  /**
   * 承認申請 (approval_requests との連携、P3-T3パターン踏襲)
   */
  async submitApproval(
    tenantId: string,
    userId: string,
    id: string,
    dto: YearEndAdjustmentSubmitApprovalInput,
  ): Promise<YearEndAdjustmentDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.checkPermission(client, tenantId, userId, 'year_end_adjustment.create');

      // 1. 年末調整レコード取得
      const adjRes = await client.query<{ id: string; status: string; employee_id: string }>(
        `SELECT id, status, employee_id FROM year_end_adjustments WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      if (adjRes.rowCount === 0) {
        throw AppException.notFound('指定された年末調整レコードが見つかりません');
      }
      const adj = adjRes.rows[0];
      if (!['draft', 'rejected'].includes(adj.status)) {
        throw AppException.conflict('INVALID_STATE_TRANSITION', 'draftまたはrejected状態のみ申請できます');
      }

      // 従業員自身による承認申請は可能だが、自己承認はDBトリガーで拒否される
      // 2. 承認ルール(approval_rules, target_type='year_end_adjustment')の確認
      const rulesRes = await client.query<{
        id: string;
        step_number: number;
        approver_role_id: string | null;
        approver_user_id: string | null;
        is_explicit_auto_approve: boolean;
      }>(
        `SELECT id, step_number, approver_role_id, approver_user_id, is_explicit_auto_approve
         FROM approval_rules
         WHERE tenant_id = $1 AND target_type = 'year_end_adjustment' AND is_active = TRUE
         ORDER BY step_number ASC`,
        [tenantId],
      );

      if (rulesRes.rowCount === 0) {
        throw new AppException(
          'NO_APPROVAL_RULES_CONFIGURED',
          '年末調整の承認ルール(approval_rules)が設定されていません。暗黙の自動承認を防ぐため申請を中止しました。',
          400,
        );
      }

      const rules = rulesRes.rows;
      const isAutoApprove = rules.length === 1 && rules[0].is_explicit_auto_approve;

      let approvalRequestId: string;

      if (isAutoApprove) {
        // employee自身が自分の年末調整を自動確定できないように防御
        const selfEmpId = await this.resolveEmployeeRestriction(client, tenantId, userId);
        if (selfEmpId && selfEmpId === adj.employee_id) {
          throw AppException.forbidden(
            '従業員自身が自分の年末調整を確定することはできません。上位管理者による承認が必要です。',
          );
        }

        // 明示的0-step自動承認
        // DBトリガー fn_enforce_approval_requests_initial_status() により、
        // 直接 status = 'approved' でのINSERTは禁止されているため、初期は 'pending' でINSERT
        const arRes = await client.query<{ id: string }>(
          `INSERT INTO approval_requests (
             tenant_id, target_type, target_id, submitted_by, total_steps, current_step, status
           ) VALUES ($1, 'year_end_adjustment', $2, $3, 0, 0, 'pending')
           RETURNING id`,
          [tenantId, adj.id, userId],
        );
        approvalRequestId = arRes.rows[0].id;

        // 次に UPDATE で approved へ遷移
        await client.query(
          `UPDATE approval_requests SET status = 'approved', completed_at = now() WHERE id = $1`,
          [approvalRequestId],
        );

        // year_end_adjustments を active へ遷移
        await client.query(
          `UPDATE year_end_adjustments
           SET status = 'active', approved_at = now(), approval_request_id = $1, updated_at = now()
           WHERE tenant_id = $2 AND id = $3`,
          [approvalRequestId, tenantId, adj.id],
        );

        await this.auditLogs.record(client, tenantId, {
          actorUserId: userId,
          action: 'year_end_adjustment.approved',
          targetType: 'year_end_adjustment',
          targetId: adj.id,
          afterData: { status: 'active', auto_approved: true },
        });
      } else {
        // 多段階承認
        const totalSteps = rules.length;
        const arRes = await client.query<{ id: string }>(
          `INSERT INTO approval_requests (
             tenant_id, target_type, target_id, submitted_by, total_steps, current_step, status
           ) VALUES ($1, 'year_end_adjustment', $2, $3, $4, 1, 'pending')
           RETURNING id`,
          [tenantId, adj.id, userId, totalSteps],
        );
        approvalRequestId = arRes.rows[0].id;

        await client.query(
          `UPDATE year_end_adjustments
           SET status = 'pending_approval', approval_request_id = $1, updated_at = now()
           WHERE tenant_id = $2 AND id = $3`,
          [approvalRequestId, tenantId, adj.id],
        );

        await this.auditLogs.record(client, tenantId, {
          actorUserId: userId,
          action: 'year_end_adjustment.submitted',
          targetType: 'year_end_adjustment',
          targetId: adj.id,
          afterData: { status: 'pending_approval', approval_request_id: approvalRequestId },
        });
      }

      const updated = await client.query<YearEndAdjustmentRow>(
        `SELECT ${YEAR_END_ADJUSTMENT_COLUMNS}
         FROM year_end_adjustments y
         JOIN employees e ON e.id = y.employee_id
         LEFT JOIN departments d ON d.id = e.department_id
         WHERE y.tenant_id = $1 AND y.id = $2`,
        [tenantId, adj.id],
      );

      return mapYearEndAdjustmentRow(updated.rows[0]);
    });
  }

  /**
   * 給与所得控除の計算 (速算表)
   */
  private calcEmploymentIncomeDeduction(grossPay: number): number {
    if (grossPay <= 0) return 0;
    if (grossPay <= 1625000) return Math.min(grossPay, 550000);
    if (grossPay <= 1800000) return Math.round(grossPay * 0.4 - 100000);
    if (grossPay <= 3600000) return Math.round(grossPay * 0.3 + 80000);
    if (grossPay <= 6600000) return Math.round(grossPay * 0.2 + 440000);
    if (grossPay <= 8500000) return Math.round(grossPay * 0.1 + 1100000);
    return 1950000;
  }

  /**
   * 所得税速算表に基づく基準税額算出
   */
  private calcIncomeTaxFromBrackets(taxableIncome: number): number {
    if (taxableIncome <= 0) return 0;
    if (taxableIncome <= 1950000) return Math.round(taxableIncome * 0.05);
    if (taxableIncome <= 3300000) return Math.round(taxableIncome * 0.1 - 97500);
    if (taxableIncome <= 6950000) return Math.round(taxableIncome * 0.2 - 427500);
    if (taxableIncome <= 9000000) return Math.round(taxableIncome * 0.23 - 636000);
    if (taxableIncome <= 18000000) return Math.round(taxableIncome * 0.33 - 1536000);
    if (taxableIncome <= 40000000) return Math.round(taxableIncome * 0.4 - 2796000);
    return Math.round(taxableIncome * 0.45 - 4796000);
  }

  /**
   * employee ロールの場合、自身の employee_id のみに制限する
   */
  private async resolveEmployeeRestriction(
    client: PoolClient,
    tenantId: string,
    userId: string,
  ): Promise<string | null> {
    const rolesRes = await client.query<{ code: string }>(
      `SELECT r.code
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.tenant_id = $1 AND ur.user_id = $2`,
      [tenantId, userId],
    );

    const codes = rolesRes.rows.map((r: { code: string }) => r.code);
    const isManagerOrAdmin = codes.some((c: string) =>
      ['owner', 'payroll_admin', 'accounting_manager'].includes(c),
    );

    if (isManagerOrAdmin) {
      return null;
    }

    const empRes = await client.query<{ id: string }>(
      `SELECT e.id
       FROM employees e
       JOIN users u ON u.email = e.email
       WHERE e.tenant_id = $1 AND u.id = $2
       LIMIT 1`,
      [tenantId, userId],
    );

    if (empRes.rowCount === 0) {
      return '00000000-0000-0000-0000-000000000000';
    }

    return empRes.rows[0].id;
  }

  /**
   * サービス層 RBAC 検証 (三層防御)
   */
  private async checkPermission(
    client: PoolClient,
    tenantId: string,
    userId: string,
    permissionCode: string,
  ): Promise<void> {
    const res = await client.query(
      `SELECT 1
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.tenant_id = $1 AND ur.user_id = $2
         AND p.code = $3
       LIMIT 1`,
      [tenantId, userId, permissionCode],
    );
    if ((res.rowCount ?? 0) === 0) {
      throw AppException.forbidden(`操作に必要な権限 (${permissionCode}) がありません`);
    }
  }
}

