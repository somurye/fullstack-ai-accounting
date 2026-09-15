/**
 * verify-payslips-year-end-adjustment-e2e.ts
 * ==========================================
 * Phase 3 Task 4 (P3-T4): 給与明細発行・年末調整 実DB包括E2E検証スクリプト
 *
 * 検証対象:
 * 1. テナント・ユーザー・RBACロールの初期化 (owner, payroll_admin, employee)
 * 2. 確定済み給与計算 (payroll_calculations, status='active') からの給与明細発行 (payslips)
 * 3. confirmed 後の給与明細に対するDBトリガー変更禁止 (WORM不変性)
 * 4. 給与明細のテナント整合性トリガー & RLS テナント完全分離
 * 5. 年末調整 (year_end_adjustments) の計算実行 (年間確定給与・各種所得控除・過不足税額)
 * 6. 同一employee・同一tax_yearの重複計算防止 (DB UNIQUE制約)
 * 7. 年末調整の確定境界 DB最終防御 (fn_enforce_year_end_adjustment_active_boundary)
 * 8. 承認エンジン連携 (approval_rules, approval_requests) と確定後 WORM不変性
 * 9. employee 自身による年末調整自己確定の防止
 * 10. 年末調整の RLS テナント分離
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { PayslipsService } from '../modules/payslips/payslips.service';
import { PayslipPdfService } from '../modules/payslips/payslip-pdf.service';
import { YearEndAdjustmentsService } from '../modules/year-end-adjustments/year-end-adjustments.service';
import { ApprovalRequestsService } from '../modules/approval-requests/approval-requests.service';

const rawDsn = process.argv[2] || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';

async function main() {
  console.log('=== P3-T4 給与明細発行・年末調整 実DB E2E検証開始 ===');
  console.log(`接続先: ${rawDsn.replace(/:[^:@]+@/, ':****@')}`);

  process.env.DATABASE_URL = rawDsn;
  const pool = new Pool({ connectionString: rawDsn });
  const client = await pool.connect();

  const db = new DatabaseService();
  const auditLogs = new AuditLogsService(db);
  const pdfService = new PayslipPdfService();
  const payslipsService = new PayslipsService(db, auditLogs, pdfService);
  const yearEndService = new YearEndAdjustmentsService(db, auditLogs);
  const approvalService = new ApprovalRequestsService(db, auditLogs);

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
    // 1. テナント・ユーザー・RBACロールの初期化
    // ------------------------------------------------------------------------
    console.log('\n1. テナント・ユーザー・RBACロールの初期化...');
    const tenantA = uuidv4();
    const tenantB = uuidv4();

    await client.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Tenant A (P3-T4)')`, [tenantA]);
    await client.query(`INSERT INTO tenants (id, name) VALUES ($1, 'Tenant B (P3-T4)')`, [tenantB]);

    const adminUserA = uuidv4();
    const empUserA = uuidv4();
    const userB = uuidv4();

    await client.query(
      `INSERT INTO users (id, email, password_hash, name)
       VALUES ($1, 'admin-a-p3t4@example.com', 'hash', 'Admin A'),
              ($2, 'emp-a-p3t4@example.com', 'hash', 'Employee A'),
              ($3, 'user-b-p3t4@example.com', 'hash', 'User B')`,
      [adminUserA, empUserA, userB],
    );

    // ロールIDの取得
    const roleRes = await client.query(
      `SELECT id, code FROM roles WHERE code IN ('payroll_admin', 'employee', 'owner')`,
    );
    const roleMap: Record<string, string> = {};
    roleRes.rows.forEach((r) => {
      roleMap[r.code] = r.id;
    });

    // ユーザーにロール付与
    await client.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id)
       VALUES ($1, $2, $3), ($1, $4, $5), ($6, $7, $8)`,
      [
        tenantA, adminUserA, roleMap['payroll_admin'],
        tenantA, empUserA, roleMap['employee'],
        tenantB, userB, roleMap['owner'],
      ],
    );

    // 従業員の作成
    const empIdA = uuidv4();
    await client.query(
      `INSERT INTO employees (id, tenant_id, employee_code, name, email, hire_date)
       VALUES ($1, $2, 'EMP-T4-001', 'Employee A', 'emp-a-p3t4@example.com', '2025-04-01')`,
      [empIdA, tenantA],
    );

    assert(true, 'テナント・ユーザー・従業員・RBACロールの初期化完了');

    // ------------------------------------------------------------------------
    // 2. 確定済み給与計算レコード (active) の準備
    // ------------------------------------------------------------------------
    console.log('\n2. 確定済み給与計算レコード (active) の準備...');
    const periodIdA = uuidv4();
    await client.query(
      `INSERT INTO payroll_periods (id, tenant_id, name, period_start, period_end, payment_date, status)
       VALUES ($1, $2, '2026年5月度給与', '2026-05-01', '2026-05-31', '2026-06-10', 'closed')`,
      [periodIdA, tenantA],
    );

    const calcIdA = uuidv4();
    await client.query(
      `INSERT INTO payroll_calculations (
         id, tenant_id, payroll_period_id, employee_id,
         regular_hours, overtime_hours, late_night_hours, holiday_hours,
         salary_type, base_salary, hourly_wage, regular_pay,
         overtime_pay, late_night_pay, holiday_pay, total_gross_pay,
         health_insurance_amount, care_insurance_amount, pension_amount, employment_insurance_amount,
         total_social_insurance, taxable_gross_pay, income_tax_amount, resident_tax_amount,
         total_deductions, net_pay, status
       ) VALUES (
         $1, $2, $3, $4,
         160, 10, 0, 0,
         'monthly', 400000, 0, 400000,
         31250, 0, 0, 431250,
         21473, 0, 39438, 2587,
         63498, 431250, 10560, 20000,
         94058, 337192, 'active'
       )`,
      [calcIdA, tenantA, periodIdA, empIdA],
    );

    assert(true, '確定済み給与計算レコード(active)の準備完了');

    // ------------------------------------------------------------------------
    // 3. 給与明細 (payslips) の発行 & PDF出力検証
    // ------------------------------------------------------------------------
    console.log('\n3. 給与明細 (payslips) の発行 & PDF出力検証...');
    const payslip = await payslipsService.create(tenantA, adminUserA, {
      payroll_calculation_id: calcIdA,
      status: 'confirmed',
    });

    assert(payslip.id !== undefined, '給与明細レコードが confirmed で正常に発行された');
    assert(payslip.status === 'confirmed', '発行ステータスが confirmed である');
    assert(payslip.snapshot_data.earnings.total_gross_pay === 431250, 'スナップショットデータに総支給額が保持されている');

    // PDF生成検証
    const { buffer, filename } = await payslipsService.getPdf(tenantA, adminUserA, payslip.id);
    assert(buffer.length > 500, `給与明細PDFが正常に生成された (size: ${buffer.length} bytes)`);
    assert(buffer.toString('utf-8', 0, 5) === '%PDF-', '生成されたバッファが正規のPDFヘッダーを含む');
    assert(filename.includes('2026-05'), `PDFファイル名に支給期間が含まれる (${filename})`);

    // ------------------------------------------------------------------------
    // 4. confirmed 後の給与明細に対するDBトリガー変更禁止 (WORM不変性)
    // ------------------------------------------------------------------------
    console.log('\n4. confirmed 後の給与明細に対するDBトリガー変更禁止 (WORM) 検証...');
    let wormBlocked = false;
    try {
      await client.query(
        `UPDATE payslips SET status = 'draft' WHERE id = $1`,
        [payslip.id],
      );
    } catch (err: any) {
      wormBlocked = true;
      assert(
        err.message.includes('confirmed') || err.message.includes('変更'),
        `confirmed後のUPDATEがDBトリガーで拒否された: ${err.message}`,
      );
    }
    assert(wormBlocked, 'confirmed給与明細のWORM不変性トリガーが正常に機能');

    // ------------------------------------------------------------------------
    // 5. 給与明細のテナント整合性トリガー & RLS分離
    // ------------------------------------------------------------------------
    console.log('\n5. 給与明細のテナント整合性 & RLS分離検証...');
    let tenantMismatchBlocked = false;
    try {
      // Tenant B の payslips として Tenant A の payroll_calculation_id を紐付けようとする
      await client.query(
        `INSERT INTO payslips (tenant_id, payroll_calculation_id, employee_id, payroll_period, payment_date, snapshot_data, status, created_by)
         VALUES ($1, $2, $3, '2026-05', '2026-06-10', '{}'::jsonb, 'draft', $4)`,
        [tenantB, calcIdA, empIdA, userB],
      );
    } catch (err: any) {
      tenantMismatchBlocked = true;
      assert(
        err.message.includes('tenant') || err.message.includes('整合性'),
        `他テナントの給与計算に対する明細INSERTがDBトリガーで遮断された: ${err.message}`,
      );
    }
    assert(tenantMismatchBlocked, '給与明細テナント整合性トリガーが正常に機能');

    // RLS検証: Tenant B のユーザーからは Tenant A の明細が見えない
    const rlsList = await payslipsService.list(tenantB, userB, { page: 1, page_size: 50 });
    assert(rlsList.payslips.length === 0, 'RLSにより他テナント(Tenant A)の給与明細はTenant Bから完全不可視');

    // ------------------------------------------------------------------------
    // 6. 年末調整 (year_end_adjustments) の計算実行
    // ------------------------------------------------------------------------
    console.log('\n6. 年末調整 (year_end_adjustments) の計算実行...');
    // 保険料率マスタを登録
    await client.query(
      `INSERT INTO income_tax_withholding_brackets (
         tenant_id, tax_year, taxable_income_from, taxable_income_to, tax_rate, deduction_amount, is_active
       ) VALUES ($1, 2026, 0, 99999999, 0.05, 0, TRUE)`,
      [tenantA],
    );

    const yearEndAdj = await yearEndService.calculate(tenantA, adminUserA, {
      employee_id: empIdA,
      tax_year: 2026,
      spouse_deduction: 380000,
      dependents_count: 1,
      life_insurance_deduction: 40000,
      earthquake_insurance_deduction: 10000,
      housing_loan_deduction: 0,
    });

    assert(yearEndAdj.id !== undefined, '年末調整ドラフトが正常に計算・作成された');
    assert(yearEndAdj.status === 'draft', '初期ステータスが draft である');
    assert(yearEndAdj.annual_gross_pay === 431250, '対象年度の確定給与総支給額が集計されている');
    assert(yearEndAdj.applied_rate_ids.length > 0, '計算根拠マスタID(applied_rate_ids)が追跡可能に記録されている');

    // ------------------------------------------------------------------------
    // 7. 同一employee・同一tax_yearの重複計算防止 (DB UNIQUE制約)
    // ------------------------------------------------------------------------
    console.log('\n7. 同一employee・同一tax_yearの重複防止 (UNIQUE制約) 検証...');
    let uniqueBlocked = false;
    try {
      // 生SQLで直接同一年度・同一従業員のレコードをINSERTしようとする
      await client.query(
        `INSERT INTO year_end_adjustments (
           tenant_id, employee_id, tax_year, annual_gross_pay, annual_taxable_pay,
           annual_social_insurance, annual_withheld_tax, deductions, total_deductions,
           taxable_income_after_deductions, final_annual_tax, adjustment_amount,
           applied_rate_ids, status, created_by
         ) VALUES (
           $1, $2, 2026, 400000, 400000,
           50000, 10000, '{}'::jsonb, 50000,
           350000, 17500, -7500,
           ARRAY[]::uuid[], 'draft', $3
         )`,
        [tenantA, empIdA, adminUserA],
      );
    } catch (err: any) {
      uniqueBlocked = true;
      assert(
        err.message.includes('unique') || err.message.includes('duplicate') || err.code === '23505',
        `重複INSERTがDBのUNIQUE制約で遮断された: ${err.message}`,
      );
    }
    assert(uniqueBlocked, '同一employee・同一tax_yearの重複計算防止制約が正常に機能');

    // ------------------------------------------------------------------------
    // 8. 年末調整の確定境界 DB最終防御 (approval_requests 実在検証トリガー)
    // ------------------------------------------------------------------------
    console.log('\n8. 年末調整の確定境界 DB最終防御検証...');
    let activeBoundaryBlocked = false;
    try {
      // 承認依頼を経ずに直接 status = 'active' に更新しようとする
      await client.query(
        `UPDATE year_end_adjustments SET status = 'active' WHERE id = $1`,
        [yearEndAdj.id],
      );
    } catch (err: any) {
      activeBoundaryBlocked = true;
      assert(
        err.message.includes('approval') || err.message.includes('承認') || err.message.includes('確定'),
        `直接active化がDBトリガー(fn_enforce_year_end_adjustment_active_boundary)で遮断された: ${err.message}`,
      );
    }
    assert(activeBoundaryBlocked, '確定境界のDBトリガー最終防御が正常に機能');

    // ------------------------------------------------------------------------
    // 9. 承認ルール未設定時の暗黙自動承認防止 & 多段階承認フロー
    // ------------------------------------------------------------------------
    console.log('\n9. 承認フロー連携 & 暗黙自動承認防止検証...');
    let noRuleBlocked = false;
    try {
      await yearEndService.submitApproval(tenantA, adminUserA, yearEndAdj.id, {});
    } catch (err: any) {
      noRuleBlocked = true;
      assert(
        err.errorCode === 'NO_APPROVAL_RULES_CONFIGURED',
        `承認ルール未設定時に暗黙自動承認が防止された: ${err.message}`,
      );
    }
    assert(noRuleBlocked, '暗黙自動承認防止ガードが正常に機能');

    // 承認ルールを設定 (ステップ1: 管理者承認)
    await client.query(
      `INSERT INTO approval_rules (
         tenant_id, target_type, step_number, approver_role_id, is_active
       ) VALUES ($1, 'year_end_adjustment', 1, $2, TRUE)`,
      [tenantA, roleMap['payroll_admin']],
    );

    // 申請提出 -> pending_approval
    const submittedAdj = await yearEndService.submitApproval(tenantA, adminUserA, yearEndAdj.id, {
      comment: '2026年度年末調整の申請です',
    });
    assert(submittedAdj.status === 'pending_approval', '承認申請提出により status = pending_approval に遷移した');
    assert(submittedAdj.approval_request_id !== null, 'approval_requests レコードと正しく紐付けられた');

    // 承認実行
    const arId = submittedAdj.approval_request_id!;
    await approvalService.approve(tenantA, adminUserA, arId, {
      comment: '内容を確認しました。承認します。',
    });

    // 承認完了後のステータス確認
    const finalAdj = await yearEndService.findById(tenantA, adminUserA, yearEndAdj.id);
    assert(finalAdj.status === 'active', '承認完了により year_end_adjustments が status = active に確定遷移した');

    // ------------------------------------------------------------------------
    // 10. 確定後 WORM不変性検証
    // ------------------------------------------------------------------------
    console.log('\n10. active確定後の WORM不変性検証...');
    let wormAdjBlocked = false;
    try {
      await client.query(
        `UPDATE year_end_adjustments SET final_annual_tax = 0 WHERE id = $1`,
        [yearEndAdj.id],
      );
    } catch (err: any) {
      wormAdjBlocked = true;
      assert(
        err.message.includes('active') || err.message.includes('変更'),
        `active確定後のUPDATEがDBトリガーで拒否された: ${err.message}`,
      );
    }
    assert(wormAdjBlocked, 'active確定後の年末調整WORM不変性トリガーが正常に機能');

    // ------------------------------------------------------------------------
    // 11. employee 自身による年末調整自己確定の防止
    // ------------------------------------------------------------------------
    console.log('\n11. employee 自身による自己確定防止検証...');
    // Tenant A に別の年度のレコードを準備
    const calc2025Id = uuidv4();
    const period2025Id = uuidv4();
    await client.query(
      `INSERT INTO payroll_periods (id, tenant_id, name, period_start, period_end, payment_date, status)
       VALUES ($1, $2, '2025年12月度給与', '2025-12-01', '2025-12-31', '2026-01-10', 'closed')`,
      [period2025Id, tenantA],
    );
    await client.query(
      `INSERT INTO payroll_calculations (
         id, tenant_id, payroll_period_id, employee_id,
         regular_hours, overtime_hours, late_night_hours, holiday_hours,
         salary_type, base_salary, hourly_wage, regular_pay,
         overtime_pay, late_night_pay, holiday_pay, total_gross_pay,
         health_insurance_amount, care_insurance_amount, pension_amount, employment_insurance_amount,
         total_social_insurance, taxable_gross_pay, income_tax_amount, resident_tax_amount,
         total_deductions, net_pay, status
       ) VALUES (
         $1, $2, $3, $4,
         160, 0, 0, 0,
         'monthly', 400000, 0, 400000,
         0, 0, 0, 400000,
         20000, 0, 36000, 2400,
         58400, 400000, 10000, 20000,
         88400, 311600, 'active'
       )`,
      [calc2025Id, tenantA, period2025Id, empIdA],
    );

    // 0-step自動承認ルールを設定
    await client.query(
      `DELETE FROM approval_rules WHERE tenant_id = $1 AND target_type = 'year_end_adjustment'`,
      [tenantA],
    );
    await client.query(
      `INSERT INTO approval_rules (
         tenant_id, target_type, step_number, is_explicit_auto_approve, is_active
       ) VALUES ($1, 'year_end_adjustment', 0, TRUE, TRUE)`,
      [tenantA],
    );

    const adj2025 = await yearEndService.calculate(tenantA, adminUserA, {
      employee_id: empIdA,
      tax_year: 2025,
      spouse_deduction: 0,
      dependents_count: 0,
      life_insurance_deduction: 0,
      earthquake_insurance_deduction: 0,
      housing_loan_deduction: 0,
    });

    let selfConfirmBlocked = false;
    try {
      // 従業員本人(empUserA)が自分自身の年末調整を申請して自動即時確定させようとする
      await yearEndService.submitApproval(tenantA, empUserA, adj2025.id, {});
    } catch (err: any) {
      selfConfirmBlocked = true;
      assert(
        err.message.includes('自身') || err.message.includes('確定') || err.status === 403,
        `従業員自身による年末調整確定が拒否された: ${err.message}`,
      );
    }
    assert(selfConfirmBlocked, '従業員自身による年末調整自己確定防止ガードが正常に機能');

    // ------------------------------------------------------------------------
    // 12. 年末調整の RLS テナント分離
    // ------------------------------------------------------------------------
    console.log('\n12. 年末調整の RLS テナント分離検証...');
    const rlsAdjList = await yearEndService.list(tenantB, userB, { page: 1, page_size: 50 });
    assert(rlsAdjList.adjustments.length === 0, 'RLSにより他テナント(Tenant A)の年末調整はTenant Bから完全不可視');

  } catch (e) {
    console.error('予期しないエラー:', e);
    failed++;
  } finally {
    client.release();
    await pool.end();

    console.log('\n=============================================');
    console.log(`検証結果: PASS: ${passed}, FAIL: ${failed}`);
    console.log('=============================================');

    if (failed > 0) {
      process.exit(1);
    }
  }
}

main();
