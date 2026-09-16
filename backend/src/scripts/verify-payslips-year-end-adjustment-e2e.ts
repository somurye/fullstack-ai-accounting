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

    const ownerA = uuidv4();
    const adminUserA = uuidv4();
    const empUserA = uuidv4();
    const userB = uuidv4();

    await client.query(
      `INSERT INTO users (id, email, password_hash, name)
       VALUES ($1, 'owner-a-p3t4@example.com', 'hash', 'Owner A'),
              ($2, 'admin-a-p3t4@example.com', 'hash', 'Admin A'),
              ($3, 'emp-a-p3t4@example.com', 'hash', 'Employee A'),
              ($4, 'user-b-p3t4@example.com', 'hash', 'User B')`,
      [ownerA, adminUserA, empUserA, userB],
    );

    // ロールIDの取得
    const roleRes = await client.query(
      `SELECT id, code FROM roles WHERE code IN ('payroll_admin', 'employee', 'owner')`,
    );
    const roleMap: Record<string, string> = {};
    roleRes.rows.forEach((r) => {
      roleMap[r.code] = r.id;
    });

    // テナントユーザー関連付け
    await client.query(
      `INSERT INTO tenant_users (tenant_id, user_id)
       VALUES ($1, $2), ($3, $4), ($5, $6), ($7, $8)`,
      [tenantA, ownerA, tenantA, adminUserA, tenantA, empUserA, tenantB, userB],
    );

    // ユーザーにロール付与
    await client.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id)
       VALUES
        ($1, $2, $3),
        ($4, $5, $6),
        ($7, $8, $9),
        ($10, $11, $12)`,
      [
        tenantA, ownerA, roleMap['owner'],
        tenantA, adminUserA, roleMap['payroll_admin'],
        tenantA, empUserA, roleMap['employee'],
        tenantB, userB, roleMap['owner'],
      ],
    );

    // 従業員の作成
    const empIdA = uuidv4();
    await client.query(
      `INSERT INTO employees (id, tenant_id, user_id, employee_no, name, hire_date)
       VALUES ($1, $2, $3, 'EMP-T4-001', 'Employee A', '2025-04-01')`,
      [empIdA, tenantA, empUserA],
    );

    assert(true, 'テナント・ユーザー・従業員・RBACロールの初期化完了');

    // ------------------------------------------------------------------------
    // 2. 確定済み給与計算レコード (active) の準備
    // ------------------------------------------------------------------------
    console.log('\n2. 確定済み給与計算レコード (active) の準備...');
    const periodIdA = uuidv4();
    await client.query(
      `INSERT INTO payroll_periods (id, tenant_id, name, period_start, period_end, payment_date, status)
       VALUES ($1, $2, '2026-05', '2026-05-01', '2026-05-31', '2026-06-10', 'closed')`,
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
         income_tax_amount, resident_tax_amount, total_deductions, net_pay,
         status, created_by
       ) VALUES (
         $1, $2, $3, $4,
         160, 10, 0, 0,
         'monthly', 400000, 0, 400000,
         31250, 0, 0, 431250,
         21473, 0, 39438, 2587,
         10560, 20000, 94058, 337192,
         'draft', $5
       )`,
      [calcIdA, tenantA, periodIdA, empIdA, adminUserA],
    );

    // 承認ルールを設定して approval_requests を approved にし、active に確定 (承認者は ownerA)
    await client.query(`DELETE FROM approval_rules WHERE tenant_id = $1 AND target_type = 'payroll'`, [tenantA]);
    await client.query(
      `INSERT INTO approval_rules (tenant_id, target_type, step_number, approver_role_id, is_active, is_explicit_auto_approve)
       VALUES ($1, 'payroll', 1, $2, TRUE, FALSE)`,
      [tenantA, roleMap['owner']],
    );

    const arRes = await client.query<{ id: string }>(
      `INSERT INTO approval_requests (tenant_id, target_type, target_id, submitted_by, total_steps, current_step, status)
       VALUES ($1, 'payroll', $2, $3, 1, 1, 'pending')
       RETURNING id`,
      [tenantA, calcIdA, adminUserA],
    );

    await client.query(
      `INSERT INTO approval_history (tenant_id, approval_request_id, step_number, approver_id, action, comment)
       VALUES ($1, $2, 1, $3, 'approve', '給与確定承認')`,
      [tenantA, arRes.rows[0].id, ownerA],
    );
    await client.query(
      `UPDATE approval_requests SET status = 'approved', updated_at = now() WHERE id = $1`,
      [arRes.rows[0].id],
    );

    await client.query(
      `UPDATE payroll_calculations SET status = 'active' WHERE id = $1`,
      [calcIdA],
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
        err.message.toLowerCase().includes('confirmed') || err.message.includes('変更'),
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

    // payslips.created_by テナント整合性トリガー検証 (他テナントユーザー指定の拒絶)
    let payslipCreatedByBlocked = false;
    try {
      await client.query(
        `INSERT INTO payslips (tenant_id, payroll_calculation_id, employee_id, payroll_period, payment_date, snapshot_data, status, created_by)
         VALUES ($1, $2, $3, '2026-05', '2026-06-10', '{}'::jsonb, 'draft', $4)`,
        [tenantA, calcIdA, empIdA, userB], // userB は tenantB のユーザー
      );
    } catch (err: any) {
      payslipCreatedByBlocked = true;
      assert(
        err.message.includes('created_by user') && err.message.includes('is not a member of tenant'),
        `created_byテナント不整合がDBトリガーで遮断された: ${err.message}`,
      );
    }
    assert(payslipCreatedByBlocked, 'payslips.created_by テナント整合性トリガーが正常に機能');

    // RLS検証: Tenant B のユーザーからは Tenant A の明細が見えない
    const rlsList = await payslipsService.list(tenantB, userB, { page: 1, page_size: 50 });
    assert(rlsList.payslips.length === 0, 'RLSにより他テナント(Tenant A)の給与明細はTenant Bから完全不可視');

    // ------------------------------------------------------------------------
    // 6. 年末調整 (year_end_adjustments) の計算実行 (複数ブラケット・年度制限・実マッチング検証)
    // ------------------------------------------------------------------------
    console.log('\n6. 年末調整 (year_end_adjustments) の計算実行...');
    // BLOCKER-01検証用: 複数年度・複数扶養人数・複数所得帯のブラケットマスタを登録
    const bracket2025Id = uuidv4();
    const bracket2026Dep0Id = uuidv4();
    const bracket2026Dep1LowId = uuidv4();
    const bracket2026Dep1HighId = uuidv4();

    await client.query(
      `INSERT INTO income_tax_withholding_brackets (
         id, tenant_id, dependents_count, income_min, income_max, tax_amount,
         effective_from, effective_to, description, created_by
       ) VALUES
        ($1, $5, 1, 0, 10000000, 5000, '2025-01-01', '2025-12-31', 'bracket_2025', $6),
        ($2, $5, 0, 0, 10000000, 6000, '2026-01-01', '2026-12-31', 'bracket_2026_dep0', $6),
        ($3, $5, 1, 0, 1000000, 0, '2026-01-01', '2026-12-31', 'bracket_2026_dep1_low', $6),
        ($4, $5, 1, 1000000, 10000000, 15000, '2026-01-01', '2026-12-31', 'bracket_2026_dep1_high', $6)`,
      [bracket2025Id, bracket2026Dep0Id, bracket2026Dep1LowId, bracket2026Dep1HighId, tenantA, adminUserA],
    );

    // BLOCKER-02検証: 未サポート年度(2025年)の計算要求が 400 Bad Request (UNSUPPORTED_TAX_YEAR) で拒絶されること
    let unsupportedYearBlocked = false;
    try {
      await yearEndService.calculate(tenantA, adminUserA, {
        employee_id: empIdA,
        tax_year: 2025,
        spouse_deduction: 0,
        dependents_count: 1,
        life_insurance_deduction: 0,
        earthquake_insurance_deduction: 0,
        housing_loan_deduction: 0,
      });
    } catch (err: any) {
      unsupportedYearBlocked = true;
      assert(
        err.errorCode === 'UNSUPPORTED_TAX_YEAR' || err.message.includes('UNSUPPORTED_TAX_YEAR') || err.status === 400,
        `サポート外年度(2025)が正常に拒絶された: ${err.message}`,
      );
    }
    assert(unsupportedYearBlocked, '未サポートtax_yearに対する400拒否が正常に機能');

    // 2026年度・扶養1人で計算実行
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

    // BLOCKER-01検証: 複数ブラケットの中から、課税所得(0円)・扶養人数(1人)・年度(2026年)に合致するブラケットIDが厳密に選ばれていること
    assert(
      yearEndAdj.applied_rate_ids.length === 1 && yearEndAdj.applied_rate_ids[0] === bracket2026Dep1LowId,
      `applied_rate_idsが実際の計算根拠ブラケット(${bracket2026Dep1LowId})と厳密に一致 (実際: ${JSON.stringify(yearEndAdj.applied_rate_ids)})`,
    );
    assert(!yearEndAdj.applied_rate_ids.includes(bracket2025Id), '他年度(2025年)のブラケットは選ばれていない');
    assert(!yearEndAdj.applied_rate_ids.includes(bracket2026Dep0Id), '異なる扶養人数(0人)のブラケットは選ばれていない');
    assert(!yearEndAdj.applied_rate_ids.includes(bracket2026Dep1HighId), '異なる所得帯(100万〜1000万)のブラケットは選ばれていない');

    // ------------------------------------------------------------------------
    // 7. 同一employee・同一tax_yearの重複計算防止 (DB UNIQUE制約) & created_by検証
    // ------------------------------------------------------------------------
    console.log('\n7. 同一employee・同一tax_yearの重複防止 (UNIQUE制約) & created_by検証...');
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
           '[]'::jsonb, 'draft', $3
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

    // year_end_adjustments.created_by テナント整合性トリガー検証 (他テナントユーザー指定の拒絶)
    let yeaCreatedByBlocked = false;
    try {
      await client.query(
        `INSERT INTO year_end_adjustments (
           tenant_id, employee_id, tax_year, annual_gross_pay, annual_taxable_pay,
           annual_social_insurance, annual_withheld_tax, deductions, total_deductions,
           taxable_income_after_deductions, final_annual_tax, adjustment_amount,
           applied_rate_ids, status, created_by
         ) VALUES (
           $1, $2, 2027, 400000, 400000,
           50000, 10000, '{}'::jsonb, 50000,
           350000, 17500, -7500,
           '[]'::jsonb, 'draft', $3
         )`,
        [tenantA, empIdA, userB], // userB は tenantB のユーザー
      );
    } catch (err: any) {
      yeaCreatedByBlocked = true;
      assert(
        err.message.includes('created_by user') && err.message.includes('is not a member of tenant'),
        `created_byテナント不整合がDBトリガーで遮断された: ${err.message}`,
      );
    }
    assert(yeaCreatedByBlocked, 'year_end_adjustments.created_by テナント整合性トリガーが正常に機能');

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
      [tenantA, roleMap['owner']],
    );

    // 申請提出 -> pending_approval
    const submittedAdj = await yearEndService.submitApproval(tenantA, adminUserA, yearEndAdj.id, {
      comment: '2026年度年末調整の申請です',
    });
    assert(submittedAdj.status === 'pending_approval', '承認申請提出により status = pending_approval に遷移した');
    assert(submittedAdj.approval_request_id !== null, 'approval_requests レコードと正しく紐付けられた');

    // 承認実行 (起票者adminUserAと異なるownerAで承認し自己承認防止トリガーを遵守)
    const arId = submittedAdj.approval_request_id!;
    await approvalService.approve(tenantA, ownerA, arId, {
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
        err.message.toLowerCase().includes('active') || err.message.includes('変更'),
        `active確定後のUPDATEがDBトリガーで拒否された: ${err.message}`,
      );
    }
    assert(wormAdjBlocked, 'active確定後の年末調整WORM不変性トリガーが正常に機能');

    // ------------------------------------------------------------------------
    // 11. employee 自身による年末調整自己確定の防止
    // ------------------------------------------------------------------------
    console.log('\n11. employee 自身による自己確定防止検証...');

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

    const adjSelfId = uuidv4();
    await client.query(
      `INSERT INTO year_end_adjustments (
         id, tenant_id, employee_id, tax_year, annual_gross_pay, annual_taxable_pay,
         annual_social_insurance, annual_withheld_tax, deductions, total_deductions,
         taxable_income_after_deductions, final_annual_tax, adjustment_amount,
         applied_rate_ids, status, created_by
       ) VALUES (
         $1, $2, $3, 2027, 400000, 400000,
         50000, 10000, '{}'::jsonb, 50000,
         350000, 17500, -7500,
         '[]'::jsonb, 'draft', $4
       )`,
      [adjSelfId, tenantA, empIdA, adminUserA],
    );

    let selfConfirmBlocked = false;
    try {
      // 従業員本人(empUserA)が自分自身の年末調整を申請して自動即時確定させようとする
      await yearEndService.submitApproval(tenantA, empUserA, adjSelfId, {});
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
