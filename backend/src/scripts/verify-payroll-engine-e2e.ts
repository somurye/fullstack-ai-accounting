/**
 * verify-payroll-engine-e2e.ts
 * =============================
 * Phase 3 Task 3 (P3-T3): 給与計算エンジン 実DB包括E2E検証スクリプト
 *
 * 検証対象:
 * 1. テナント・ユーザー・RBACロールの初期化 (owner, payroll_admin, accounting_manager, employee)
 * 2. 従業員および給与プロファイル (有効期間・標準報酬・扶養数・WORM不変性) の登録
 * 3. 勤怠実績 (規定内・残業・深夜・休日) の登録
 * 4. 保険料率マスタおよび所得税源泉徴収税額表の適用
 * 5. ルールエンジンによる給与計算実行 (提案 draft 生成、労働時間・支給・控除・手取りの算出)
 * 6. 計算根拠マスタID (applied_rate_ids) の追跡可能性検証
 * 7. 同一期間・同一従業員の重複計算防止 (DB UNIQUE制約)
 * 8. RBAC二重防御 (employee自身による給与計算・確定の拒否)
 * 9. 承認フロー検証 (承認ルール未設定時の400エラー暗黙自動承認防止、明示的0-step即時active、多段承認連携)
 * 10. 確定後WORM不変性 (activeレコードの通常UPDATE拒否・物理DELETE拒否)
 * 11. テナント完全分離 (RLS) & 他テナント料率参照の遮断 (テナント整合性トリガー)
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { ApprovalRequestsService } from '../modules/approval-requests/approval-requests.service';
import { approvalRequestApproveSchema } from '../modules/approval-requests/dto/approval-request.schemas';
import { PayrollCalculationsService } from '../modules/payroll-calculations/payroll-calculations.service';

const rawDsn = process.argv[2] || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';

async function main() {
  console.log('=== P3-T3 給与計算エンジン 実DB E2E検証開始 ===');
  console.log(`接続先: ${rawDsn.replace(/:[^:@]+@/, ':****@')}`);

  process.env.DATABASE_URL = rawDsn;
  const pool = new Pool({ connectionString: rawDsn });
  const client = await pool.connect();

  const db = new DatabaseService();
  const auditLogs = new AuditLogsService(db);
  const approvalRequests = new ApprovalRequestsService(db, auditLogs);
  const payrollService = new PayrollCalculationsService(db, auditLogs);

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  [PASS] ${msg}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${msg}`);
      failed++;
    }
  }

  try {
    // ------------------------------------------------------------------------
    // 1. テナント・ユーザー・RBACロールのセットアップ
    // ------------------------------------------------------------------------
    console.log('\n1. テナント・ユーザー・RBACロールの初期化...');

    const tenantA = uuidv4();
    const tenantB = uuidv4();

    const ownerA = uuidv4();
    const payrollAdminA = uuidv4();
    const accountingMgrA = uuidv4();
    const employeeA = uuidv4();
    const approverA = uuidv4();

    const ownerB = uuidv4();

    await client.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Tenant A'), ($2, 'Tenant B')`, [tenantA, tenantB]);

    // ユーザー作成
    const users = [
      { id: ownerA, email: `owner_a_${Date.now()}@example.com`, name: 'Owner A' },
      { id: payrollAdminA, email: `payroll_admin_a_${Date.now()}@example.com`, name: 'Payroll Admin A' },
      { id: accountingMgrA, email: `acct_mgr_a_${Date.now()}@example.com`, name: 'Accounting Mgr A' },
      { id: employeeA, email: `employee_a_${Date.now()}@example.com`, name: 'Employee A' },
      { id: approverA, email: `approver_a_${Date.now()}@example.com`, name: 'Approver A' },
      { id: ownerB, email: `owner_b_${Date.now()}@example.com`, name: 'Owner B' },
    ];

    for (const u of users) {
      await client.query(`INSERT INTO users (id, email, name) VALUES ($1, $2, $3)`, [u.id, u.email, u.name]);
    }

    // テナントユーザー関連付け
    await client.query(
      `INSERT INTO tenant_users (tenant_id, user_id) VALUES
       ($1, $2), ($1, $3), ($1, $4), ($1, $5), ($1, $6),
       ($7, $8)`,
      [tenantA, ownerA, payrollAdminA, accountingMgrA, employeeA, approverA, tenantB, ownerB],
    );

    // ロールIDの取得
    const rolesRes = await client.query<{ id: string; code: string }>(`SELECT id, code FROM roles`);
    const roleMap = new Map(rolesRes.rows.map((r) => [r.code, r.id]));

    // ロール割当
    await client.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id) VALUES
       ($1, $2, $3), -- owner
       ($1, $4, $5), -- payroll_admin
       ($1, $6, $7), -- accounting_manager
       ($1, $8, $9), -- employee
       ($1, $10, $11), -- approver
       ($12, $13, $3) -- owner B`,
      [
        tenantA,
        ownerA,
        roleMap.get('owner'),
        payrollAdminA,
        roleMap.get('payroll_admin'),
        accountingMgrA,
        roleMap.get('accounting_manager'),
        employeeA,
        roleMap.get('employee'),
        approverA,
        roleMap.get('approver'),
        tenantB,
        ownerB,
      ],
    );

    assert(true, 'テナント・ユーザー・ロールの初期化完了');

    // ------------------------------------------------------------------------
    // 2. 従業員および給与プロファイルの登録
    // ------------------------------------------------------------------------
    console.log('\n2. 従業員および給与プロファイルの登録・WORM検証...');

    const emp1Id = uuidv4();
    const emp2Id = uuidv4();

    // 従業員マスタ登録 (Tenant A)
    await client.query(
      `INSERT INTO employees (id, tenant_id, employee_no, name, hire_date, employment_type, status)
       VALUES
       ($1, $2, 'EMP-001', '山田 太郎', '2025-04-01', 'full_time', 'active'),
       ($3, $2, 'EMP-002', '佐藤 花子', '2025-05-01', 'part_time', 'active')`,
      [emp1Id, tenantA, emp2Id],
    );

    // 給与プロファイル作成 (EMP-001: 月給300,000円、標準報酬300,000円、扶養0、健保/年金/雇用加入)
    const profile1 = await payrollService.createProfile(tenantA, payrollAdminA, {
      employee_id: emp1Id,
      salary_type: 'monthly',
      base_salary: 300000,
      hourly_wage: 0,
      standard_monthly_remuneration: 300000,
      dependents_count: 0,
      has_health_insurance: true,
      has_care_insurance: false,
      has_pension: true,
      has_employment_insurance: true,
      resident_tax_amount: 12000,
      prefecture: 'tokyo',
      effective_from: '2025-04-01',
      effective_to: null,
    });

    assert(profile1.base_salary === '300000.00', 'EMP-001 の月給給与プロファイルが登録された');

    // 給与プロファイル作成 (EMP-002: 時給1,500円、扶養0、雇用保険のみ加入)
    const profile2 = await payrollService.createProfile(tenantA, payrollAdminA, {
      employee_id: emp2Id,
      salary_type: 'hourly',
      base_salary: 0,
      hourly_wage: 1500,
      standard_monthly_remuneration: 0,
      dependents_count: 0,
      has_health_insurance: false,
      has_care_insurance: false,
      has_pension: false,
      has_employment_insurance: true,
      resident_tax_amount: 0,
      prefecture: 'tokyo',
      effective_from: '2025-04-01',
      effective_to: null,
    });

    assert(profile2.hourly_wage === '1500.00', 'EMP-002 の時給給与プロファイルが登録された');

    // EXCLUDE制約検証: 同一従業員の有効期間重複INSERTがDBレベルで拒否されること
    let duplicateProfileBlocked = false;
    try {
      await payrollService.createProfile(tenantA, payrollAdminA, {
        employee_id: emp1Id,
        salary_type: 'monthly',
        base_salary: 350000,
        hourly_wage: 0,
        standard_monthly_remuneration: 350000,
        dependents_count: 0,
        has_health_insurance: true,
        has_care_insurance: false,
        has_pension: true,
        has_employment_insurance: true,
        resident_tax_amount: 15000,
        effective_from: '2025-06-01',
        effective_to: '2025-12-31',
      });
    } catch (err: any) {
      duplicateProfileBlocked = true;
    }
    assert(duplicateProfileBlocked, '給与プロファイルの期間重複がDB EXCLUDE制約により拒否された');

    // WORM不変性検証: 過去プロファイルの直接業務値変更がDBトリガーで遮断されること
    let pastProfileUpdateBlocked = false;
    try {
      await client.query(
        `UPDATE employee_payroll_profiles SET base_salary = 400000 WHERE id = $1`,
        [profile1.id],
      );
    } catch (err: any) {
      pastProfileUpdateBlocked = true;
    }
    assert(pastProfileUpdateBlocked, '過去給与プロファイルの直接UPDATEがDBトリガー(WORM)により拒否された');

    // ------------------------------------------------------------------------
    // 3. 保険料率マスタおよび所得税源泉徴収税額表の登録
    // ------------------------------------------------------------------------
    console.log('\n3. 保険料率マスタおよび所得税源泉徴収税額表の登録...');

    const rateHiId = uuidv4();
    const ratePenId = uuidv4();
    const rateEiId = uuidv4();

    // 保険料率マスタ (Tenant A)
    await client.query(
      `INSERT INTO insurance_rate_tables (
        id, tenant_id, rate_type, description, prefecture, rate_employee, rate_employer, effective_from, effective_to, created_by
      ) VALUES
       ($1, $2, 'health_insurance', '東京都健康保険料率', 'tokyo', 0.04985, 0.04985, '2025-04-01', NULL, $3),
       ($4, $2, 'pension', '厚生年金保険料率', NULL, 0.09150, 0.09150, '2025-04-01', NULL, $3),
       ($5, $2, 'employment_insurance', '雇用保険料率(一般)', NULL, 0.00600, 0.00950, '2025-04-01', NULL, $3)`,
      [rateHiId, tenantA, ownerA, ratePenId, rateEiId],
    );

    // 所得税源泉徴収税額表 (Tenant A: 扶養0人、所得帯 250,000〜300,000円: 税額6,000円、300,000〜350,000円: 税額8,500円)
    const bracket1Id = uuidv4();
    const bracket2Id = uuidv4();

    await client.query(
      `INSERT INTO income_tax_withholding_brackets (
        id, tenant_id, dependents_count, income_min, income_max, tax_amount, effective_from, effective_to, description, created_by
      ) VALUES
       ($1, $2, 0, 250000, 300000, 6000, '2025-04-01', NULL, '月額甲欄25万-30万', $3),
       ($4, $2, 0, 300000, 350000, 8500, '2025-04-01', NULL, '月額甲欄30万-35万', $3)`,
      [bracket1Id, tenantA, ownerA, bracket2Id],
    );

    assert(true, '保険料率マスタおよび所得税源泉徴収税額表の登録完了');

    // ------------------------------------------------------------------------
    // 4. 勤怠実績の登録
    // ------------------------------------------------------------------------
    console.log('\n4. 勤怠実績の登録...');

    // EMP-001 (月給社員): 2026年5月分 (規定内160h, 残業20h, 深夜5h, 休日0h)
    await client.query(
      `INSERT INTO attendance_records (
        tenant_id, employee_id, work_date, regular_hours, overtime_hours, late_night_hours, holiday_hours, status
      ) VALUES
       ($1, $2, '2026-05-10', 80.00, 10.00, 2.00, 0.00, 'approved'),
       ($1, $2, '2026-05-20', 80.00, 10.00, 3.00, 0.00, 'approved')`,
      [tenantA, emp1Id],
    );

    // EMP-002 (時給パート): 2026年5月分 (規定内60h, 残業10h, 深夜0h, 休日0h)
    await client.query(
      `INSERT INTO attendance_records (
        tenant_id, employee_id, work_date, regular_hours, overtime_hours, late_night_hours, holiday_hours, status
      ) VALUES
       ($1, $2, '2026-05-15', 60.00, 10.00, 0.00, 0.00, 'approved')`,
      [tenantA, emp2Id],
    );

    assert(true, '勤怠実績の登録完了');

    // ------------------------------------------------------------------------
    // 5. 給与計算エンジンによる提案生成 (ルールエンジンの実行)
    // ------------------------------------------------------------------------
    console.log('\n5. 給与計算エンジンによる提案生成 (ルール計算)...');

    const period = await payrollService.createPeriod(tenantA, payrollAdminA, {
      name: '2026年05月度給与',
      period_start: '2026-05-01',
      period_end: '2026-05-31',
      payment_date: '2026-06-10',
    });

    assert(period.status === 'draft', '給与計算期間が draft で作成された');

    // 給与計算実行 (提案生成)
    const calcs = await payrollService.calculateForPeriod(tenantA, payrollAdminA, period.id);

    assert(calcs.length === 2, '2名の従業員に対する給与計算提案が生成された');

    const calc1 = calcs.find((c) => c.employee_id === emp1Id)!;
    const calc2 = calcs.find((c) => c.employee_id === emp2Id)!;

    // 設計原則②: 計算結果は直ちに確定せず draft であること
    assert(calc1.status === 'draft', '給与計算結果は直ちに確定せず status = draft (提案) である (設計原則②)');

    // EMP-001 の計算照合:
    // 基本給: 300,000円, 基礎時給 = 300,000 / 160 = 1,875円
    // 残業手当: 20h * 1,875 * 1.25 = 46,875円
    // 深夜手当: 5h * 1,875 * 0.25 = 2,344円
    // 総支給額: 300,000 + 46,875 + 2,344 = 349,219円
    assert(Number(calc1.base_salary) === 300000, 'EMP-001: 基本給が正しく反映されている (300,000円)');
    assert(Number(calc1.overtime_pay) === 46875, 'EMP-001: 残業手当が正しく計算されている (46,875円)');
    assert(Number(calc1.late_night_pay) === 2344, 'EMP-001: 深夜手当が正しく計算されている (2,344円)');
    assert(Number(calc1.total_gross_pay) === 349219, 'EMP-001: 総支給額が正しく計算されている (349,219円)');

    // 社会保険料控除照合:
    // 健保: 300,000 * 0.04985 = 14,955円
    // 年金: 300,000 * 0.0915 = 27,450円
    // 雇用: 349,219 * 0.006 = 2,095円
    // 社保計: 14,955 + 27,450 + 2,095 = 44,500円
    assert(Number(calc1.health_insurance_amount) === 14955, 'EMP-001: 健康保険料が正しく算出された (14,955円)');
    assert(Number(calc1.pension_amount) === 27450, 'EMP-001: 厚生年金保険料が正しく算出された (27,450円)');
    assert(Number(calc1.employment_insurance_amount) === 2095, 'EMP-001: 雇用保険料が正しく算出された (2,095円)');

    // 所得税控除照合:
    // 課税対象額: 349,219 - 44,500 = 304,719円 → bracket2 (300,000〜350,000円) にヒット → 税額 8,500円
    assert(Number(calc1.income_tax_amount) === 8500, 'EMP-001: 源泉所得税が税額表から正しく算出された (8,500円)');
    assert(Number(calc1.resident_tax_amount) === 12000, 'EMP-001: 住民税がプロファイルから反映された (12,000円)');

    // 手取り (差引支給額): 349,219 - (44,500 + 8,500 + 12,000) = 284,219円
    assert(Number(calc1.net_pay) === 284219, 'EMP-001: 差引支給額 (手取り) が正しく算出された (284,219円)');

    // EMP-002 (時給パート) の計算照合:
    // 規定内給与: 60h * 1,500 = 90,000円
    // 残業手当: 10h * 1,500 * 1.25 = 18,750円
    // 総支給額: 108,750円
    // 雇用保険: 108,750 * 0.006 = 653円
    assert(Number(calc2.regular_pay) === 90000, 'EMP-002: 規定内給与が正しく算出された (90,000円)');
    assert(Number(calc2.overtime_pay) === 18750, 'EMP-002: 残業手当が正しく算出された (18,750円)');
    assert(Number(calc2.total_gross_pay) === 108750, 'EMP-002: 総支給額が正しく算出された (108,750円)');
    assert(Number(calc2.employment_insurance_amount) === 653, 'EMP-002: 雇用保険料が正しく算出された (653円)');

    // ------------------------------------------------------------------------
    // 6. 計算根拠マスタID (applied_rate_ids) の追跡可能性検証
    // ------------------------------------------------------------------------
    console.log('\n6. 計算根拠マスタID (applied_rate_ids) の追跡可能性検証...');

    const applied1 = calc1.applied_rate_ids;
    assert(Array.isArray(applied1) && applied1.length >= 4, '計算結果に複数の料率マスタ参照スナップショットが記録されている');

    const hiRateEntry = applied1.find((r: any) => r.type === 'health_insurance');
    assert(hiRateEntry?.rate_id === rateHiId, '参照された健康保険料率マスタのIDが正確に記録されている');

    const penRateEntry = applied1.find((r: any) => r.type === 'pension');
    assert(penRateEntry?.rate_id === ratePenId, '参照された厚生年金保険料率マスタのIDが正確に記録されている');

    const taxBracketEntry = applied1.find((r: any) => r.type === 'income_tax');
    assert(taxBracketEntry?.rate_id === bracket2Id, '参照された源泉徴収税額表のIDが正確に記録されている');

    // ------------------------------------------------------------------------
    // 7. 同一期間・同一従業員の重複計算防止 (DB UNIQUE制約)
    // ------------------------------------------------------------------------
    console.log('\n7. 同一期間・同一従業員の重複計算防止検証...');

    let duplicateCalcBlocked = false;
    try {
      await client.query(
        `INSERT INTO payroll_calculations (
          tenant_id, payroll_period_id, employee_id, created_by, status
        ) VALUES ($1, $2, $3, $4, 'draft')`,
        [tenantA, period.id, emp1Id, payrollAdminA],
      );
    } catch (err: any) {
      duplicateCalcBlocked = true;
    }
    assert(duplicateCalcBlocked, '同一テナント・同一期間・同一従業員の重複計算がDB UNIQUE制約で防止された');

    // ------------------------------------------------------------------------
    // 8. RBAC二重防御の検証
    // ------------------------------------------------------------------------
    console.log('\n8. RBAC二重防御の検証...');

    let employeeCalculateBlocked = false;
    try {
      // 一般従業員 employeeA による給与計算実行の試行
      await payrollService.calculateForPeriod(tenantA, employeeA, period.id);
    } catch (err: any) {
      if (err.status === 403 || err.response?.statusCode === 403) {
        employeeCalculateBlocked = true;
      }
    }
    assert(employeeCalculateBlocked, '一般従業員 (employee) による給与計算実行が 403 Forbidden で拒否された');

    let employeeSubmitApprovalBlocked = false;
    try {
      // 一般従業員 employeeA による承認申請の試行
      await payrollService.submitApproval(tenantA, employeeA, calc1.id);
    } catch (err: any) {
      if (err.status === 403 || err.response?.statusCode === 403) {
        employeeSubmitApprovalBlocked = true;
      }
    }
    assert(employeeSubmitApprovalBlocked, '一般従業員 (employee) による承認申請・確定操作が 403 Forbidden で拒否された');

    // ------------------------------------------------------------------------
    // 9. 確定境界のDB最終防御 & 承認フロー検証 (SO指定 5+2 ケース)
    // ------------------------------------------------------------------------
    console.log('\n9. 確定境界のDB最終防御 & 承認フロー検証 (SO指定 5+2 ケース)...');

    // A. 承認ルール未設定時の承認申請 (暗黙自動承認の防止検証)
    let noRulesBlocked = false;
    try {
      await payrollService.submitApproval(tenantA, payrollAdminA, calc1.id);
    } catch (err: any) {
      if (err.status === 400 || err.response?.statusCode === 400) {
        noRulesBlocked = true;
      }
    }
    assert(noRulesBlocked, '承認ルール未設定時の承認申請が 400 Bad Request で安全に遮断された (暗黙自動承認の防止)');

    // [SOケース1] draft → active への直接UPDATE試行 → 拒否され、statusはdraftのまま
    let directDraftToActiveBlocked = false;
    try {
      await client.query(
        `UPDATE payroll_calculations SET status = 'active' WHERE id = $1`,
        [calc1.id],
      );
    } catch (err: any) {
      directDraftToActiveBlocked = true;
    }
    assert(directDraftToActiveBlocked, '[SOケース1] draft → active への直接UPDATE試行がDBトリガーにより拒否された');
    const checkDraftStatus = await client.query<{ status: string }>(
      `SELECT status FROM payroll_calculations WHERE id = $1`,
      [calc1.id],
    );
    assert(checkDraftStatus.rows[0]?.status === 'draft', '[SOケース1] 拒否後も status は draft のままである');

    // B. 多段階承認ルールの設定 (Step 1: approverA による承認)
    const ruleId = uuidv4();
    await client.query(
      `INSERT INTO approval_rules (
        id, tenant_id, target_type, step_number, approver_role_id, is_active, is_explicit_auto_approve
      ) VALUES ($1, $2, 'payroll', 1, $3, TRUE, FALSE)`,
      [ruleId, tenantA, roleMap.get('approver')],
    );

    // 多段階承認での申請提出 (draft → pending_approval)
    const submittedCalc = await payrollService.submitApproval(tenantA, payrollAdminA, calc1.id);
    assert(submittedCalc.status === 'pending_approval', '承認申請により status = pending_approval に遷移した');
    assert(submittedCalc.approval_request_id !== null, '汎用 approval_requests が起票された');

    // [SOケース3] pending_approval → active への直接UPDATE試行 → 拒否
    let directPendingToActiveBlocked = false;
    try {
      await client.query(
        `UPDATE payroll_calculations SET status = 'active' WHERE id = $1`,
        [calc1.id],
      );
    } catch (err: any) {
      directPendingToActiveBlocked = true;
    }
    assert(directPendingToActiveBlocked, '[SOケース3] pending_approval → active への直接UPDATE試行がDBトリガーにより拒否された');
    const checkPendingStatus = await client.query<{ status: string }>(
      `SELECT status FROM payroll_calculations WHERE id = $1`,
      [calc1.id],
    );
    assert(checkPendingStatus.rows[0]?.status === 'pending_approval', '[SOケース3] 拒否後も status は pending_approval のままである');

    // 承認依頼の確認
    const arRes = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM approval_requests WHERE id = $1`,
      [submittedCalc.approval_request_id],
    );
    assert(arRes.rows[0]?.status === 'pending', 'approval_requests が pending 状態で作成された');

    // 一旦却下して rejected 状態を作る
    await approvalRequests.reject(tenantA, approverA, arRes.rows[0].id, { comment: '差し戻しテスト' });
    const rejectedCalcRes = await client.query<{ status: string }>(
      `SELECT status FROM payroll_calculations WHERE id = $1`,
      [calc1.id],
    );
    assert(rejectedCalcRes.rows[0]?.status === 'rejected', '却下により status = rejected に遷移した');

    // [SOケース2] rejected → active への直接UPDATE試行 → 拒否
    let directRejectedToActiveBlocked = false;
    try {
      await client.query(
        `UPDATE payroll_calculations SET status = 'active' WHERE id = $1`,
        [calc1.id],
      );
    } catch (err: any) {
      directRejectedToActiveBlocked = true;
    }
    assert(directRejectedToActiveBlocked, '[SOケース2] rejected → active への直接UPDATE試行がDBトリガーにより拒否された');
    const checkRejectedStatus = await client.query<{ status: string }>(
      `SELECT status FROM payroll_calculations WHERE id = $1`,
      [calc1.id],
    );
    assert(checkRejectedStatus.rows[0]?.status === 'rejected', '[SOケース2] 拒否後も status は rejected のままである');

    // [SOケース4] 正規の多段階承認エンジンを通した確定 → active成功
    // rejected から再申請
    const resubmittedCalc = await payrollService.submitApproval(tenantA, payrollAdminA, calc1.id);
    assert(resubmittedCalc.status === 'pending_approval', '再申請により status = pending_approval に遷移した');
    const newArRes = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM approval_requests WHERE id = $1`,
      [resubmittedCalc.approval_request_id],
    );
    // approverA による正規承認実行 (approval_requests.status が approved に更新され、finalizeApproval で active に遷移)
    await approvalRequests.approve(tenantA, approverA, newArRes.rows[0].id, { comment: '給与計算内容を確認し正式承認' });

    // 承認完了後の給与計算ステータス確認 (active へ自動連動)
    const confirmedCalcRes = await client.query<any>(
      `SELECT status, approved_at FROM payroll_calculations WHERE id = $1`,
      [calc1.id],
    );
    assert(confirmedCalcRes.rows[0]?.status === 'active', '[SOケース4] 正規の多段階承認エンジンを通した確定により status = active に成功した');
    assert(confirmedCalcRes.rows[0]?.approved_at !== null, '承認完了日時 (approved_at) が記録された');

    // [SOケース5] 明示的0-step自動承認を通した確定 → active成功 (approval_requests に approved 証跡が起票される)
    await client.query(`DELETE FROM approval_rules WHERE tenant_id = $1 AND target_type = 'payroll'`, [tenantA]);
    await client.query(
      `INSERT INTO approval_rules (
        tenant_id, target_type, step_number, approver_role_id, is_active, is_explicit_auto_approve
      ) VALUES ($1, 'payroll', 0, $2, TRUE, TRUE)`,
      [tenantA, roleMap.get('owner')],
    );

    const autoApprovedCalc = await payrollService.submitApproval(tenantA, payrollAdminA, calc2.id);
    assert(autoApprovedCalc.status === 'active', '[SOケース5] 明示的0-step自動承認を通した確定により即座に status = active に成功した');

    // 0-step承認でも approval_requests に status = 'approved' の実レコードが作成されていることを確認
    const zeroStepAr = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM approval_requests WHERE target_type = 'payroll' AND target_id = $1`,
      [calc2.id],
    );
    assert(zeroStepAr.rows[0]?.status === 'approved', '[SOケース5] 0-step自動承認でも approval_requests に status = approved の実在レコードが作成された');

    // ------------------------------------------------------------------------
    // 9-B. 【P3-T3-FIX3 実証】approval_requests への直接 status='approved' 偽造INSERT攻撃遮断 (SO指摘シナリオ)
    // ------------------------------------------------------------------------
    console.log('\n9-B. 【P3-T3-FIX3 実証】approval_requests への直接 status=\'approved\' 偽造INSERT攻撃遮断 (SO指摘シナリオ)...');

    const spoofTargetPeriodId = uuidv4();
    const spoofTargetEmpId = uuidv4();
    const spoofTargetCalcId = uuidv4();

    await client.query(
      `INSERT INTO payroll_periods (id, tenant_id, name, period_start, period_end, payment_date)
       VALUES ($1, $2, 'Spoof Target Period', '2026-07-01', '2026-07-31', '2026-08-10')`,
      [spoofTargetPeriodId, tenantA],
    );
    await client.query(
      `INSERT INTO employees (id, tenant_id, employee_no, name, hire_date)
       VALUES ($1, $2, 'EMP-SPOOF-TARGET', '偽装対象 テスト', '2026-01-01')`,
      [spoofTargetEmpId, tenantA],
    );
    await client.query(
      `INSERT INTO payroll_calculations (id, tenant_id, payroll_period_id, employee_id, created_by, status)
       VALUES ($1, $2, $3, $4, $5, 'draft')`,
      [spoofTargetCalcId, tenantA, spoofTargetPeriodId, spoofTargetEmpId, ownerA],
    );

    // [SO攻撃シナリオ1] 承認エンジンの正規フローを経ず、同一テナント・正しいtarget_id・正しいtarget_typeで
    // approval_requests へ直接 status='approved' の行を単発INSERTしようとする
    let directApprovedInsertBlocked = false;
    let directApprovedInsertError: any = null;
    try {
      await client.query(
        `INSERT INTO approval_requests (
           tenant_id, target_type, target_id, submitted_by, total_steps, current_step, status
         ) VALUES ($1, 'payroll', $2, $3, 1, 1, 'approved')`,
        [tenantA, spoofTargetCalcId, ownerA],
      );
    } catch (err: any) {
      directApprovedInsertBlocked = true;
      directApprovedInsertError = err;
    }
    assert(
      directApprovedInsertBlocked,
      '[SO攻撃シナリオ1] approval_requests への直接 status=\'approved\' 単発INSERTがDBトリガーにより拒否された',
    );
    assert(
      directApprovedInsertError?.code === '55000',
      `[SO攻撃シナリオ1] DBトリガーエラーコード 55000 が返却された (got: ${directApprovedInsertError?.code})`,
    );

    // [SO攻撃シナリオ2] 上記が拒否された結果、対応する payroll_calculations も active に遷移できないことを確認
    let spoofCalcActiveUpdateBlocked = false;
    try {
      await client.query(
        `UPDATE payroll_calculations SET status = 'active' WHERE id = $1`,
        [spoofTargetCalcId],
      );
    } catch (err: any) {
      spoofCalcActiveUpdateBlocked = true;
    }
    assert(
      spoofCalcActiveUpdateBlocked,
      '[SO攻撃シナリオ2] 偽造INSERT拒否の結果、対応する payroll_calculations も確定境界トリガーにより active 化が拒否された',
    );

    // payroll_calculations が依然として draft のままであることを確認
    const spoofCalcAfter = await client.query<{ status: string }>(
      `SELECT status FROM payroll_calculations WHERE id = $1`,
      [spoofTargetCalcId],
    );
    assert(
      spoofCalcAfter.rows[0]?.status === 'draft',
      '[SO攻撃シナリオ2] 偽造試行後も payroll_calculations は安全に draft のまま保持されている',
    );

    // [SO「他テナント偽装」ケース検証] 他テナントの approval_requests を参照して active にしようとする試行 → 拒否
    let crossTenantApprovalSpoofBlocked = false;
    try {
      const spoofPeriodId = uuidv4();
      const spoofEmpId = uuidv4();
      const spoofCalcId = uuidv4();
      await client.query(
        `INSERT INTO payroll_periods (id, tenant_id, name, period_start, period_end, payment_date)
         VALUES ($1, $2, 'Cross Spoof Period', '2026-06-01', '2026-06-30', '2026-07-10')`,
        [spoofPeriodId, tenantA],
      );
      await client.query(
        `INSERT INTO employees (id, tenant_id, employee_no, name, hire_date)
         VALUES ($1, $2, 'EMP-CROSS-SPOOF', '他テナント偽装 テスト', '2026-01-01')`,
        [spoofEmpId, tenantA],
      );
      await client.query(
        `INSERT INTO payroll_calculations (id, tenant_id, payroll_period_id, employee_id, created_by, status)
         VALUES ($1, $2, $3, $4, $5, 'draft')`,
        [spoofCalcId, tenantA, spoofPeriodId, spoofEmpId, ownerA],
      );

      // 他テナント(Tenant B)で明示的0-step自動承認ルールを設定し、approval_requests を approved へ更新
      await client.query(`DELETE FROM approval_rules WHERE tenant_id = $1 AND target_type = 'payroll'`, [tenantB]);
      await client.query(
        `INSERT INTO approval_rules (tenant_id, target_type, step_number, approver_role_id, is_active, is_explicit_auto_approve)
         VALUES ($1, 'payroll', 0, $2, TRUE, TRUE)`,
        [tenantB, roleMap.get('owner')],
      );

      const crossAr = await client.query<{ id: string }>(
        `INSERT INTO approval_requests (tenant_id, target_type, target_id, submitted_by, total_steps, current_step, status)
         VALUES ($1, 'payroll', $2, $3, 1, 1, 'pending')
         RETURNING id`,
        [tenantB, spoofCalcId, ownerB],
      );
      await client.query(
        `UPDATE approval_requests SET status = 'approved', updated_at = now() WHERE id = $1`,
        [crossAr.rows[0].id],
      );

      // Tenant A の給与計算レコードを active に UPDATE (DBトリガーが tenant_id 一致を要求するため拒否される)
      await client.query(
        `UPDATE payroll_calculations SET status = 'active' WHERE id = $1`,
        [spoofCalcId],
      );
    } catch (err: any) {
      crossTenantApprovalSpoofBlocked = true;
    }
    assert(crossTenantApprovalSpoofBlocked, '[SO他テナント偽装ケース] 他テナントの承認レコードを流用した active 遷移が DBトリガーにより安全に拒否された');

    // ------------------------------------------------------------------------
    // 9-C. 【P3-T3-FIX4 実証】pending→approved への直接UPDATE遮断 & 承認根拠・権限のDB最終防御
    // ------------------------------------------------------------------------
    console.log('\n9-C. 【P3-T3-FIX4 実証】pending→approved への直接UPDATE遮断 & 承認根拠・権限のDB最終防御...');

    // 多段階承認ルール（1ステップ）を再設定
    await client.query(`DELETE FROM approval_rules WHERE tenant_id = $1 AND target_type = 'payroll'`, [tenantA]);
    await client.query(
      `INSERT INTO approval_rules (
        tenant_id, target_type, step_number, approver_role_id, is_active, is_explicit_auto_approve
      ) VALUES ($1, 'payroll', 1, $2, TRUE, FALSE)`,
      [tenantA, roleMap.get('owner')],
    );

    const fix4PeriodId = uuidv4();
    const fix4EmpId = uuidv4();
    const fix4CalcId = uuidv4();
    await client.query(
      `INSERT INTO payroll_periods (id, tenant_id, name, period_start, period_end, payment_date)
       VALUES ($1, $2, 'FIX4 Period', '2026-08-01', '2026-08-31', '2026-09-10')`,
      [fix4PeriodId, tenantA],
    );
    await client.query(
      `INSERT INTO employees (id, tenant_id, employee_no, name, hire_date)
       VALUES ($1, $2, 'EMP-FIX4', 'FIX4 テスト従業員', '2026-01-01')`,
      [fix4EmpId, tenantA],
    );
    await client.query(
      `INSERT INTO payroll_calculations (id, tenant_id, payroll_period_id, employee_id, created_by, status)
       VALUES ($1, $2, $3, $4, $5, 'draft')`,
      [fix4CalcId, tenantA, fix4PeriodId, fix4EmpId, payrollAdminA],
    );

    // approval_requests を pending で起票
    const fix4ArResult = await client.query<{ id: string }>(
      `INSERT INTO approval_requests (
         tenant_id, target_type, target_id, submitted_by, total_steps, current_step, status
       ) VALUES ($1, 'payroll', $2, $3, 1, 1, 'pending')
       RETURNING id`,
      [tenantA, fix4CalcId, payrollAdminA],
    );
    const fix4ArId = fix4ArResult.rows[0].id;

    // [SO攻撃シナリオ1] approval_history を作らずに pending → approved へ直接UPDATE試行 → DB拒否
    let directPendingToApprovedBlocked = false;
    let directPendingToApprovedError: any = null;
    try {
      await client.query(
        `UPDATE approval_requests SET status = 'approved' WHERE id = $1`,
        [fix4ArId],
      );
    } catch (err: any) {
      directPendingToApprovedBlocked = true;
      directPendingToApprovedError = err;
    }
    assert(
      directPendingToApprovedBlocked,
      '[P3-T3-FIX4 攻撃シナリオ1] approval_history なしでの pending → approved 直接UPDATEがDBトリガーにより拒否された',
    );
    assert(
      directPendingToApprovedError?.code === '55000',
      `[P3-T3-FIX4 攻撃シナリオ1] エラーコード 55000 が返却された (got: ${directPendingToApprovedError?.code})`,
    );

    // [SO攻撃シナリオ2] 承認権限を持たないユーザー (employeeA) による approval_history 偽造INSERT試行 → DB拒否
    let unauthorizedHistoryInsertBlocked = false;
    let unauthorizedHistoryError: any = null;
    try {
      await client.query(
        `INSERT INTO approval_history (
           tenant_id, approval_request_id, step_number, approver_id, action, comment
         ) VALUES ($1, $2, 1, $3, 'approve', '権限なき不正承認履歴偽造')`,
        [tenantA, fix4ArId, employeeA],
      );
    } catch (err: any) {
      unauthorizedHistoryInsertBlocked = true;
      unauthorizedHistoryError = err;
    }
    assert(
      unauthorizedHistoryInsertBlocked,
      '[P3-T3-FIX4 攻撃シナリオ2] 承認権限を持たないユーザーによる approval_history 偽造INSERTがDBトリガーにより拒否された',
    );
    assert(
      unauthorizedHistoryError?.code === '42501',
      `[P3-T3-FIX4 攻撃シナリオ2] 権限不足エラーコード 42501 が返却された (got: ${unauthorizedHistoryError?.code})`,
    );

    // [SO攻撃シナリオ3] 起票者本人 (payrollAdminA) による自己承認 approval_history INSERT試行 → DB拒否
    let selfApprovalHistoryBlocked = false;
    let selfApprovalError: any = null;
    try {
      await client.query(
        `INSERT INTO approval_history (
           tenant_id, approval_request_id, step_number, approver_id, action, comment
         ) VALUES ($1, $2, 1, $3, 'approve', '自己承認試行')`,
        [tenantA, fix4ArId, payrollAdminA],
      );
    } catch (err: any) {
      selfApprovalHistoryBlocked = true;
      selfApprovalError = err;
    }
    assert(
      selfApprovalHistoryBlocked,
      '[P3-T3-FIX4 攻撃シナリオ3] 起票者本人による自己承認 approval_history INSERTがDBトリガーにより拒否された',
    );
    assert(
      selfApprovalError?.code === '23514',
      `[P3-T3-FIX4 攻撃シナリオ3] 自己承認禁止エラーコード 23514 が返却された (got: ${selfApprovalError?.code})`,
    );

    // [SO攻撃シナリオ4] 偽造失敗により approval_history が存在しないため、依然として給与も active 化できないことを確認
    let fix4CalcActiveBlocked = false;
    try {
      await client.query(
        `UPDATE payroll_calculations SET status = 'active' WHERE id = $1`,
        [fix4CalcId],
      );
    } catch (err: any) {
      fix4CalcActiveBlocked = true;
    }
    assert(
      fix4CalcActiveBlocked,
      '[P3-T3-FIX4 攻撃シナリオ4] 承認偽造失敗により payroll_calculations の active 化もDBトリガーで安全に拒否された',
    );

    // ------------------------------------------------------------------------
    // 9-D. 【P3-T3-FIX5 実証】API経路における approver_id なりすまし不可能性の検証 (SO指摘シナリオ)
    // ------------------------------------------------------------------------
    console.log('\n9-D. 【P3-T3-FIX5 実証】API経路における approver_id なりすまし不可能性の検証...');

    // 新規に計算レコードと承認依頼を作成
    const fix5CalcRes = await client.query<{ id: string }>(
      `INSERT INTO payroll_calculations (
         tenant_id, employee_id, payroll_period, calculation_type,
         total_gross_pay, total_deductions, net_pay, status
       ) VALUES ($1, $2, '2026-06', 'regular', 300000, 50000, 250000, 'draft')
       RETURNING id`,
      [tenantA, employeeA],
    );
    const fix5CalcId = fix5CalcRes.rows[0].id;

    const fix5ArResult = await client.query<{ id: string }>(
      `INSERT INTO approval_requests (
         tenant_id, target_type, target_id, submitted_by, total_steps, current_step, status
       ) VALUES ($1, 'payroll', $2, $3, 1, 1, 'pending')
       RETURNING id`,
      [tenantA, fix5CalcId, payrollAdminA],
    );
    const fix5ArId = fix5ArResult.rows[0].id;

    // 攻撃者がAPIリクエストボディに別ユーザー(ownerA)のapprover_idを含めて送信したと想定
    const maliciousClientPayload = {
      comment: 'なりすまし承認試行',
      approver_id: ownerA,
      userId: ownerA,
      user_id: ownerA,
    };

    // Controller層の挙動を模倣: DTOスキーマパーサーを通す
    const parsedDto = approvalRequestApproveSchema.parse(maliciousClientPayload);
    assert(
      (parsedDto as any).approver_id === undefined && (parsedDto as any).userId === undefined,
      '[P3-T3-FIX5 攻撃遮断1] DTOパーサーによりクライアントが指定した approver_id / userId は完全に除外(strip)された',
    );

    // Controller層は常に認証セッション(approverA)から得た userId を Service に渡す
    await approvalRequests.approve(tenantA, approverA, fix5ArId, parsedDto);

    // 実DBの approval_history を確認: approver_id が ownerA ではなく approverA で記録されたことを検証
    const fix5HistoryRes = await client.query<{ approver_id: string }>(
      `SELECT approver_id FROM approval_history WHERE tenant_id = $1 AND approval_request_id = $2`,
      [tenantA, fix5ArId],
    );
    assert(
      fix5HistoryRes.rowCount === 1 && fix5HistoryRes.rows[0].approver_id === approverA,
      '[P3-T3-FIX5 攻撃遮断2] 実DBの approval_history.approver_id はクライアント指定の偽造IDではなく正規の認証ユーザー(approverA)として記録された',
    );

    // ------------------------------------------------------------------------
    // 10. 確定後WORM不変性検証 (SOケース 6 & 7 / fail-closed)
    // ------------------------------------------------------------------------
    console.log('\n10. 確定後WORM不変性検証 (SOケース 6 & 7 / fail-closed)...');

    // [SOケース6] active後の通常UPDATE試行 → 拒否
    let activeCalcUpdateBlocked = false;
    try {
      await client.query(
        `UPDATE payroll_calculations SET base_salary = 999999 WHERE id = $1`,
        [calc1.id],
      );
    } catch (err: any) {
      activeCalcUpdateBlocked = true;
    }
    assert(activeCalcUpdateBlocked, '[SOケース6] 確定済み (active) の給与計算レコードの通常UPDATEがDBトリガー(WORM)により拒否された');

    // [SOケース7] active後のDELETE試行 → 拒否
    let activeCalcDeleteBlocked = false;
    try {
      await client.query(
        `DELETE FROM payroll_calculations WHERE id = $1`,
        [calc1.id],
      );
    } catch (err: any) {
      activeCalcDeleteBlocked = true;
    }
    assert(activeCalcDeleteBlocked, '[SOケース7] 確定済み (active) の給与計算レコードの物理DELETEがDBトリガー(WORM)により拒否された');

    // [ボーナスケース] 初期INSERTで status = 'active' を直接指定する試行 → 拒否
    let directInsertActiveBlocked = false;
    try {
      await client.query(
        `INSERT INTO payroll_calculations (
          tenant_id, payroll_period_id, employee_id, created_by, status
        ) VALUES ($1, $2, $3, $4, 'active')`,
        [tenantA, period.id, uuidv4(), ownerA],
      );
    } catch (err: any) {
      directInsertActiveBlocked = true;
    }
    assert(directInsertActiveBlocked, '直接 status = active での不正INSERTが確定境界トリガーにより安全に拒否された');

    // ------------------------------------------------------------------------
    // 11. テナント完全分離 (RLS) & 他テナント料率参照の遮断検証
    // ------------------------------------------------------------------------
    console.log('\n11. テナント完全分離 (RLS) & 他テナント料率参照の遮断検証...');

    // RLS: Tenant B ユーザーから Tenant A の給与計算一覧の取得
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE app_runtime`);
    await client.query(`SET LOCAL app.current_tenant_id = '${tenantB}'`);
    await client.query(`SET LOCAL app.current_user_id = '${ownerB}'`);

    const rlsCalcsRes = await client.query(`SELECT count(*)::int AS cnt FROM payroll_calculations`);
    assert(rlsCalcsRes.rows[0].cnt === 0, 'Tenant B から Tenant A の給与計算データが一切見えない (RLS完全遮断)');

    const rlsPeriodsRes = await client.query(`SELECT count(*)::int AS cnt FROM payroll_periods`);
    assert(rlsPeriodsRes.rows[0].cnt === 0, 'Tenant B から Tenant A の給与期間データが一切見えない (RLS完全遮断)');
    await client.query('COMMIT');

    // テナント整合性トリガー: 他テナントの料率マスタを参照しようとした不正なINSERTの遮断
    let crossTenantRateBlocked = false;
    try {
      const periodB = uuidv4();
      const empB = uuidv4();
      await client.query(
        `INSERT INTO payroll_periods (id, tenant_id, name, period_start, period_end, payment_date)
         VALUES ($1, $2, 'Tenant B Period', '2026-05-01', '2026-05-31', '2026-06-10')`,
        [periodB, tenantB],
      );
      await client.query(
        `INSERT INTO employees (id, tenant_id, employee_no, name, hire_date)
         VALUES ($1, $2, 'EMP-B-001', '田中 B', '2026-01-01')`,
        [empB, tenantB],
      );

      // applied_rate_ids に Tenant A の rateHiId を含める
      const crossRateJson = JSON.stringify([{ type: 'health_insurance', rate_id: rateHiId }]);
      await client.query(
        `INSERT INTO payroll_calculations (
          tenant_id, payroll_period_id, employee_id, created_by, applied_rate_ids, status
        ) VALUES ($1, $2, $3, $4, $5::jsonb, 'draft')`,
        [tenantB, periodB, empB, ownerB, crossRateJson],
      );
    } catch (err: any) {
      crossTenantRateBlocked = true;
    }
    assert(crossTenantRateBlocked, '他テナントの料率マスタを参照する給与計算INSERTがテナント整合性トリガーで安全に遮断された');

  } catch (err: any) {
    console.error('\n[FATAL ERROR during E2E]:', err);
    failed++;
  } finally {
    try {
      client.release();
    } catch (_) {}
    try {
      await pool.end();
    } catch (_) {}
  }

  console.log('\n======================================================================');
  console.log(`P3-T3 給与計算エンジン E2E検証結果: ${passed} passed, ${failed} failed`);
  console.log('======================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
