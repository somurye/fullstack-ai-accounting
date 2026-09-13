/**
 * verify-employees-attendance-e2e.ts
 * ==================================
 * Phase 3 Task 1 (P3-T1): 従業員マスタ・勤怠管理 実DB E2E検証スクリプト
 *
 * 目的:
 *   Docker等の実PostgreSQL環境上で、P3-T1のすべての要件が正しく機能することを実証する。
 *   1. RBAC二重防御 (Controller層 / Service層での非認可ユーザー403拒否)
 *   2. テナント完全分離 (RLS: Tenant A と Tenant B の従業員・勤怠相互完全遮断)
 *   3. DBレベルの tenant 整合性トリガー (fail-closed: 他テナント従業員の勤怠拒否、inactive従業員の打刻拒否)
 *   4. 打刻・労働時間区分ロジックの境界値実測検証 (8時間ジャスト、22時ジャスト、深夜跨ぎ、法定休日労働)
 *   5. 集計クエリの EXPLAIN ANALYZE 実測パフォーマンス計測 (< 50ms) とインデックス適合性
 */

import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { DatabaseService } from '../database/database.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { EmployeesService } from '../modules/employees/employees.service';
import { AttendanceService } from '../modules/attendance/attendance.service';
import { calculateWeeklyWorkHours } from '../modules/attendance/utils/work-hours-calculator';
import { AppException } from '../common/exceptions/app.exception';

function expect(actual: any) {
  return {
    toBe(expected: any) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected}, but got ${actual}`);
      }
    },
    toEqual(expected: any) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}`);
      }
    },
    toBeGreaterThan(expected: number) {
      if (actual <= expected) {
        throw new Error(`Expected ${actual} > ${expected}`);
      }
    },
    toBeLessThan(expected: number) {
      if (actual >= expected) {
        throw new Error(`Expected ${actual} < ${expected}`);
      }
    },
    toContain(expected: string) {
      if (!String(actual).includes(expected)) {
        throw new Error(`Expected "${actual}" to contain "${expected}"`);
      }
    },
  };
}

async function run() {
  console.log('=== P3-T1 従業員マスタ・勤怠管理 実DB E2E検証開始 ===');

  const dsn =
    process.argv[2] ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/postgres';

  const pool = new Pool({ connectionString: dsn });

  try {
    process.env.DATABASE_URL = dsn;
    const dbService = new DatabaseService();
    const auditLogsService = new AuditLogsService(dbService);
    const employeesService = new EmployeesService(dbService, auditLogsService);
    const attendanceService = new AttendanceService(dbService, auditLogsService);

    // --------------------------------------------------------------------------
    // 1. テスト用テナント・ユーザー・従業員のセットアップ
    // --------------------------------------------------------------------------
    console.log('1. テスト用テナント・ユーザー・従業員のセットアップ...');
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const userA_Owner = randomUUID();
    const userA_Employee = randomUUID();
    const userA_NoPerm = randomUUID();
    const userB_Owner = randomUUID();
    const userA_PayrollAdmin = randomUUID();
    const userA_AccountingManager = randomUUID();

    const empA1 = randomUUID();
    const empA2_inactive = randomUUID();
    const empA3_other = randomUUID();
    const empB1 = randomUUID();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // テナント作成
      await client.query(
        `INSERT INTO tenants (id, name) VALUES ($1, 'HR Test Tenant A'), ($2, 'HR Test Tenant B')`,
        [tenantA, tenantB],
      );

      // ユーザー作成
      await client.query(
        `INSERT INTO users (id, email, password_hash, name) VALUES
         ($1, 'owner_a_${tenantA.slice(0, 8)}@example.com', 'hash', 'Owner A'),
         ($2, 'emp_a_${tenantA.slice(0, 8)}@example.com', 'hash', 'Employee A'),
         ($3, 'noperm_a_${tenantA.slice(0, 8)}@example.com', 'hash', 'No Perm A'),
         ($4, 'owner_b_${tenantB.slice(0, 8)}@example.com', 'hash', 'Owner B'),
         ($5, 'payroll_a_${tenantA.slice(0, 8)}@example.com', 'hash', 'Payroll Admin A'),
         ($6, 'acctmgr_a_${tenantA.slice(0, 8)}@example.com', 'hash', 'Acct Manager A')`,
        [userA_Owner, userA_Employee, userA_NoPerm, userB_Owner, userA_PayrollAdmin, userA_AccountingManager],
      );

      // tenant_users
      await client.query(
        `INSERT INTO tenant_users (tenant_id, user_id) VALUES
         ($1, $2), ($1, $3), ($1, $4), ($1, $5), ($1, $6), ($7, $8)`,
        [tenantA, userA_Owner, userA_Employee, userA_NoPerm, userA_PayrollAdmin, userA_AccountingManager, tenantB, userB_Owner],
      );

      // ロール割り当て
      // userA_Owner -> owner (全権限)
      // userA_Employee -> employee (本人限定権限)
      // userA_PayrollAdmin -> payroll_admin (勤怠管理者権限)
      // userA_AccountingManager -> accounting_manager (勤怠・従業員閲覧専用権限)
      // userA_NoPerm -> なし (権限なし)
      // userB_Owner -> owner (Tenant B)
      await client.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_id)
         SELECT $1::uuid, $2::uuid, id FROM roles WHERE code = 'owner'
         UNION ALL
         SELECT $1::uuid, $3::uuid, id FROM roles WHERE code = 'employee'
         UNION ALL
         SELECT $1::uuid, $4::uuid, id FROM roles WHERE code = 'payroll_admin'
         UNION ALL
         SELECT $1::uuid, $5::uuid, id FROM roles WHERE code = 'accounting_manager'
         UNION ALL
         SELECT $6::uuid, $7::uuid, id FROM roles WHERE code = 'owner'`,
        [tenantA, userA_Owner, userA_Employee, userA_PayrollAdmin, userA_AccountingManager, tenantB, userB_Owner],
      );

      // 従業員登録 (Tenant A: active 2名, inactive 1名)
      await client.query(
        `INSERT INTO employees (id, tenant_id, user_id, employee_no, name, hire_date, employment_type, status)
         VALUES
         ($1, $2, $3, 'EMP-A-001', '田中 太郎', '2026-04-01', 'full_time', 'active'),
         ($4, $2, NULL, 'EMP-A-002', '佐藤 花子 (退職)', '2025-01-01', 'part_time', 'inactive'),
         ($5, $2, NULL, 'EMP-A-003', '高橋 次郎 (同僚)', '2026-04-01', 'full_time', 'active')`,
        [empA1, tenantA, userA_Employee, empA2_inactive, empA3_other],
      );

      // 従業員登録 (Tenant B: active 1名)
      await client.query(
        `INSERT INTO employees (id, tenant_id, user_id, employee_no, name, hire_date, employment_type, status)
         VALUES
         ($1, $2, $3, 'EMP-B-001', '鈴木 一郎', '2026-04-01', 'full_time', 'active')`,
        [empB1, tenantB, userB_Owner],
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    console.log('  -> セットアップ完了');

    // --------------------------------------------------------------------------
    // 2. RBAC 二重認可検証 (Service層 assertUserPermission)
    // --------------------------------------------------------------------------
    console.log('2. RBAC 二重認可検証 (Service層 assertUserPermission)...');

    // 権限なしユーザーによる従業員登録の拒否 (403)
    let empCreateBlocked = false;
    try {
      await employeesService.create(tenantA, userA_NoPerm, {
        employee_no: 'EMP-A-999',
        name: '不正登録 太郎',
        hire_date: '2026-04-01',
        employment_type: 'full_time',
        status: 'active',
      });
    } catch (e: any) {
      if (e instanceof AppException && e.getStatus() === 403) {
        empCreateBlocked = true;
      }
    }
    expect(empCreateBlocked).toBe(true);
    console.log('  [PASS] Service層: employee.create 未保持ユーザーを403拒否 (二重防御)');

    // 権限なしユーザーによる勤怠打刻の拒否 (403)
    let clockBlocked = false;
    try {
      await attendanceService.clock(tenantA, userA_NoPerm, {
        employee_id: empA1,
        type: 'clock_in',
      });
    } catch (e: any) {
      if (e instanceof AppException && e.getStatus() === 403) {
        clockBlocked = true;
      }
    }
    expect(clockBlocked).toBe(true);
    console.log('  [PASS] Service層: attendance.create 未保持ユーザーを403拒否 (二重防御)');

    // --------------------------------------------------------------------------
    // 2.1 Object-level Authorization 実DB検証 (BLOCKER-02対応 & RBACロール定義整合性)
    // employeeロールのユーザーが他人のemployee_idを操作しようとすると5メソッド全てで403拒否されることを実証
    // --------------------------------------------------------------------------
    console.log('2.1 Object-level Authorization & RBAC定義整合性実DB検証 (BLOCKER-02 / ロール境界)...');

    // (1) clock: employeeが他人のemployee_idで打刻試行 -> 403
    let objClockBlocked = false;
    try {
      await attendanceService.clock(tenantA, userA_Employee, {
        employee_id: empA3_other,
        type: 'clock_in',
        timestamp: '2026-09-01T09:00:00+09:00',
      });
    } catch (e: any) {
      if (e instanceof AppException && e.getStatus() === 403) {
        objClockBlocked = true;
      }
    }
    expect(objClockBlocked).toBe(true);
    console.log('  [PASS] Object-Auth 1/5: clock() - employeeロールによる他人打刻を403拒否');

    // (2) createRecord: employeeが他人のemployee_idで勤怠作成試行 -> 403
    let objCreateBlocked = false;
    try {
      await attendanceService.createRecord(tenantA, userA_Employee, {
        employee_id: empA3_other,
        work_date: '2026-09-01',
        clock_in: '2026-09-01T09:00:00+09:00',
        clock_out: '2026-09-01T18:00:00+09:00',
      });
    } catch (e: any) {
      if (e instanceof AppException && e.getStatus() === 403) {
        objCreateBlocked = true;
      }
    }
    expect(objCreateBlocked).toBe(true);
    console.log('  [PASS] Object-Auth 2/5: createRecord() - employeeロールによる他人勤怠作成を403拒否');

    // 管理者(owner)により empA3_other の勤怠レコードを正常作成
    const otherRecord = await attendanceService.createRecord(tenantA, userA_Owner, {
      employee_id: empA3_other,
      work_date: '2026-09-01',
      clock_in: '2026-09-01T09:00:00+09:00',
      clock_out: '2026-09-01T18:00:00+09:00',
      break_minutes: 60,
    });
    expect(typeof otherRecord.id).toBe('string');

    // (3) updateRecord: employeeが他人の勤怠レコードを更新試行 -> 403
    let objUpdateBlocked = false;
    try {
      await attendanceService.updateRecord(tenantA, userA_Employee, otherRecord.id, {
        note: '不正更新試行',
      });
    } catch (e: any) {
      if (e instanceof AppException && e.getStatus() === 403) {
        objUpdateBlocked = true;
      }
    }
    expect(objUpdateBlocked).toBe(true);
    console.log('  [PASS] Object-Auth 3/5: updateRecord() - employeeロールによる他人勤怠更新を403拒否');

    // (4) getById: employeeが他人の勤怠レコードを取得試行 -> 403
    let objGetByIdBlocked = false;
    try {
      await attendanceService.getById(tenantA, userA_Employee, otherRecord.id);
    } catch (e: any) {
      if (e instanceof AppException && e.getStatus() === 403) {
        objGetByIdBlocked = true;
      }
    }
    expect(objGetByIdBlocked).toBe(true);
    console.log('  [PASS] Object-Auth 4/5: getById() - employeeロールによる他人勤怠詳細閲覧を403拒否');

    // (5) list: employeeが他人のemployee_idを指定して一覧取得試行 -> 403
    let objListBlocked = false;
    try {
      await attendanceService.list(tenantA, userA_Employee, {
        employee_id: empA3_other,
      });
    } catch (e: any) {
      if (e instanceof AppException && e.getStatus() === 403) {
        objListBlocked = true;
      }
    }
    expect(objListBlocked).toBe(true);
    console.log('  [PASS] Object-Auth 5/5: list() - employeeロールによる他人employee_id一覧取得を403拒否');

    // (補足検証1) list: employeeがemployee_id未指定の場合、自身のレコードのみにスコープ強制限定されることを実証
    const empSelfList = await attendanceService.list(tenantA, userA_Employee, {});
    for (const r of empSelfList.records) {
      expect(r.employee_id).toBe(empA1);
    }
    console.log('  [PASS] Object-Auth 補足1: list() - employeeロール未指定時は自動的に自身の勤怠のみに限定');

    // (補足検証2) 管理者ロール(owner, payroll_admin)は他人の勤怠レコードを正常に閲覧・更新できることを実証
    const ownerGetRes = await attendanceService.getById(tenantA, userA_Owner, otherRecord.id);
    expect(ownerGetRes.employee_id).toBe(empA3_other);
    const payrollAdminUpdateRes = await attendanceService.updateRecord(tenantA, userA_PayrollAdmin, otherRecord.id, {
      note: 'payroll_adminによる正当な更新',
    });
    expect(payrollAdminUpdateRes.note).toBe('payroll_adminによる正当な更新');
    console.log('  [PASS] 勤怠管理者ロール(owner, payroll_admin): テナント内の全従業員の勤怠を正常に閲覧・更新可能であることを実証');

    // (補足検証3) accounting_manager は閲覧専用管理者: 全従業員の勤怠閲覧(getById, list)は可能だが、作成・更新は403拒否
    const acctMgrGetRes = await attendanceService.getById(tenantA, userA_AccountingManager, otherRecord.id);
    expect(acctMgrGetRes.employee_id).toBe(empA3_other);
    const acctMgrListRes = await attendanceService.list(tenantA, userA_AccountingManager, { employee_id: empA3_other });
    expect(acctMgrListRes.records.length).toBeGreaterThan(0);

    let acctMgrCreateBlocked = false;
    try {
      await attendanceService.createRecord(tenantA, userA_AccountingManager, {
        employee_id: empA3_other,
        work_date: '2026-09-02',
        clock_in: '2026-09-02T09:00:00+09:00',
        clock_out: '2026-09-02T18:00:00+09:00',
      });
    } catch (e: any) {
      if (e instanceof AppException && e.getStatus() === 403) {
        acctMgrCreateBlocked = true;
      }
    }
    expect(acctMgrCreateBlocked).toBe(true);
    console.log('  [PASS] RBAC定義整合性: accounting_managerは閲覧専用(getById/list可、create/edit不可403)であることを実証');

    // --------------------------------------------------------------------------
    // 3. テナント完全分離実証 (RLS + テナント境界)
    // --------------------------------------------------------------------------
    console.log('3. テナント完全分離実証 (Tenant A vs Tenant B)...');

    const empListA = await employeesService.list(tenantA, userA_Owner, { limit: 50 });
    const empListB = await employeesService.list(tenantB, userB_Owner, { limit: 50 });

    // Tenant A に Tenant B の従業員が混入していないこと
    const empIdsA = empListA.employees.map((e) => e.id);
    expect(empIdsA.includes(empA1)).toBe(true);
    expect(empIdsA.includes(empA2_inactive)).toBe(true);
    expect(empIdsA.includes(empB1)).toBe(false);

    // Tenant B に Tenant A の従業員が混入していないこと
    const empIdsB = empListB.employees.map((e) => e.id);
    expect(empIdsB.includes(empB1)).toBe(true);
    expect(empIdsB.includes(empA1)).toBe(false);
    console.log('  [PASS] テナント完全分離: 従業員マスタがテナント間で相互に完全遮断されていることを実証');

    // --------------------------------------------------------------------------
    // 4. DB レベルの tenant 整合性トリガー検証 (fail-closed)
    // --------------------------------------------------------------------------
    console.log('4. DBレベルの tenant 整合性トリガー検証 (fail-closed)...');
    const triggerClient = await pool.connect();
    try {
      // 4.1 他テナントの従業員IDを指定した勤怠INSERTの拒否
      let foreignEmpBlocked = false;
      try {
        await triggerClient.query(
          `INSERT INTO attendance_records (tenant_id, employee_id, work_date, status)
           VALUES ($1, $2, '2026-09-01', 'draft')`,
          [tenantA, empB1], // Tenant A に Tenant B の従業員ID
        );
      } catch (e: any) {
        // ERRCODE 23503 または 23514
        if (e.code === '23503' || e.message.includes('does not belong to tenant')) {
          foreignEmpBlocked = true;
        }
      }
      expect(foreignEmpBlocked).toBe(true);
      console.log('  [PASS] DBトリガー: 他テナント従業員の勤怠登録をfail-closedで拒否');

      // 4.2 inactive な従業員への打刻・勤怠登録の拒否
      let inactiveEmpBlocked = false;
      try {
        await triggerClient.query(
          `INSERT INTO attendance_records (tenant_id, employee_id, work_date, status)
           VALUES ($1, $2, '2026-09-01', 'draft')`,
          [tenantA, empA2_inactive], // 退職済み従業員
        );
      } catch (e: any) {
        if (e.code === '23514' || e.message.includes('cannot record attendance for inactive employee')) {
          inactiveEmpBlocked = true;
        }
      }
      expect(inactiveEmpBlocked).toBe(true);
      console.log('  [PASS] DBトリガー: inactive従業員への勤怠登録をfail-closedで拒否');
    } finally {
      triggerClient.release();
    }

    // --------------------------------------------------------------------------
    // 5. 打刻・労働時間区分ロジックの境界値実DB検証
    // --------------------------------------------------------------------------
    console.log('5. 打刻・労働時間区分ロジックの境界値実DB検証...');

    // ケース1: ちょうど8時間 (09:00〜18:00, 休憩60分 = 実働8.00h)
    // -> regular=8.00, overtime=0.00, late_night=0.00, holiday=0.00
    const rec1 = await attendanceService.createRecord(tenantA, userA_Owner, {
      employee_id: empA1,
      work_date: '2026-09-10',
      clock_in: new Date(2026, 8, 10, 9, 0, 0).toISOString(),
      clock_out: new Date(2026, 8, 10, 18, 0, 0).toISOString(),
      break_minutes: 60,
      is_holiday: false,
    });
    expect(rec1.regular_hours).toBe(8.0);
    expect(rec1.overtime_hours).toBe(0.0);
    expect(rec1.late_night_hours).toBe(0.0);
    expect(rec1.holiday_hours).toBe(0.0);
    console.log('  [PASS] 境界値1: ちょうど8時間(480分) -> 所定内=8.00h, 時間外=0.00h (完全一致)');

    // ケース2: 8時間超残業 (09:00〜20:30, 休憩60分 = 実働10.50h)
    // -> regular=8.00, overtime=2.50, late_night=0.00, holiday=0.00
    const rec2 = await attendanceService.createRecord(tenantA, userA_Owner, {
      employee_id: empA1,
      work_date: '2026-09-11',
      clock_in: new Date(2026, 8, 11, 9, 0, 0).toISOString(),
      clock_out: new Date(2026, 8, 11, 20, 30, 0).toISOString(),
      break_minutes: 60,
      is_holiday: false,
    });
    expect(rec2.regular_hours).toBe(8.0);
    expect(rec2.overtime_hours).toBe(2.5);
    expect(rec2.late_night_hours).toBe(0.0);
    expect(rec2.holiday_hours).toBe(0.0);
    console.log('  [PASS] 境界値2: 8時間超残業(10.5h) -> 所定内=8.00h, 時間外=2.50h (完全一致)');

    // ケース3: 22時ちょうど退勤 (13:00〜22:00, 休憩60分 = 実働8.00h)
    // -> regular=8.00, overtime=0.00, late_night=0.00 (22時ちょうど境界値: 深夜ゼロ)
    const rec3 = await attendanceService.createRecord(tenantA, userA_Owner, {
      employee_id: empA1,
      work_date: '2026-09-12',
      clock_in: new Date(2026, 8, 12, 13, 0, 0).toISOString(),
      clock_out: new Date(2026, 8, 12, 22, 0, 0).toISOString(),
      break_minutes: 60,
      is_holiday: false,
    });
    expect(rec3.regular_hours).toBe(8.0);
    expect(rec3.overtime_hours).toBe(0.0);
    expect(rec3.late_night_hours).toBe(0.0); // 22:00境界値
    console.log('  [PASS] 境界値3: 22時ちょうど退勤 -> 所定内=8.00h, 深夜=0.00h (22:00境界値PASS)');

    // ケース4: 深夜残業 (13:00〜23:00, 休憩60分 = 実働9.00h)
    // -> regular=8.00, overtime=1.00, late_night=1.00 (22時〜23時の1時間)
    const rec4 = await attendanceService.createRecord(tenantA, userA_Owner, {
      employee_id: empA1,
      work_date: '2026-09-13',
      clock_in: new Date(2026, 8, 13, 13, 0, 0).toISOString(),
      clock_out: new Date(2026, 8, 13, 23, 0, 0).toISOString(),
      break_minutes: 60,
      is_holiday: false,
    });
    expect(rec4.regular_hours).toBe(8.0);
    expect(rec4.overtime_hours).toBe(1.0);
    expect(rec4.late_night_hours).toBe(1.0);
    console.log('  [PASS] 境界値4: 深夜残業(23:00退勤) -> 時間外=1.00h, 深夜=1.00h (完全一致)');

    // ケース5: 翌朝跨ぎ夜勤 (20:00〜翌05:00, 休憩60分 = 実働8.00h)
    // -> regular=8.00, overtime=0.00, late_night=7.00 (22:00〜翌05:00の7時間)
    const rec5 = await attendanceService.createRecord(tenantA, userA_Owner, {
      employee_id: empA1,
      work_date: '2026-09-14',
      clock_in: new Date(2026, 8, 14, 20, 0, 0).toISOString(),
      clock_out: new Date(2026, 8, 15, 5, 0, 0).toISOString(),
      break_minutes: 60,
      is_holiday: false,
    });
    expect(rec5.regular_hours).toBe(8.0);
    expect(rec5.overtime_hours).toBe(0.0);
    expect(rec5.late_night_hours).toBe(7.0);
    console.log('  [PASS] 境界値5: 翌朝05:00ちょうど退勤 -> 所定内=8.00h, 深夜=7.00h (日付跨ぎPASS)');

    // ケース6: 法定休日労働 (09:00〜18:00, 休憩60分, is_holiday=true)
    // -> regular=0.00, overtime=0.00, holiday=8.00, late_night=0.00
    const rec6 = await attendanceService.createRecord(tenantA, userA_Owner, {
      employee_id: empA1,
      work_date: '2026-09-15',
      clock_in: new Date(2026, 8, 15, 9, 0, 0).toISOString(),
      clock_out: new Date(2026, 8, 15, 18, 0, 0).toISOString(),
      break_minutes: 60,
      is_holiday: true,
    });
    expect(rec6.regular_hours).toBe(0.0);
    expect(rec6.overtime_hours).toBe(0.0);
    expect(rec6.holiday_hours).toBe(8.0);
    expect(rec6.late_night_hours).toBe(0.0);
    console.log('  [PASS] 境界値6: 法定休日労働 -> 休日労働=8.00h, 通常時間外=0.00h (完全一致)');

    // ケース7: 週40時間超過判定 (1日8h × 6日勤務 = 48h)
    // -> 日単位超過は各日0hだが、週単位で40hを超えた8hが「週時間外」として正確に集計されることを実証
    const weeklyTestDays = [
      { workDate: '2026-09-07', clockIn: '2026-09-07T09:00:00+09:00', clockOut: '2026-09-07T18:00:00+09:00', breakMinutes: 60 },
      { workDate: '2026-09-08', clockIn: '2026-09-08T09:00:00+09:00', clockOut: '2026-09-08T18:00:00+09:00', breakMinutes: 60 },
      { workDate: '2026-09-09', clockIn: '2026-09-09T09:00:00+09:00', clockOut: '2026-09-09T18:00:00+09:00', breakMinutes: 60 },
      { workDate: '2026-09-10', clockIn: '2026-09-10T09:00:00+09:00', clockOut: '2026-09-10T18:00:00+09:00', breakMinutes: 60 },
      { workDate: '2026-09-11', clockIn: '2026-09-11T09:00:00+09:00', clockOut: '2026-09-11T18:00:00+09:00', breakMinutes: 60 },
      { workDate: '2026-09-12', clockIn: '2026-09-12T09:00:00+09:00', clockOut: '2026-09-12T18:00:00+09:00', breakMinutes: 60 },
    ];
    const weeklyCalc = calculateWeeklyWorkHours(weeklyTestDays);
    expect(weeklyCalc.totalRegularHours).toBe(40.0);
    expect(weeklyCalc.totalDailyOvertimeHours).toBe(0.0);
    expect(weeklyCalc.totalWeeklyOvertimeHours).toBe(8.0);
    expect(weeklyCalc.totalOvertimeHours).toBe(8.0);
    expect(weeklyCalc.totalActualHours).toBe(48.0);
    console.log('  [PASS] 境界値7: 週40時間超過判定 (8h×6日=48h) -> 所定=40.00h, 週時間外=8.00h (労基法第32条完全準拠)');

    // ケース8: 実運用フローにおける週40時間超過の実DB反映検証 (BLOCKER-01対応)
    // 単体Calculatorではなく、AttendanceService.createRecord()を通した実運用フローで、
    // 同一暦週(月〜土)に6日分(各8h=計48h)の勤怠を順次登録。
    // 土曜日(6日目)の登録により、週40時間を超過した8hが時間外としてDBの当該レコードに保存され、
    // 週集計としても所定40.00h、時間外8.00hとなることを実DBで検証。
    console.log('  -> ケース8: 実運用フロー週40時間超過のDB保存値検証 (月〜土 6日分登録)...');
    const flowDates = [
      '2026-09-21', // 月
      '2026-09-22', // 火
      '2026-09-23', // 水
      '2026-09-24', // 木
      '2026-09-25', // 金
      '2026-09-26', // 土 (週40h超過日)
    ];

    let lastRecord: any;
    for (const d of flowDates) {
      lastRecord = await attendanceService.createRecord(tenantA, userA_Owner, {
        employee_id: empA1,
        work_date: d,
        clock_in: `${d}T09:00:00+09:00`,
        clock_out: `${d}T18:00:00+09:00`,
        break_minutes: 60, // 実働8.0h
        is_holiday: false,
      });
    }

    // 土曜日(6日目)の返却値検証: 当該日の所定は0h、8hすべてが週超過時間外となる
    expect(lastRecord.work_date).toBe('2026-09-26');
    expect(lastRecord.regular_hours).toBe(0.0);
    expect(lastRecord.overtime_hours).toBe(8.0);

    // 実DB(attendance_recordsテーブル)から直接SELECTして保存値を確認
    const checkDbClient = await pool.connect();
    try {
      const dbRowsRes = await checkDbClient.query<{
        work_date: string;
        regular_hours: string;
        overtime_hours: string;
      }>(
        `SELECT work_date::text, regular_hours::text, overtime_hours::text
         FROM attendance_records
         WHERE tenant_id = $1 AND employee_id = $2
           AND work_date >= '2026-09-21' AND work_date <= '2026-09-26'
         ORDER BY work_date ASC`,
        [tenantA, empA1],
      );

      expect(dbRowsRes.rows.length).toBe(6);
      // 月〜金: 所定8.00h, 時間外0.00h
      for (let i = 0; i < 5; i++) {
        expect(parseFloat(dbRowsRes.rows[i]!.regular_hours)).toBe(8.0);
        expect(parseFloat(dbRowsRes.rows[i]!.overtime_hours)).toBe(0.0);
      }
      // 土: 所定0.00h, 時間外8.00h (DB保存値)
      expect(parseFloat(dbRowsRes.rows[5]!.regular_hours)).toBe(0.0);
      expect(parseFloat(dbRowsRes.rows[5]!.overtime_hours)).toBe(8.0);

      // 週集計SUMクエリによる確認
      const sumRes = await checkDbClient.query<{ reg_sum: string; ot_sum: string }>(
        `SELECT SUM(regular_hours)::text as reg_sum, SUM(overtime_hours)::text as ot_sum
         FROM attendance_records
         WHERE tenant_id = $1 AND employee_id = $2
           AND work_date >= '2026-09-21' AND work_date <= '2026-09-26'`,
        [tenantA, empA1],
      );
      expect(parseFloat(sumRes.rows[0]!.reg_sum)).toBe(40.0);
      expect(parseFloat(sumRes.rows[0]!.ot_sum)).toBe(8.0);

      // (追加検証) updateRecord による週次自動再計算: 水曜日の勤務を1時間短縮(実働7h)に更新
      // -> 週合計47hとなり、土曜日のDB保存値が自動的に所定1.00h、時間外7.00hに再計算されることを実証
      const wedRecordRes = await checkDbClient.query<{ id: string }>(
        `SELECT id FROM attendance_records WHERE tenant_id = $1 AND employee_id = $2 AND work_date = '2026-09-23'`,
        [tenantA, empA1],
      );
      await attendanceService.updateRecord(tenantA, userA_Owner, wedRecordRes.rows[0]!.id, {
        clock_out: '2026-09-23T17:00:00+09:00', // 1時間短縮 (実働7h)
      });

      // 土曜日のレコードを再確認
      const satAfterUpdateRes = await checkDbClient.query<{ regular_hours: string; overtime_hours: string }>(
        `SELECT regular_hours::text, overtime_hours::text
         FROM attendance_records
         WHERE tenant_id = $1 AND employee_id = $2 AND work_date = '2026-09-26'`,
        [tenantA, empA1],
      );
      expect(parseFloat(satAfterUpdateRes.rows[0]!.regular_hours)).toBe(1.0);
      expect(parseFloat(satAfterUpdateRes.rows[0]!.overtime_hours)).toBe(7.0);
      console.log('  [PASS] 境界値8: 実運用フロー週40時間超過の実DB反映 & 更新時自動再計算 (所定40h/時間外8h -> 更新後所定40h/時間外7h) 完全一致');

      // (BLOCKER-02検証) 未退勤状態への修正(clock_out = null)による週次自動再計算の実証
      // 登録されている金曜日(2026-09-25)の勤怠を clock_out = null に更新
      // -> 金曜日自体の実働は0となり、週の確定実働が 月(8)+火(8)+水(7)+木(8)+土(8) の計39hに減少 (< 40h)
      // -> 土曜日(2026-09-26)の時間外が 0.00h、所定が 8.00h に再計算されてDBに保存されることを実証
      const friRecordRes = await checkDbClient.query<{ id: string }>(
        `SELECT id FROM attendance_records WHERE tenant_id = $1 AND employee_id = $2 AND work_date = '2026-09-25'`,
        [tenantA, empA1],
      );
      const updatedFri = await attendanceService.updateRecord(tenantA, userA_Owner, friRecordRes.rows[0]!.id, {
        clock_out: null,
      });
      expect(updatedFri.clock_out).toBe(null);
      expect(updatedFri.regular_hours).toBe(0.0);
      expect(updatedFri.overtime_hours).toBe(0.0);

      // 土曜日のレコードが自動再計算され、時間外0h・所定8hに戻っていることを実DBから確認
      const satAfterFriReset = await checkDbClient.query<{ regular_hours: string; overtime_hours: string }>(
        `SELECT regular_hours::text, overtime_hours::text
         FROM attendance_records
         WHERE tenant_id = $1 AND employee_id = $2 AND work_date = '2026-09-26'`,
        [tenantA, empA1],
      );
      expect(parseFloat(satAfterFriReset.rows[0]!.regular_hours)).toBe(8.0);
      expect(parseFloat(satAfterFriReset.rows[0]!.overtime_hours)).toBe(0.0);
      console.log('  [PASS] BLOCKER-02: 未退勤化(clock_out=NULL)修正時の週次自動再計算 (土曜の時間外が0hに正常収束) 完全一致');
    } finally {
      checkDbClient.release();
    }

    // ケース9: 同一従業員・同一週の並行勤怠登録におけるAdvisory Lock直列化実証 (BLOCKER-01対応)
    // 異なる2つのDBセッション/トランザクションから、同一従業員・同一週の異なる曜日(月・火)に対して
    // 同時に createRecord() を実行。pg_advisory_xact_lock により安全に直列化され、
    // レースコンディションやデッドロックなく正常終了し、集計が一致することを検証。
    console.log('  -> ケース9: 同一従業員・同一週の並行勤怠登録のAdvisory Lock直列化実証 (BLOCKER-01)...');
    const parallelEmp = empA3_other;
    const parallelWeekDays = [
      { work_date: '2026-10-05', clock_in: '2026-10-05T09:00:00+09:00', clock_out: '2026-10-05T18:00:00+09:00', break_minutes: 60 },
      { work_date: '2026-10-06', clock_in: '2026-10-06T09:00:00+09:00', clock_out: '2026-10-06T18:00:00+09:00', break_minutes: 60 },
    ];

    // 2つの並行リクエストを Promise.all で同時に発行
    const [parallelRes1, parallelRes2] = await Promise.all([
      attendanceService.createRecord(tenantA, userA_Owner, {
        employee_id: parallelEmp,
        work_date: parallelWeekDays[0]!.work_date,
        clock_in: parallelWeekDays[0]!.clock_in,
        clock_out: parallelWeekDays[0]!.clock_out,
        break_minutes: parallelWeekDays[0]!.break_minutes,
      }),
      attendanceService.createRecord(tenantA, userA_Owner, {
        employee_id: parallelEmp,
        work_date: parallelWeekDays[1]!.work_date,
        clock_in: parallelWeekDays[1]!.clock_in,
        clock_out: parallelWeekDays[1]!.clock_out,
        break_minutes: parallelWeekDays[1]!.break_minutes,
      }),
    ]);

    expect(parallelRes1.regular_hours).toBe(8.0);
    expect(parallelRes2.regular_hours).toBe(8.0);

    const parallelCheckClient = await pool.connect();
    try {
      const parallelSum = await parallelCheckClient.query<{ reg_sum: string; ot_sum: string; cnt: string }>(
        `SELECT SUM(regular_hours)::text as reg_sum, SUM(overtime_hours)::text as ot_sum, COUNT(*)::text as cnt
         FROM attendance_records
         WHERE tenant_id = $1 AND employee_id = $2
           AND work_date >= '2026-10-05' AND work_date <= '2026-10-11'`,
        [tenantA, parallelEmp],
      );
      expect(parseInt(parallelSum.rows[0]!.cnt, 10)).toBe(2);
      expect(parseFloat(parallelSum.rows[0]!.reg_sum)).toBe(16.0);
      expect(parseFloat(parallelSum.rows[0]!.ot_sum)).toBe(0.0);
      console.log('  [PASS] BLOCKER-01: 同一従業員・同一週の並行登録がAdvisory Lockにより直列化され、正常集計に収束することを実証');
    } finally {
      parallelCheckClient.release();
    }

    // --------------------------------------------------------------------------
    // 6. EXPLAIN ANALYZE & インデックス適合性実証
    // --------------------------------------------------------------------------
    console.log('6. 勤怠クエリのEXPLAIN ANALYZE実行時間計測 & インデックス利用可能性の実証...');
    const explainClient = await pool.connect();
    try {
      // 6.1 実測パフォーマンス計測
      const analyzeRes = await explainClient.query<{ 'QUERY PLAN': any }>(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
         SELECT employee_id, SUM(regular_hours), SUM(overtime_hours), SUM(late_night_hours), SUM(holiday_hours)
         FROM attendance_records
         WHERE tenant_id = $1 AND work_date >= '2026-09-01' AND work_date <= '2026-09-30'
         GROUP BY employee_id`,
        [tenantA],
      );
      const planData = analyzeRes.rows[0]?.['QUERY PLAN']?.[0];
      const executionTime = planData?.['Execution Time'];
      const planningTime = planData?.['Planning Time'];
      const actualRows = planData?.Plan?.['Actual Rows'];

      console.log(`     実測Execution Time: ${executionTime} ms, Planning Time: ${planningTime} ms, 集計行数: ${actualRows} rows`);
      expect(typeof executionTime).toBe('number');
      expect(executionTime).toBeLessThan(50.0);

      // 6.2 インデックス適合性実証 (SET LOCAL enable_seqscan = off)
      await explainClient.query('BEGIN');
      await explainClient.query('SET LOCAL enable_seqscan = off');

      const indexExplainRes = await explainClient.query<{ 'QUERY PLAN': any }>(
        `EXPLAIN (FORMAT JSON)
         SELECT * FROM attendance_records
         WHERE tenant_id = $1 AND employee_id = $2`,
        [tenantA, empA1],
      );
      await explainClient.query('ROLLBACK');

      const indexPlanStr = JSON.stringify(indexExplainRes.rows[0]?.['QUERY PLAN']);
      expect(indexPlanStr).toContain('ix_attendance_records_tenant_employee');
      if (!indexPlanStr.includes('Index Scan') && !indexPlanStr.includes('Bitmap')) {
        throw new Error(`Expected Index Scan or Bitmap Index Scan but got: ${indexPlanStr}`);
      }

      console.log('  [PASS] パフォーマンス検証: Execution Time 50ms未満の実測、および ix_attendance_records_tenant_employee インデックス適合性を実証');
    } finally {
      explainClient.release();
    }

    console.log('=== P3-T1 実DB E2E検証: 全テスト合格 ===');
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('P3-T1 E2E Verification Failed:', err);
  process.exit(1);
});
