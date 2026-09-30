/**
 * verify-role-permissions-fix-e2e.ts
 * ==================================
 * migration 036 (role_permissions紐付け修正 & テーブルGRANT付与) の
 * 実DBでの効果と整合性を厳密に実証するE2E検証スクリプト。
 *
 * 検証シナリオ:
 *   [フェーズ1] 036未適用状態(Before):
 *     - accounting_manager が経費申請を承認しようとすると、DBトリガー
 *       trg_enforce_approval_history_authority により 42501 (does not hold required permission expense_report.approve)
 *       で拒否されることを実証。
 *     - owner が仕訳確定(journal_entry)を承認しようとすると、同様に 42501 (journal_entry.post)
 *       で拒否されることを実証。
 *   [フェーズ2] 036適用状態(After):
 *     - 036の適用(25組のrole_permissions登録)後、上記2つの承認操作がいずれも成功することを実証。
 *   [フェーズ3] GRANT検証:
 *     - app_runtime ロール接続下で、payslips および year_end_adjustments テーブルに対する
 *       SELECT / INSERT / UPDATE / DELETE が権限エラーなく正常実行できることを実証。
 */

import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

let totalAssertions = 0;
function assert(condition: boolean, message: string): void {
  totalAssertions++;
  if (!condition) {
    console.error(`  [FAIL] Assertion failed: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  [PASS] ${message}`);
}

async function main(): Promise<void> {
  const dsn = process.argv[2] || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/keiri_kaikei';
  console.log(`=== migration 036 実DB Before/After & GRANT E2E実証テスト開始 ===`);
  console.log(`接続先: ${dsn.replace(/:[^:@]+@/, ':****@')}\n`);

  const adminClient = new Client({ connectionString: dsn });
  await adminClient.connect();

  const tenantId = randomUUID();
  const employeeUserId = randomUUID();
  const managerUserId = randomUUID();
  const ownerUserId = randomUUID();

  try {
    // ------------------------------------------------------------------------
    // セットアップ: テスト用テナント、ユーザー、ロール割当
    // ------------------------------------------------------------------------
    console.log('[セットアップ] テスト用テナントおよびユーザー・ロールの作成...');
    await adminClient.query(
      `INSERT INTO tenants (id, name, created_at, updated_at) VALUES ($1, '036-verify-tenant', now(), now())`,
      [tenantId],
    );

    await adminClient.query(
      `INSERT INTO users (id, email, password_hash, name, created_at, updated_at) VALUES
       ($1, $4, 'hash', '社員', now(), now()),
       ($2, $5, 'hash', '経理責任者', now(), now()),
       ($3, $6, 'hash', '代表取締役', now(), now())`,
      [
        employeeUserId,
        managerUserId,
        ownerUserId,
        `emp_${tenantId.slice(0, 8)}@example.com`,
        `mgr_${tenantId.slice(0, 8)}@example.com`,
        `owner_${tenantId.slice(0, 8)}@example.com`,
      ],
    );

    await adminClient.query(
      `INSERT INTO tenant_users (tenant_id, user_id) VALUES
       ($1, $2), ($1, $3), ($1, $4)`,
      [tenantId, employeeUserId, managerUserId, ownerUserId],
    );

    // ロール割当 (employee, accounting_manager, owner)
    await adminClient.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id)
       SELECT $1::uuid, $2::uuid, id FROM roles WHERE code = 'employee'
       UNION ALL
       SELECT $1::uuid, $3::uuid, id FROM roles WHERE code = 'accounting_manager'
       UNION ALL
       SELECT $1::uuid, $4::uuid, id FROM roles WHERE code = 'owner'`,
      [tenantId, employeeUserId, managerUserId, ownerUserId],
    );
    console.log('  セットアップ完了 (tenant, users, roles)\n');

    // ========================================================================
    // [フェーズ1] 036適用前 (Before) の拒絶実証
    // ========================================================================
    console.log('--- [フェーズ1: Before] 036未適用状態での認可拒絶 (42501) 実証 ---');

    // 036で登録される25組を一時的に退避/削除して035時点の状態を再現
    await adminClient.query(`
      DELETE FROM role_permissions rp
      USING roles r, permissions p
      WHERE rp.role_id = r.id AND rp.permission_id = p.id
        AND (
          (r.code = 'owner' AND p.code IN ('journal_entry.create', 'journal_entry.post', 'journal_entry.void', 'invoice.issue', 'vendor_bill.approve', 'payment_batch.export', 'expense_report.approve', 'payroll.import', 'tax_return.finalize'))
          OR (r.code = 'accounting_manager' AND p.code IN ('journal_entry.create', 'journal_entry.post', 'journal_entry.void', 'invoice.issue', 'vendor_bill.approve', 'payment_batch.export', 'expense_report.approve', 'payroll.import', 'tax_return.finalize'))
          OR (r.code = 'accountant' AND p.code IN ('journal_entry.create', 'invoice.issue', 'payment_batch.export'))
          OR (r.code = 'bookkeeper' AND p.code IN ('journal_entry.create'))
          OR (r.code = 'approver' AND p.code IN ('expense_report.approve', 'vendor_bill.approve'))
          OR (r.code = 'payroll_admin' AND p.code IN ('payroll.import'))
        )
    `);

    // 1-1. 経費申請の承認試行 (accounting_manager)
    const expenseReqId = randomUUID();
    const expenseTargetId = randomUUID();
    await adminClient.query(
      `INSERT INTO approval_requests (id, tenant_id, target_type, target_id, submitted_by, total_steps, current_step, status)
       VALUES ($1, $2, 'expense_report', $3, $4, 1, 1, 'pending')`,
      [expenseReqId, tenantId, expenseTargetId, employeeUserId],
    );

    let expenseBeforeRejected = false;
    let expenseBeforeErrorCode = '';
    let expenseBeforeErrorMsg = '';
    try {
      await adminClient.query(
        `INSERT INTO approval_history (tenant_id, approval_request_id, step_number, approver_id, action, comment)
         VALUES ($1, $2, 1, $3, 'approve', 'Before承認試行')`,
        [tenantId, expenseReqId, managerUserId],
      );
    } catch (e: any) {
      expenseBeforeRejected = true;
      expenseBeforeErrorCode = e.code;
      expenseBeforeErrorMsg = e.message;
    }

    assert(expenseBeforeRejected, '036未適用時: accounting_manager による経費精算承認が拒否されること');
    assert(expenseBeforeErrorCode === '42501', `036未適用時: エラーコードが 42501 (insufficient_privilege) であること (actual: ${expenseBeforeErrorCode})`);
    assert(
      expenseBeforeErrorMsg.includes('does not hold required permission expense_report.approve'),
      `036未適用時: エラーメッセージに expense_report.approve 不足が明示されること (actual: ${expenseBeforeErrorMsg})`,
    );

    // 1-2. 仕訳確定の承認試行 (owner)
    const jeReqId = randomUUID();
    const jeTargetId = randomUUID();
    await adminClient.query(
      `INSERT INTO approval_requests (id, tenant_id, target_type, target_id, submitted_by, total_steps, current_step, status)
       VALUES ($1, $2, 'journal_entry', $3, $4, 1, 1, 'pending')`,
      [jeReqId, tenantId, jeTargetId, employeeUserId],
    );

    let jeBeforeRejected = false;
    let jeBeforeErrorCode = '';
    let jeBeforeErrorMsg = '';
    try {
      await adminClient.query(
        `INSERT INTO approval_history (tenant_id, approval_request_id, step_number, approver_id, action, comment)
         VALUES ($1, $2, 1, $3, 'approve', 'Before仕訳承認試行')`,
        [tenantId, jeReqId, ownerUserId],
      );
    } catch (e: any) {
      jeBeforeRejected = true;
      jeBeforeErrorCode = e.code;
      jeBeforeErrorMsg = e.message;
    }

    assert(jeBeforeRejected, '036未適用時: owner による仕訳確定承認が拒否されること');
    assert(jeBeforeErrorCode === '42501', `036未適用時: エラーコードが 42501 であること (actual: ${jeBeforeErrorCode})`);
    assert(
      jeBeforeErrorMsg.includes('does not hold required permission journal_entry.post'),
      `036未適用時: エラーメッセージに journal_entry.post 不足が明示されること (actual: ${jeBeforeErrorMsg})`,
    );

    // ========================================================================
    // [フェーズ2] 036適用 (After) の承認成功実証
    // ========================================================================
    console.log('\n--- [フェーズ2: After] 036適用後の承認認可成功実証 ---');

    // 036_role_permissions_and_grants_fix.sql を実行して適用
    const sql036Path = path.resolve(__dirname, '../../../sql/036_role_permissions_and_grants_fix.sql');
    const sql036 = fs.readFileSync(sql036Path, 'utf8');
    await adminClient.query(sql036);
    console.log('  sql/036_role_permissions_and_grants_fix.sql 適用完了');

    // 2-1. 経費申請の承認再試行 (accounting_manager)
    await adminClient.query(
      `INSERT INTO approval_history (tenant_id, approval_request_id, step_number, approver_id, action, comment)
       VALUES ($1, $2, 1, $3, 'approve', 'After承認成功検証')`,
      [tenantId, expenseReqId, managerUserId],
    );

    const expenseHistCheck = await adminClient.query(
      `SELECT action, approver_id FROM approval_history WHERE tenant_id = $1 AND approval_request_id = $2`,
      [tenantId, expenseReqId],
    );
    assert(expenseHistCheck.rowCount === 1, '036適用後: accounting_manager による経費精算承認履歴が正常に記録されること');
    assert(expenseHistCheck.rows[0].action === 'approve', '036適用後: 記録されたアクションが approve であること');

    // 2-2. 仕訳確定の承認再試行 (owner)
    await adminClient.query(
      `INSERT INTO approval_history (tenant_id, approval_request_id, step_number, approver_id, action, comment)
       VALUES ($1, $2, 1, $3, 'approve', 'After仕訳承認成功検証')`,
      [tenantId, jeReqId, ownerUserId],
    );

    const jeHistCheck = await adminClient.query(
      `SELECT action, approver_id FROM approval_history WHERE tenant_id = $1 AND approval_request_id = $2`,
      [tenantId, jeReqId],
    );
    assert(jeHistCheck.rowCount === 1, '036適用後: owner による仕訳確定承認履歴が正常に記録されること');
    assert(jeHistCheck.rows[0].action === 'approve', '036適用後: 記録されたアクションが approve であること');

    // ========================================================================
    // [フェーズ3] app_runtime による payslips / year_end_adjustments の GRANT 実証
    // ========================================================================
    console.log('\n--- [フェーズ3: GRANT検証] app_runtime による CRUD 実証 ---');

    // 3-0. システム権限関数 has_table_privilege による検証
    const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
    for (const table of ['payslips', 'year_end_adjustments']) {
      for (const priv of privileges) {
        const res = await adminClient.query(
          `SELECT has_table_privilege('app_runtime', $1, $2) AS granted`,
          [table, priv],
        );
        assert(
          res.rows[0].granted === true,
          `app_runtime: ${table} に対する ${priv} 権限が付与されていること`,
        );
      }
      const readonlyRes = await adminClient.query(
        `SELECT has_table_privilege('app_readonly_external', $1, 'SELECT') AS can_select,
                has_table_privilege('app_readonly_external', $1, 'INSERT') AS can_insert`,
        [table],
      );
      assert(
        readonlyRes.rows[0].can_select === true && readonlyRes.rows[0].can_insert === false,
        `app_readonly_external: ${table} に対する SELECT 権限のみ付与され、INSERT は拒絶されること`,
      );
    }

    // 3-1. 外部キー依存データの作成 (adminClient にて作成)
    const periodId = randomUUID();
    const employeeId = randomUUID();
    const calculationId = randomUUID();

    await adminClient.query(
      `INSERT INTO payroll_periods (id, tenant_id, name, period_start, period_end, payment_date, status)
       VALUES ($1, $2, '2026-04期', '2026-04-01', '2026-04-30', '2026-04-25', 'draft')`,
      [periodId, tenantId],
    );

    await adminClient.query(
      `INSERT INTO employees (id, tenant_id, user_id, employee_no, name, hire_date)
       VALUES ($1, $2, $3, 'EMP-036', 'テスト従業員', '2026-01-01')`,
      [employeeId, tenantId, employeeUserId],
    );

    await adminClient.query(
      `INSERT INTO payroll_calculations (id, tenant_id, payroll_period_id, employee_id, created_by, status)
       VALUES ($1, $2, $3, $4, $5, 'draft')`,
      [calculationId, tenantId, periodId, employeeId, employeeUserId],
    );

    // 3-2. app_runtime ロールに切り替えて実クエリ検証
    await adminClient.query(`SET ROLE app_runtime;`);
    await adminClient.query(`SET app.current_tenant_id = '${tenantId}';`);

    const payslipId = randomUUID();
    const yeaId = randomUUID();

    // payslips CRUD
    await adminClient.query(
      `INSERT INTO payslips (
         id, tenant_id, payroll_calculation_id, employee_id, payroll_period, payment_date, created_by, status
       ) VALUES ($1, $2, $3, $4, '2026-04', '2026-04-25', $5, 'draft')`,
      [payslipId, tenantId, calculationId, employeeId, employeeUserId],
    );
    console.log('  app_runtime: payslips INSERT 成功');

    const payslipSelect = await adminClient.query(`SELECT id, status FROM payslips WHERE id = $1`, [payslipId]);
    assert(payslipSelect.rowCount === 1, 'app_runtime: payslips SELECT が正常実行できること');

    await adminClient.query(`UPDATE payslips SET updated_at = now() WHERE id = $1`, [payslipId]);
    console.log('  app_runtime: payslips UPDATE 成功');

    await adminClient.query(`DELETE FROM payslips WHERE id = $1`, [payslipId]);
    console.log('  app_runtime: payslips DELETE 成功');
    assert(true, 'app_runtime: payslips に対する CRUD (SELECT/INSERT/UPDATE/DELETE) 実クエリが正常動作すること');

    // year_end_adjustments CRUD
    await adminClient.query(
      `INSERT INTO year_end_adjustments (
         id, tenant_id, employee_id, tax_year, created_by, status
       ) VALUES ($1, $2, $3, 2026, $4, 'draft')`,
      [yeaId, tenantId, employeeId, employeeUserId],
    );
    console.log('  app_runtime: year_end_adjustments INSERT 成功');

    const yeaSelect = await adminClient.query(`SELECT id, status FROM year_end_adjustments WHERE id = $1`, [yeaId]);
    assert(yeaSelect.rowCount === 1, 'app_runtime: year_end_adjustments SELECT が正常実行できること');

    await adminClient.query(`UPDATE year_end_adjustments SET updated_at = now() WHERE id = $1`, [yeaId]);
    console.log('  app_runtime: year_end_adjustments UPDATE 成功');

    await adminClient.query(`DELETE FROM year_end_adjustments WHERE id = $1`, [yeaId]);
    console.log('  app_runtime: year_end_adjustments DELETE 成功');
    assert(true, 'app_runtime: year_end_adjustments に対する CRUD 実クエリが正常動作すること');

    // ロールを元に戻す
    await adminClient.query(`RESET ROLE;`);

    // ========================================================================
    // クリーンアップ
    // ========================================================================
    console.log('\n[クリーンアップ] テストデータの削除...');
    await adminClient.query(`DELETE FROM payslips WHERE tenant_id = $1`, [tenantId]);
    await adminClient.query(`DELETE FROM year_end_adjustments WHERE tenant_id = $1`, [tenantId]);
    await adminClient.query(`DELETE FROM payroll_calculations WHERE tenant_id = $1`, [tenantId]);
    await adminClient.query(`DELETE FROM employees WHERE tenant_id = $1`, [tenantId]);
    await adminClient.query(`DELETE FROM payroll_periods WHERE tenant_id = $1`, [tenantId]);
    await adminClient.query(`ALTER TABLE approval_history DISABLE TRIGGER USER;`);
    try {
      await adminClient.query(`DELETE FROM approval_history WHERE tenant_id = $1`, [tenantId]);
    } finally {
      await adminClient.query(`ALTER TABLE approval_history ENABLE TRIGGER USER;`);
    }
    await adminClient.query(`DELETE FROM approval_requests WHERE tenant_id = $1`, [tenantId]);
    await adminClient.query(`DELETE FROM user_roles WHERE tenant_id = $1`, [tenantId]);
    await adminClient.query(`DELETE FROM tenant_users WHERE tenant_id = $1`, [tenantId]);
    await adminClient.query(`DELETE FROM users WHERE id IN ($1, $2, $3)`, [employeeUserId, managerUserId, ownerUserId]);
    await adminClient.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    console.log('  クリーンアップ完了\n');

    console.log(`======================================================================`);
    console.log(`migration 036 実DB E2E検証: 全 ${totalAssertions} 項目合格 (ALL PASS)`);
    console.log(`======================================================================\n`);
  } finally {
    await adminClient.end();
  }
}

main().catch((err) => {
  console.error('\n[FATAL ERROR in verify-role-permissions-fix-e2e]:', err);
  process.exit(1);
});
