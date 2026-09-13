import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { acquireAdvisoryLock } from '../../common/database/advisory-lock';
import type {
  AttendanceListQuery,
  AttendanceRecordCreateInput,
  AttendanceRecordUpdateInput,
  ClockActionInput,
} from './dto/attendance.schemas';
import {
  mapAttendanceRecordRow,
  type AttendanceRecordDto,
  type AttendanceRecordRow,
} from './attendance.mapper';
import {
  calculateWorkingHours,
  calculateWeeklyWorkHours,
  type DailyWorkRecordForAggregation,
} from './utils/work-hours-calculator';

export interface AttendanceListResult {
  records: AttendanceRecordDto[];
  pagination: PaginationMeta;
}

function toDateString(d: string | Date): string {
  if (d instanceof Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return String(d).split('T')[0]!;
}

/**
 * 与えられた日付文字列（YYYY-MM-DD）が含まれる暦週（日曜日〜土曜日）の開始日と終了日を取得
 */
function getWeekRange(workDateStr: string): { weekStart: string; weekEnd: string } {
  const parts = toDateString(workDateStr).split('-').map(Number);
  const d = new Date(parts[0]!, parts[1]! - 1, parts[2]!);
  const dayOfWeek = d.getDay(); // 0: 日曜, 1: 月曜, ..., 6: 土曜

  const start = new Date(d);
  start.setDate(d.getDate() - dayOfWeek);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  return { weekStart: toDateString(start), weekEnd: toDateString(end) };
}

/**
 * 同一テナント・同一従業員・同一暦週に対する並行操作を直列化するアドバイザリロックキー
 * 他のキー空間（supplier:, purchase_request_no: 等）と衝突しないよう attendance_week: プレフィックスを付与
 */
function getAttendanceWeekLockKey(tenantId: string, employeeId: string, workDateStr: string): string {
  const { weekStart } = getWeekRange(workDateStr);
  return `attendance_week:${tenantId}:${employeeId}:${weekStart}`;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * DB層/Service層での二重RBAC認可チェックヘルパー (DEBT-005パターン)
   */
  private async assertUserPermission(
    client: PoolClient,
    tenantId: string,
    userId: string | null,
    permissionCode: string,
  ): Promise<void> {
    if (!userId) {
      throw AppException.unauthorized('ユーザー認証が必要です');
    }
    const permCheck = await client.query(
      `SELECT 1
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.tenant_id = $1 AND ur.user_id = $2
         AND p.code = $3
       LIMIT 1`,
      [tenantId, userId, permissionCode],
    );
    if ((permCheck.rowCount ?? 0) === 0) {
      throw AppException.forbidden(`この操作を行う権限(${permissionCode})がありません`);
    }
  }

  /**
   * 操作者が勤怠管理者ロール（owner, payroll_admin）を所持しているか判定
   * 勤怠の打刻代行・手動登録・編集などの管理者操作を行う権限
   */
  private async isAttendanceManager(
    client: PoolClient,
    tenantId: string,
    userId: string | null,
  ): Promise<boolean> {
    if (!userId) return false;
    const managerCheck = await client.query(
      `SELECT 1
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.tenant_id = $1 AND ur.user_id = $2
         AND r.code::text IN ('owner', 'payroll_admin')
       LIMIT 1`,
      [tenantId, userId],
    );
    return (managerCheck.rowCount ?? 0) > 0;
  }

  /**
   * 操作者が全従業員の勤怠閲覧権限ロール（owner, payroll_admin, accounting_manager, approver）を所持しているか判定
   * accounting_manager / approver は閲覧専用管理者としてテナント内の全勤怠を閲覧可能
   */
  private async canViewAllAttendance(
    client: PoolClient,
    tenantId: string,
    userId: string | null,
  ): Promise<boolean> {
    if (!userId) return false;
    const viewerCheck = await client.query(
      `SELECT 1
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.tenant_id = $1 AND ur.user_id = $2
         AND r.code::text IN ('owner', 'payroll_admin', 'accounting_manager', 'approver')
       LIMIT 1`,
      [tenantId, userId],
    );
    return (viewerCheck.rowCount ?? 0) > 0;
  }

  /**
   * 勤怠操作（打刻・作成・更新）における Object-level Authorization チェック
   * 勤怠管理者（owner, payroll_admin）または対象従業員本人のみ許可
   */
  private async assertEmployeeManageAccess(
    client: PoolClient,
    tenantId: string,
    userId: string | null,
    targetEmployeeId: string,
  ): Promise<void> {
    if (!userId) {
      throw AppException.unauthorized('ユーザー認証が必要です');
    }

    if (await this.isAttendanceManager(client, tenantId, userId)) {
      return;
    }

    const selfEmpRes = await client.query<{ id: string }>(
      `SELECT id FROM employees WHERE tenant_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`,
      [tenantId, userId],
    );
    const selfEmp = selfEmpRes.rows[0];

    if (!selfEmp || selfEmp.id !== targetEmployeeId) {
      throw AppException.forbidden('他人の勤怠データに対する操作・編集は許可されていません');
    }
  }

  /**
   * 勤怠閲覧（詳細取得）における Object-level Authorization チェック
   * 閲覧権限ロール（owner, payroll_admin, accounting_manager, approver）または対象従業員本人のみ許可
   */
  private async assertEmployeeViewAccess(
    client: PoolClient,
    tenantId: string,
    userId: string | null,
    targetEmployeeId: string,
  ): Promise<void> {
    if (!userId) {
      throw AppException.unauthorized('ユーザー認証が必要です');
    }

    if (await this.canViewAllAttendance(client, tenantId, userId)) {
      return;
    }

    const selfEmpRes = await client.query<{ id: string }>(
      `SELECT id FROM employees WHERE tenant_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`,
      [tenantId, userId],
    );
    const selfEmp = selfEmpRes.rows[0];

    if (!selfEmp || selfEmp.id !== targetEmployeeId) {
      throw AppException.forbidden('他人の勤怠データに対する閲覧は許可されていません');
    }
  }

  /**
   * 当該週（日〜土）の勤怠レコードに対して週40時間超過を再計算し、DBの各レコードに反映 (労基法第32条第1項準拠)
   */
  private async recalculateWeeklyWorkHours(
    client: PoolClient,
    tenantId: string,
    employeeId: string,
    workDate: string,
  ): Promise<void> {
    const { weekStart, weekEnd } = getWeekRange(workDate);

    // 週単位のアドバイザリロックを取得して同一従業員・同一週の並行変更を直列化 (BLOCKER-01対応)
    await acquireAdvisoryLock(client, getAttendanceWeekLockKey(tenantId, employeeId, workDate));

    // 当該週の退勤済みレコードを全件取得 (FOR UPDATE)
    const recordsRes = await client.query<AttendanceRecordRow>(
      `SELECT * FROM attendance_records
       WHERE tenant_id = $1 AND employee_id = $2
         AND work_date >= $3 AND work_date <= $4
         AND clock_in IS NOT NULL AND clock_out IS NOT NULL
       ORDER BY work_date ASC
       FOR UPDATE`,
      [tenantId, employeeId, weekStart, weekEnd],
    );

    if (recordsRes.rows.length === 0) {
      return;
    }

    const dailyInputs: DailyWorkRecordForAggregation[] = recordsRes.rows.map((row) => ({
      workDate: toDateString(row.work_date),
      clockIn: row.clock_in,
      clockOut: row.clock_out,
      breakMinutes: row.break_minutes,
      isHoliday: row.is_holiday,
    }));

    const weeklyResult = calculateWeeklyWorkHours(dailyInputs);

    // 再計算された各日の regularHours, overtimeHours をDBに一括UPDATE
    for (const dayRes of weeklyResult.records) {
      await client.query(
        `UPDATE attendance_records
         SET regular_hours = $1,
             overtime_hours = $2,
             updated_at = now()
         WHERE tenant_id = $3 AND employee_id = $4 AND work_date = $5`,
        [dayRes.regularHours, dayRes.overtimeHours, tenantId, employeeId, dayRes.workDate],
      );
    }
  }

  /**
   * 打刻処理 (出勤 / 退勤)
   * 退勤時に労働時間区分（所定内・時間外・深夜・休日）を自動算出
   */
  async clock(
    tenantId: string,
    userId: string | null,
    input: ClockActionInput,
  ): Promise<AttendanceRecordDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'attendance.create');
      await this.assertEmployeeManageAccess(client, tenantId, userId, input.employee_id);

      const now = input.timestamp ? new Date(input.timestamp) : new Date();
      // YYYY-MM-DD 形式の日付を取得
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const workDate = `${year}-${month}-${day}`;

      // 週単位のアドバイザリロックを取得して同一従業員・同一週の並行操作を直列化 (BLOCKER-01対応)
      await acquireAdvisoryLock(client, getAttendanceWeekLockKey(tenantId, input.employee_id, workDate));

      // 従業員の存在とactiveステータスを確認
      const empRes = await client.query<{ id: string; name: string; employee_no: string }>(
        `SELECT id, name, employee_no FROM employees WHERE tenant_id = $1 AND id = $2 AND status = 'active'`,
        [tenantId, input.employee_id],
      );
      const emp = empRes.rows[0];
      if (!emp) {
        throw AppException.notFound('指定された有効な従業員が見つかりません');
      }

      // 同日レコードの検索 (悲観的ロック FOR UPDATE)
      const existingRes = await client.query<AttendanceRecordRow>(
        `SELECT a.*, e.employee_no, e.name AS employee_name
         FROM attendance_records a
         JOIN employees e ON e.id = a.employee_id
         WHERE a.tenant_id = $1 AND a.employee_id = $2 AND a.work_date = $3
         FOR UPDATE`,
        [tenantId, input.employee_id, workDate],
      );
      const existing = existingRes.rows[0];

      if (input.type === 'clock_in') {
        if (existing?.clock_in) {
          throw AppException.badRequest('本日は既に出勤打刻が記録されています');
        }

        if (existing) {
          // 既存レコードがあれば clock_in を更新
          const updateRes = await client.query<AttendanceRecordRow>(
            `UPDATE attendance_records
             SET clock_in = $1,
                 break_minutes = COALESCE($2, break_minutes),
                 is_holiday = COALESCE($3, is_holiday),
                 note = COALESCE($4, note),
                 updated_at = now()
             WHERE id = $5
             RETURNING *`,
            [now, input.break_minutes ?? 0, input.is_holiday ?? false, input.note ?? null, existing.id],
          );
          const updated = updateRes.rows[0]!;
          updated.employee_name = emp.name;
          updated.employee_no = emp.employee_no;
          return mapAttendanceRecordRow(updated);
        } else {
          // 新規作成
          const insertRes = await client.query<AttendanceRecordRow>(
            `INSERT INTO attendance_records (
               tenant_id, employee_id, work_date, clock_in,
               break_minutes, is_holiday, note, status
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft')
             RETURNING *`,
            [
              tenantId,
              input.employee_id,
              workDate,
              now,
              input.break_minutes ?? 0,
              input.is_holiday ?? false,
              input.note ?? null,
            ],
          );
          const created = insertRes.rows[0]!;
          created.employee_name = emp.name;
          created.employee_no = emp.employee_no;

          await this.auditLogs.record(client, tenantId, {
            actorUserId: userId,
            action: 'attendance.clock_in',
            targetType: 'attendance_record',
            targetId: created.id,
            afterData: {
              employee_id: created.employee_id,
              work_date: created.work_date,
              clock_in: created.clock_in,
            },
          });

          return mapAttendanceRecordRow(created);
        }
      } else {
        // 退勤打刻 (clock_out)
        if (!existing || !existing.clock_in) {
          throw AppException.badRequest('出勤打刻が記録されていません');
        }
        if (existing.clock_out) {
          throw AppException.badRequest('本日は既に退勤打刻が記録されています');
        }

        const clockInDate = new Date(existing.clock_in);
        const clockOutDate = now;
        const breakMinutes = input.break_minutes ?? existing.break_minutes ?? 0;
        const isHoliday = input.is_holiday ?? existing.is_holiday ?? false;

        // 労働時間区分計算
        const calc = calculateWorkingHours({
          clockIn: clockInDate,
          clockOut: clockOutDate,
          breakMinutes,
          isHoliday,
        });

        const updateRes = await client.query<AttendanceRecordRow>(
          `UPDATE attendance_records
           SET clock_out = $1,
               break_minutes = $2,
               regular_hours = $3,
               overtime_hours = $4,
               late_night_hours = $5,
               holiday_hours = $6,
               is_holiday = $7,
               note = COALESCE($8, note),
               updated_at = now()
           WHERE id = $9
           RETURNING *`,
          [
            clockOutDate,
            breakMinutes,
            calc.regularHours,
            calc.overtimeHours,
            calc.lateNightHours,
            calc.holidayHours,
            isHoliday,
            input.note ?? null,
            existing.id,
          ],
        );

        const updated = updateRes.rows[0]!;
        updated.employee_name = emp.name;
        updated.employee_no = emp.employee_no;

        await this.auditLogs.record(client, tenantId, {
          actorUserId: userId,
          action: 'attendance.clock_out',
          targetType: 'attendance_record',
          targetId: updated.id,
          beforeData: {
            clock_in: existing.clock_in,
            clock_out: null,
          },
          afterData: {
            clock_in: updated.clock_in,
            clock_out: updated.clock_out,
            regular_hours: updated.regular_hours,
            overtime_hours: updated.overtime_hours,
          },
        });

        // 週40時間を超える時間外を当該週のレコード群に反映
        await this.recalculateWeeklyWorkHours(client, tenantId, input.employee_id, workDate);

        const reloadedRes = await client.query<AttendanceRecordRow>(
          `SELECT a.*, e.employee_no, e.name AS employee_name
           FROM attendance_records a
           JOIN employees e ON e.id = a.employee_id
           WHERE a.id = $1`,
          [updated.id],
        );

        return mapAttendanceRecordRow(reloadedRes.rows[0] ?? updated);
      }
    });
  }

  /**
   * 手動登録 (管理者/従業員による申請・代理登録)
   */
  async createRecord(
    tenantId: string,
    userId: string | null,
    input: AttendanceRecordCreateInput,
  ): Promise<AttendanceRecordDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'attendance.create');
      await this.assertEmployeeManageAccess(client, tenantId, userId, input.employee_id);

      // 週単位のアドバイザリロックを取得して同一従業員・同一週の並行登録を直列化 (BLOCKER-01対応)
      await acquireAdvisoryLock(
        client,
        getAttendanceWeekLockKey(tenantId, input.employee_id, input.work_date),
      );

      // 従業員確認
      const empRes = await client.query<{ id: string; name: string; employee_no: string }>(
        `SELECT id, name, employee_no FROM employees WHERE tenant_id = $1 AND id = $2 AND status = 'active'`,
        [tenantId, input.employee_id],
      );
      const emp = empRes.rows[0];
      if (!emp) {
        throw AppException.notFound('指定された有効な従業員が見つかりません');
      }

      // 重複チェック
      const dupCheck = await client.query(
        `SELECT id FROM attendance_records WHERE tenant_id = $1 AND employee_id = $2 AND work_date = $3 LIMIT 1`,
        [tenantId, input.employee_id, input.work_date],
      );
      if ((dupCheck.rowCount ?? 0) > 0) {
        throw AppException.badRequest(`該当日の勤怠記録は既に存在します`);
      }

      // 労働時間区分計算
      const calc = calculateWorkingHours({
        clockIn: input.clock_in,
        clockOut: input.clock_out,
        breakMinutes: input.break_minutes,
        isHoliday: input.is_holiday,
      });

      const insertRes = await client.query<AttendanceRecordRow>(
        `INSERT INTO attendance_records (
           tenant_id, employee_id, work_date, clock_in, clock_out,
           break_minutes, regular_hours, overtime_hours, late_night_hours,
           holiday_hours, is_holiday, note, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          tenantId,
          input.employee_id,
          input.work_date,
          input.clock_in ?? null,
          input.clock_out ?? null,
          input.break_minutes ?? 0,
          calc.regularHours,
          calc.overtimeHours,
          calc.lateNightHours,
          calc.holidayHours,
          input.is_holiday ?? false,
          input.note ?? null,
          input.status ?? 'draft',
        ],
      );

      const created = insertRes.rows[0]!;
      created.employee_name = emp.name;
      created.employee_no = emp.employee_no;

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'attendance.created',
        targetType: 'attendance_record',
        targetId: created.id,
        afterData: {
          employee_id: created.employee_id,
          work_date: created.work_date,
        },
      });

      // 勤怠レコード作成時は未退勤・退勤済みを問わず常にその週を再計算する (BLOCKER-02対応)
      await this.recalculateWeeklyWorkHours(client, tenantId, input.employee_id, input.work_date);

      const reloadedRes = await client.query<AttendanceRecordRow>(
        `SELECT a.*, e.employee_no, e.name AS employee_name
         FROM attendance_records a
         JOIN employees e ON e.id = a.employee_id
         WHERE a.id = $1`,
        [created.id],
      );

      return mapAttendanceRecordRow(reloadedRes.rows[0] ?? created);
    });
  }

  /**
   * 勤怠レコード手動更新
   */
  async updateRecord(
    tenantId: string,
    userId: string | null,
    id: string,
    input: AttendanceRecordUpdateInput,
  ): Promise<AttendanceRecordDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'attendance.edit');

      // ① 対象レコードの特定（※ここではFOR UPDATEを取得しない！Advisory Lock取得前の行ロックを防ぎデッドロックを防止 - FIX3対応）
      const checkRes = await client.query<AttendanceRecordRow>(
        `SELECT a.*, e.employee_no, e.name AS employee_name
         FROM attendance_records a
         JOIN employees e ON e.id = a.employee_id
         WHERE a.tenant_id = $1 AND a.id = $2`,
        [tenantId, id],
      );
      const targetRecord = checkRes.rows[0];
      if (!targetRecord) {
        throw AppException.notFound('指定された勤怠記録が見つかりません');
      }

      await this.assertEmployeeManageAccess(client, tenantId, userId, targetRecord.employee_id);

      // ② 週単位のアドバイザリロックを取得（行ロックより先にAdvisory Lockを取得して循環待ちを防止）
      await acquireAdvisoryLock(
        client,
        getAttendanceWeekLockKey(tenantId, targetRecord.employee_id, toDateString(targetRecord.work_date)),
      );

      // ③ Advisory Lock取得後に対象行を FOR UPDATE でロック＆最新状態を取得
      const existingRes = await client.query<AttendanceRecordRow>(
        `SELECT a.*, e.employee_no, e.name AS employee_name
         FROM attendance_records a
         JOIN employees e ON e.id = a.employee_id
         WHERE a.tenant_id = $1 AND a.id = $2
         FOR UPDATE`,
        [tenantId, id],
      );
      const existing = existingRes.rows[0];
      if (!existing) {
        throw AppException.notFound('指定された勤怠記録が見つかりません');
      }

      const clockIn = input.clock_in !== undefined ? input.clock_in : existing.clock_in;
      const clockOut = input.clock_out !== undefined ? input.clock_out : existing.clock_out;
      const breakMinutes = input.break_minutes !== undefined ? input.break_minutes : existing.break_minutes;
      const isHoliday = input.is_holiday !== undefined ? input.is_holiday : existing.is_holiday;

      const calc = calculateWorkingHours({
        clockIn,
        clockOut,
        breakMinutes,
        isHoliday,
      });

      const sets: string[] = [
        'clock_in = $3',
        'clock_out = $4',
        'break_minutes = $5',
        'regular_hours = $6',
        'overtime_hours = $7',
        'late_night_hours = $8',
        'holiday_hours = $9',
        'is_holiday = $10',
        'updated_at = now()',
      ];
      const params: unknown[] = [
        tenantId,
        id,
        clockIn ?? null,
        clockOut ?? null,
        breakMinutes ?? 0,
        calc.regularHours,
        calc.overtimeHours,
        calc.lateNightHours,
        calc.holidayHours,
        isHoliday ?? false,
      ];

      if (input.note !== undefined) {
        params.push(input.note);
        sets.push(`note = $${params.length}`);
      }
      if (input.status !== undefined) {
        params.push(input.status);
        sets.push(`status = $${params.length}`);
      }

      const updateRes = await client.query<AttendanceRecordRow>(
        `UPDATE attendance_records
         SET ${sets.join(', ')}
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        params,
      );

      const updated = updateRes.rows[0]!;
      updated.employee_name = existing.employee_name;
      updated.employee_no = existing.employee_no;

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'attendance.updated',
        targetType: 'attendance_record',
        targetId: updated.id,
        beforeData: {
          regular_hours: existing.regular_hours,
          overtime_hours: existing.overtime_hours,
        },
        afterData: {
          regular_hours: updated.regular_hours,
          overtime_hours: updated.overtime_hours,
        },
      });

      // 勤怠レコードに変更が加えられたら、未退勤化・退勤済みを問わず常にその週を再計算する (BLOCKER-02対応)
      await this.recalculateWeeklyWorkHours(client, tenantId, existing.employee_id, toDateString(existing.work_date));

      const reloadedRes = await client.query<AttendanceRecordRow>(
        `SELECT a.*, e.employee_no, e.name AS employee_name
         FROM attendance_records a
         JOIN employees e ON e.id = a.employee_id
         WHERE a.id = $1`,
        [updated.id],
      );

      return mapAttendanceRecordRow(reloadedRes.rows[0] ?? updated);
    });
  }

  /**
   * 勤怠レコード一覧取得
   */
  async list(
    tenantId: string,
    userId: string | null,
    query: AttendanceListQuery,
  ): Promise<AttendanceListResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'attendance.view');

      const canViewAll = await this.canViewAllAttendance(client, tenantId, userId);
      let targetEmployeeId = query.employee_id;

      if (!canViewAll) {
        const selfEmpRes = await client.query<{ id: string }>(
          `SELECT id FROM employees WHERE tenant_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`,
          [tenantId, userId],
        );
        const selfEmp = selfEmpRes.rows[0];
        if (!selfEmp) {
          throw AppException.forbidden('有効な従業員プロファイルが紐づいていません');
        }
        if (targetEmployeeId && targetEmployeeId !== selfEmp.id) {
          throw AppException.forbidden('他人の勤怠データに対する閲覧は許可されていません');
        }
        targetEmployeeId = selfEmp.id;
      }

      const conditions: string[] = ['a.tenant_id = $1'];
      const params: unknown[] = [tenantId];

      if (targetEmployeeId) {
        params.push(targetEmployeeId);
        conditions.push(`a.employee_id = $${params.length}`);
      }
      if (query.start_date) {
        params.push(query.start_date);
        conditions.push(`a.work_date >= $${params.length}`);
      }
      if (query.end_date) {
        params.push(query.end_date);
        conditions.push(`a.work_date <= $${params.length}`);
      }

      const whereClause = conditions.join(' AND ');

      const countRes = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM attendance_records a WHERE ${whereClause}`,
        params,
      );
      const totalCount = parseInt(countRes.rows[0]?.count ?? '0', 10);

      const page = query.page ?? 1;
      const limit = query.limit ?? 31;
      const offset = (page - 1) * limit;
      const dataParams = [...params, limit, offset];
      const dataRes = await client.query<AttendanceRecordRow>(
        `SELECT a.*, e.employee_no, e.name AS employee_name
         FROM attendance_records a
         JOIN employees e ON e.id = a.employee_id
         WHERE ${whereClause}
         ORDER BY a.work_date DESC, e.employee_no ASC
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams,
      );

      const records = dataRes.rows.map(mapAttendanceRecordRow);
      const pagination = buildPagination(page, limit, totalCount);

      return { records, pagination };
    });
  }

  /**
   * 勤怠レコード詳細取得
   */
  async getById(
    tenantId: string,
    userId: string | null,
    id: string,
  ): Promise<AttendanceRecordDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'attendance.view');

      const res = await client.query<AttendanceRecordRow>(
        `SELECT a.*, e.employee_no, e.name AS employee_name
         FROM attendance_records a
         JOIN employees e ON e.id = a.employee_id
         WHERE a.tenant_id = $1 AND a.id = $2
         LIMIT 1`,
        [tenantId, id],
      );

      const row = res.rows[0];
      if (!row) {
        throw AppException.notFound('指定された勤怠記録が見つかりません');
      }

      await this.assertEmployeeViewAccess(client, tenantId, userId, row.employee_id);

      return mapAttendanceRecordRow(row);
    });
  }
}
