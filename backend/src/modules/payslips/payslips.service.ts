import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, PaginationMeta } from '../../common/http/envelope';
import { PayslipCreateInput, PayslipListQuery } from './dto/payslip.schemas';
import { mapPayslipRow, PAYSLIP_COLUMNS, PayslipDto, PayslipRow, PayslipSnapshotData } from './payslips.mapper';
import { PayslipPdfService } from './payslip-pdf.service';

@Injectable()
export class PayslipsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
    private readonly pdfService: PayslipPdfService,
  ) {}

  /**
   * 給与明細一覧取得
   */
  async list(
    tenantId: string,
    userId: string,
    query: PayslipListQuery,
  ): Promise<{ payslips: PayslipDto[]; pagination: PaginationMeta }> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.checkPermission(client, tenantId, userId, 'payslip.view');

      // ユーザーのロールと紐づく従業員IDの確認 (employee ロールは自身の明細のみ閲覧可能)
      const empFilter = await this.resolveEmployeeRestriction(client, tenantId, userId);

      const conditions: string[] = ['p.tenant_id = $1'];
      const values: unknown[] = [tenantId];
      let paramIdx = 2;

      if (empFilter) {
        conditions.push(`p.employee_id = $${paramIdx++}`);
        values.push(empFilter);
      } else if (query.employee_id) {
        conditions.push(`p.employee_id = $${paramIdx++}`);
        values.push(query.employee_id);
      }

      if (query.payroll_period) {
        conditions.push(`p.payroll_period = $${paramIdx++}`);
        values.push(query.payroll_period);
      }

      if (query.status) {
        conditions.push(`p.status = $${paramIdx++}`);
        values.push(query.status);
      }

      const whereClause = conditions.join(' AND ');

      const countResult = await client.query<{ total: string }>(
        `SELECT COUNT(*) AS total
         FROM payslips p
         WHERE ${whereClause}`,
        values,
      );
      const totalCount = parseInt(countResult.rows[0]?.total ?? '0', 10);

      const offset = (query.page - 1) * query.page_size;
      const listValues = [...values, query.page_size, offset];

      const listResult = await client.query<PayslipRow>(
        `SELECT ${PAYSLIP_COLUMNS}
         FROM payslips p
         JOIN employees e ON e.id = p.employee_id
         LEFT JOIN departments d ON d.id = e.department_id
         WHERE ${whereClause}
         ORDER BY p.payroll_period DESC, e.employee_code ASC
         LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        listValues,
      );

      const payslips = listResult.rows.map(mapPayslipRow);
      return {
        payslips,
        pagination: buildPagination(query.page, query.page_size, totalCount),
      };
    });
  }

  /**
   * 給与明細詳細取得
   */
  async findById(tenantId: string, userId: string, id: string): Promise<PayslipDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.checkPermission(client, tenantId, userId, 'payslip.view');

      const empFilter = await this.resolveEmployeeRestriction(client, tenantId, userId);

      const result = await client.query<PayslipRow>(
        `SELECT ${PAYSLIP_COLUMNS}
         FROM payslips p
         JOIN employees e ON e.id = p.employee_id
         LEFT JOIN departments d ON d.id = e.department_id
         WHERE p.tenant_id = $1 AND p.id = $2`,
        [tenantId, id],
      );

      if (result.rowCount === 0) {
        throw AppException.notFound('指定された給与明細が見つかりません');
      }

      const payslip = mapPayslipRow(result.rows[0]);
      if (empFilter && payslip.employee_id !== empFilter) {
        throw AppException.forbidden('他の従業員の給与明細を閲覧する権限がありません');
      }

      return payslip;
    });
  }

  /**
   * 確定給与計算から給与明細を発行 (draft または confirmed)
   */
  async create(tenantId: string, userId: string, dto: PayslipCreateInput): Promise<PayslipDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.checkPermission(client, tenantId, userId, 'payslip.create');

      // 1. 給与計算および従業員情報の取得
      const calcResult = await client.query<{
        id: string;
        tenant_id: string;
        employee_id: string;
        payroll_period_id: string;
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
        status: string;
        employee_code: string;
        employee_name: string;
        department_name: string | null;
        period_name: string;
        payment_date: Date;
      }>(
        `SELECT
           c.*,
           e.employee_code,
           e.name AS employee_name,
           d.name AS department_name,
           pp.name AS period_name,
           pp.payment_date
         FROM payroll_calculations c
         JOIN employees e ON e.id = c.employee_id
         LEFT JOIN departments d ON d.id = e.department_id
         JOIN payroll_periods pp ON pp.id = c.payroll_period_id
         WHERE c.tenant_id = $1 AND c.id = $2`,
        [tenantId, dto.payroll_calculation_id],
      );

      if (calcResult.rowCount === 0) {
        throw AppException.notFound('指定された給与計算レコードが見つかりません');
      }

      const calc = calcResult.rows[0];

      // confirmedで発行する場合、給与計算レコードがactive確定済みであることを検証
      if (dto.status === 'confirmed' && calc.status !== 'active') {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          `未確定の給与計算(status: ${calc.status})から給与明細を確定発行することはできません。給与計算を承認・確定(active)してください。`,
        );
      }

      // 重複チェック
      const existing = await client.query(
        `SELECT id FROM payslips WHERE tenant_id = $1 AND payroll_calculation_id = $2`,
        [tenantId, calc.id],
      );
      if ((existing.rowCount ?? 0) > 0) {
        throw AppException.conflict('ALREADY_EXISTS', 'この給与計算に対する給与明細は既に発行されています');
      }

      // スナップショット作成
      const snapshot: PayslipSnapshotData = {
        employee: {
          id: calc.employee_id,
          employee_code: calc.employee_code,
          name: calc.employee_name,
          department_name: calc.department_name,
        },
        attendance: {
          regular_hours: Number(calc.regular_hours),
          overtime_hours: Number(calc.overtime_hours),
          late_night_hours: Number(calc.late_night_hours),
          holiday_hours: Number(calc.holiday_hours),
        },
        earnings: {
          salary_type: calc.salary_type,
          base_salary: Number(calc.base_salary),
          hourly_wage: Number(calc.hourly_wage),
          regular_pay: Number(calc.regular_pay),
          overtime_pay: Number(calc.overtime_pay),
          late_night_pay: Number(calc.late_night_pay),
          holiday_pay: Number(calc.holiday_pay),
          total_gross_pay: Number(calc.total_gross_pay),
        },
        deductions: {
          health_insurance_amount: Number(calc.health_insurance_amount),
          care_insurance_amount: Number(calc.care_insurance_amount),
          pension_amount: Number(calc.pension_amount),
          employment_insurance_amount: Number(calc.employment_insurance_amount),
          income_tax_amount: Number(calc.income_tax_amount),
          resident_tax_amount: Number(calc.resident_tax_amount),
          total_deductions: Number(calc.total_deductions),
        },
        net_pay: Number(calc.net_pay),
      };

      const issuedAt = dto.status === 'confirmed' ? new Date() : null;

      const insertResult = await client.query<PayslipRow>(
        `INSERT INTO payslips (
           tenant_id, payroll_calculation_id, employee_id, payroll_period,
           payment_date, snapshot_data, status, issued_at, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${PAYSLIP_COLUMNS}`,
        [
          tenantId,
          calc.id,
          calc.employee_id,
          calc.period_name,
          calc.payment_date,
          JSON.stringify(snapshot),
          dto.status,
          issuedAt,
          userId,
        ],
      );

      const payslip = mapPayslipRow(insertResult.rows[0]);

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'payslip.created',
        targetType: 'payslip',
        targetId: payslip.id,
        afterData: {
          employee_id: payslip.employee_id,
          payroll_period: payslip.payroll_period,
          status: payslip.status,
          net_pay: snapshot.net_pay,
        },
      });

      return payslip;
    });
  }

  /**
   * draft状態の明細を確定(confirmed)に移行
   */
  async confirm(tenantId: string, userId: string, id: string): Promise<PayslipDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.checkPermission(client, tenantId, userId, 'payslip.create');

      const current = await client.query<{ status: string; calc_status: string }>(
        `SELECT p.status, c.status AS calc_status
         FROM payslips p
         JOIN payroll_calculations c ON c.id = p.payroll_calculation_id
         WHERE p.tenant_id = $1 AND p.id = $2`,
        [tenantId, id],
      );

      if (current.rowCount === 0) {
        throw AppException.notFound('指定された給与明細が見つかりません');
      }

      if (current.rows[0].status === 'confirmed') {
        throw AppException.conflict('INVALID_STATE_TRANSITION', 'この給与明細は既に確定発行されています');
      }

      if (current.rows[0].calc_status !== 'active') {
        throw AppException.conflict(
          'INVALID_STATE_TRANSITION',
          '給与計算レコードが確定(active)していないため、給与明細を確定できません',
        );
      }

      const updateResult = await client.query<PayslipRow>(
        `UPDATE payslips
         SET status = 'confirmed', issued_at = now(), updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING ${PAYSLIP_COLUMNS}`,
        [tenantId, id],
      );

      const payslip = mapPayslipRow(updateResult.rows[0]);

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'payslip.confirmed',
        targetType: 'payslip',
        targetId: payslip.id,
        afterData: { status: 'confirmed', issued_at: payslip.issued_at },
      });

      return payslip;
    });
  }

  /**
   * 給与明細PDFを生成して返却
   */
  async getPdf(tenantId: string, userId: string, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const payslip = await this.findById(tenantId, userId, id);
    const buffer = await this.pdfService.generatePdf(payslip);
    const filename = `payslip_${payslip.payroll_period}_${payslip.employee_code || payslip.employee_id.slice(0, 8)}.pdf`;
    return { buffer, filename };
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

    // 一般従業員の場合、users.email と一致する employees を検索
    const empRes = await client.query<{ id: string }>(
      `SELECT e.id
       FROM employees e
       JOIN users u ON u.email = e.email
       WHERE e.tenant_id = $1 AND u.id = $2
       LIMIT 1`,
      [tenantId, userId],
    );

    if (empRes.rowCount === 0) {
      // 紐づく従業員がいない場合はダミーUUIDでヒット0にする
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

