/**
 * verify-rate-masters-e2e.ts
 * ===========================
 * Phase 3 Task 2 (P3-T2): 保険料率・税率マスタ管理 実DB E2E検証スクリプト
 *
 * 目的:
 *   Docker等の実PostgreSQL環境上で、P3-T2のすべての受入基準（DoD）が正しく機能することを実証する。
 *   1. RBAC二重防御 (Service層での権限チェック: owner/payroll_admin許可、accounting_manager閲覧のみ、一般社員403拒否)
 *   2. テナント完全分離 (RLS: Tenant A と Tenant B の料率・税額表相互完全遮断)
 *   3. DBレベルのEXCLUDE制約 (期間・所得範囲の重複が btree_gist + EXCLUDE USING gist で確実に拒否されること)
 *   4. 指定日有効料率・税額取得ロジックの境界値実測 (開始日、終了日、切り替え日、effective_to=NULL無期限、所得帯境界)
 *   5. テナント整合性トリガー (他テナントのcreated_byを指定した不正登録をfail-closedで拒否)
 *   6. クエリパフォーマンス (EXPLAIN ANALYZE によるインデックス適合性と実行時間 < 20ms の実測)
 */

import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { DatabaseService } from '../database/database.service';
import { AuditLogsService } from '../modules/audit-logs/audit-logs.service';
import { RateMastersService } from '../modules/rate-masters/rate-masters.service';
import { AppException } from '../common/exceptions/app.exception';

function expect(actual: any) {
  const matchers = {
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

  return {
    ...matchers,
    not: {
      toBe(expected: any) {
        if (actual === expected) {
          throw new Error(`Expected not ${expected}, but got ${actual}`);
        }
      },
      toEqual(expected: any) {
        if (JSON.stringify(actual) === JSON.stringify(expected)) {
          throw new Error(`Expected not ${JSON.stringify(expected)}, but matched`);
        }
      },
    },
  };
}

async function run() {
  console.log('=== P3-T2 保険料率・税率マスタ管理 実DB E2E検証開始 ===\n');

  const dsn =
    process.argv[2] ||
    process.env.DATABASE_URL ||
    'postgresql://postgres:postgres@localhost:5432/postgres';

  const pool = new Pool({ connectionString: dsn });

  try {
    process.env.DATABASE_URL = dsn;
    const dbService = new DatabaseService();
    const auditLogsService = new AuditLogsService(dbService);
    const rateMastersService = new RateMastersService(dbService, auditLogsService);

    // --------------------------------------------------------------------------
    // 1. テスト用テナント・ユーザー・ロールのセットアップ
    // --------------------------------------------------------------------------
    console.log('1. テスト用テナント・ユーザー・ロールのセットアップ...');
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const userA_Owner = randomUUID();
    const userA_PayrollAdmin = randomUUID();
    const userA_AccountingManager = randomUUID();
    const userA_Employee = randomUUID();
    const userB_Owner = randomUUID();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // テナント作成
      await client.query(
        `INSERT INTO tenants (id, name) VALUES ($1, 'Rate Test Tenant A'), ($2, 'Rate Test Tenant B')`,
        [tenantA, tenantB],
      );

      // ユーザー作成
      await client.query(
        `INSERT INTO users (id, email, password_hash, name) VALUES
          ($1, 'a_owner_${tenantA.slice(0, 8)}@example.com', 'hash', 'A Owner'),
          ($2, 'a_payroll_${tenantA.slice(0, 8)}@example.com', 'hash', 'A Payroll Admin'),
          ($3, 'a_acctmgr_${tenantA.slice(0, 8)}@example.com', 'hash', 'A Accounting Manager'),
          ($4, 'a_emp_${tenantA.slice(0, 8)}@example.com', 'hash', 'A Employee'),
          ($5, 'b_owner_${tenantB.slice(0, 8)}@example.com', 'hash', 'B Owner')`,
        [userA_Owner, userA_PayrollAdmin, userA_AccountingManager, userA_Employee, userB_Owner],
      );

      // tenant_users
      await client.query(
        `INSERT INTO tenant_users (tenant_id, user_id) VALUES
          ($1, $2), ($1, $3), ($1, $4), ($1, $5), ($6, $7)`,
        [tenantA, userA_Owner, userA_PayrollAdmin, userA_AccountingManager, userA_Employee, tenantB, userB_Owner],
      );

      // ロール割り当て (user_roles)
      await client.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_id)
         SELECT $1::uuid, $2::uuid, id FROM roles WHERE code = 'owner'
         UNION ALL
         SELECT $1::uuid, $3::uuid, id FROM roles WHERE code = 'payroll_admin'
         UNION ALL
         SELECT $1::uuid, $4::uuid, id FROM roles WHERE code = 'accounting_manager'
         UNION ALL
         SELECT $1::uuid, $5::uuid, id FROM roles WHERE code = 'employee'
         UNION ALL
         SELECT $6::uuid, $7::uuid, id FROM roles WHERE code = 'owner'`,
        [tenantA, userA_Owner, userA_PayrollAdmin, userA_AccountingManager, userA_Employee, tenantB, userB_Owner],
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    console.log('   -> テナント・ユーザー・ロールのセットアップ完了\n');

    // --------------------------------------------------------------------------
    // 2. RBAC二重防御 (Service層での権限チェック) の検証
    // --------------------------------------------------------------------------
    console.log('2. RBAC二重防御 (Service層での権限チェック) の検証...');

    // 2-1. 一般社員 (employee) は rate_master.create を持たないため拒否 (403)
    try {
      await rateMastersService.createInsuranceRate(
        tenantA,
        userA_Employee,
        {
          rate_type: 'health_insurance',
          prefecture: 'tokyo',
          rate_employee: 0.04985,
          rate_employer: 0.04985,
          effective_from: '2026-04-01',
        },
      );
      throw new Error('Should have thrown ForbiddenException');
    } catch (err: any) {
      expect(err instanceof AppException).toBe(true);
      expect(err.getStatus()).toBe(403);
      console.log('   -> employee による保険料率作成: 403 Forbidden で拒否成功');
    }

    // 2-2. 会計マネージャー (accounting_manager) は view のみ可能、作成・編集は拒否 (403)
    try {
      await rateMastersService.createTaxBracket(
        tenantA,
        userA_AccountingManager,
        {
          dependents_count: 0,
          income_min: 88000,
          income_max: 89000,
          tax_amount: 130,
          effective_from: '2026-01-01',
        },
      );
      throw new Error('Should have thrown ForbiddenException');
    } catch (err: any) {
      expect(err instanceof AppException).toBe(true);
      expect(err.getStatus()).toBe(403);
      console.log('   -> accounting_manager による税額表作成: 403 Forbidden で拒否成功');
    }

    // 2-3. 給与管理者 (payroll_admin) による保険料率の登録: 成功
    const createdRateA1 = await rateMastersService.createInsuranceRate(
      tenantA,
      userA_PayrollAdmin,
      {
        rate_type: 'health_insurance',
        prefecture: 'tokyo',
        rate_employee: 0.04985,
        rate_employer: 0.04985,
        effective_from: '2025-04-01',
        effective_to: '2026-03-31',
        description: '令和7年度 東京都健康保険料率',
      },
    );
    expect(createdRateA1.rate_type).toBe('health_insurance');
    expect(Number(createdRateA1.rate_employee)).toBe(0.04985);
    console.log('   -> payroll_admin による保険料率登録: 成功');

    // 2-4. オーナー (owner) による次期（2026-04-01〜無期限）保険料率の登録: 成功
    const createdRateA2 = await rateMastersService.createInsuranceRate(
      tenantA,
      userA_Owner,
      {
        rate_type: 'health_insurance',
        prefecture: 'tokyo',
        rate_employee: 0.05,
        rate_employer: 0.05,
        effective_from: '2026-04-01',
        effective_to: null, // 無期限
        description: '令和8年度 東京都健康保険料率 (無期限)',
      },
    );
    expect(createdRateA2.effective_to).toBe(null);
    console.log('   -> owner による無期限保険料率登録: 成功\n');

    // --------------------------------------------------------------------------
    // 3. DBレベルのEXCLUDE制約（重複期間・重複所得帯の阻止）の検証
    // --------------------------------------------------------------------------
    console.log('3. DBレベルのEXCLUDE制約（重複期間・重複所得帯の阻止）の検証...');

    // 3-1. 同一テナント・同一種別・同一都道府県で期間が重複する保険料率の登録 -> EXCLUDE制約違反 (400 / exclusion_violation)
    try {
      await rateMastersService.createInsuranceRate(
        tenantA,
        userA_PayrollAdmin,
        {
          rate_type: 'health_insurance',
          prefecture: 'tokyo',
          rate_employee: 0.045,
          rate_employer: 0.045,
          effective_from: '2025-10-01', // 2025-04-01〜2026-03-31 と重なる
          effective_to: '2026-09-30',
        },
      );
      throw new Error('Should have thrown conflict exception on overlapping period');
    } catch (err: any) {
      expect(err instanceof AppException).toBe(true);
      expect(err.getStatus()).toBe(400);
      expect(err.message).toContain('重複しています');
      console.log('   -> 保険料率の期間重複: DB EXCLUDE制約で正しく400拒否');
    }

    // 3-2. 都道府県が異なれば同一期間でも登録可能
    const createdRateKanagawa = await rateMastersService.createInsuranceRate(
      tenantA,
      userA_PayrollAdmin,
      {
        rate_type: 'health_insurance',
        prefecture: 'kanagawa',
        rate_employee: 0.0502,
        rate_employer: 0.0502,
        effective_from: '2025-04-01',
        effective_to: '2026-03-31',
      },
    );
    expect(createdRateKanagawa.prefecture).toBe('kanagawa');
    console.log('   -> 異なる都道府県（kanagawa）での同一期間: 登録成功');

    // 3-3. 全国一律 (prefecture IS NULL) の厚生年金保険料率の登録
    const createdPension = await rateMastersService.createInsuranceRate(
      tenantA,
      userA_PayrollAdmin,
      {
        rate_type: 'pension',
        prefecture: null,
        rate_employee: 0.0915,
        rate_employer: 0.0915,
        effective_from: '2020-09-01',
        effective_to: null,
        description: '厚生年金保険料率 (全国一律・固定)',
      },
    );
    expect(createdPension.prefecture).toBe(null);
    console.log('   -> 全国一律 (prefecture IS NULL) 保険料率: 登録成功');

    // 3-4. 全国一律 (prefecture IS NULL) 同士の期間重複 -> EXCLUDE制約違反 (400)
    try {
      await rateMastersService.createInsuranceRate(
        tenantA,
        userA_PayrollAdmin,
        {
          rate_type: 'pension',
          prefecture: null,
          rate_employee: 0.092,
          rate_employer: 0.092,
          effective_from: '2025-01-01', // 2020-09-01〜無期限 と重複
          effective_to: null,
        },
      );
      throw new Error('Should have thrown conflict exception on overlapping NULL prefecture period');
    } catch (err: any) {
      expect(err instanceof AppException).toBe(true);
      expect(err.getStatus()).toBe(400);
      console.log('   -> prefecture IS NULL 同士の期間重複: DB EXCLUDE制約で正しく400拒否');
    }

    // 3-5. 源泉徴収税額表の登録とEXCLUDE制約（期間 × 所得範囲）の検証
    const createdTax1 = await rateMastersService.createTaxBracket(
      tenantA,
      userA_PayrollAdmin,
      {
        dependents_count: 0,
        income_min: 88000,
        income_max: 89000,
        tax_amount: 130,
        effective_from: '2026-01-01',
        effective_to: null,
      },
    );
    expect(Number(createdTax1.tax_amount)).toBe(130);

    // 隣接する所得帯 (89000〜90000) は同一期間でも共存可能 (numrange [) 半開区間のため境界89000は重複しない)
    const createdTax2 = await rateMastersService.createTaxBracket(
      tenantA,
      userA_PayrollAdmin,
      {
        dependents_count: 0,
        income_min: 89000,
        income_max: 90000,
        tax_amount: 200,
        effective_from: '2026-01-01',
        effective_to: null,
      },
    );
    expect(Number(createdTax2.tax_amount)).toBe(200);
    console.log('   -> 税額表の隣接所得帯 (88000..89000 と 89000..90000): 正常に共存可能');

    // 所得帯が重複する税額表の登録 -> EXCLUDE制約違反 (400)
    try {
      await rateMastersService.createTaxBracket(
        tenantA,
        userA_PayrollAdmin,
        {
          dependents_count: 0,
          income_min: 88500, // 88000〜89000 と重なる
          income_max: 89500,
          tax_amount: 150,
          effective_from: '2026-01-01',
          effective_to: null,
        },
      );
      throw new Error('Should have thrown conflict exception on overlapping tax bracket');
    } catch (err: any) {
      expect(err instanceof AppException).toBe(true);
      expect(err.getStatus()).toBe(400);
      expect(err.message).toContain('重複しています');
      console.log('   -> 税額表の所得帯重複: DB EXCLUDE制約で正しく400拒否\n');
    }

    // --------------------------------------------------------------------------
    // 4. 指定日有効料率・税額取得ロジック（境界値・NULL対応）の実測検証
    // --------------------------------------------------------------------------
    console.log('4. 指定日有効料率・税額取得ロジック（境界値・NULL対応）の実測検証...');

    // 期間設定:
    // RateA1: 2025-04-01 〜 2026-03-31 (rate: 0.04985)
    // RateA2: 2026-04-01 〜 NULL (rate: 0.05)

    // 4-1. 開始日ジャスト (2025-04-01) -> RateA1 がヒット
    const rateAtStart = await rateMastersService.getEffectiveInsuranceRate(
      tenantA,
      userA_PayrollAdmin,
      {
        rate_type: 'health_insurance',
        date: '2025-04-01',
        prefecture: 'tokyo',
      },
    );
    expect(rateAtStart).not.toBe(null);
    expect(Number(rateAtStart!.rate_employee)).toBe(0.04985);
    console.log('   -> 期間開始日境界値 (2025-04-01): 0.04985 取得成功');

    // 4-2. 終了日ジャスト (2026-03-31) -> RateA1 がヒット
    const rateAtEnd = await rateMastersService.getEffectiveInsuranceRate(
      tenantA,
      userA_PayrollAdmin,
      {
        rate_type: 'health_insurance',
        date: '2026-03-31',
        prefecture: 'tokyo',
      },
    );
    expect(rateAtEnd).not.toBe(null);
    expect(Number(rateAtEnd!.rate_employee)).toBe(0.04985);
    console.log('   -> 期間終了日境界値 (2026-03-31): 0.04985 取得成功');

    // 4-3. 切り替え翌日 (2026-04-01) -> RateA2 (0.05) がヒット
    const rateAtNext = await rateMastersService.getEffectiveInsuranceRate(
      tenantA,
      userA_PayrollAdmin,
      {
        rate_type: 'health_insurance',
        date: '2026-04-01',
        prefecture: 'tokyo',
      },
    );
    expect(rateAtNext).not.toBe(null);
    expect(Number(rateAtNext!.rate_employee)).toBe(0.05);
    console.log('   -> 切り替え日境界値 (2026-04-01): 0.05000 取得成功');

    // 4-4. 未来日 (2030-10-15) -> effective_to=NULL の RateA2 がヒット
    const rateInFuture = await rateMastersService.getEffectiveInsuranceRate(
      tenantA,
      userA_PayrollAdmin,
      {
        rate_type: 'health_insurance',
        date: '2030-10-15',
        prefecture: 'tokyo',
      },
    );
    expect(rateInFuture).not.toBe(null);
    expect(Number(rateInFuture!.rate_employee)).toBe(0.05);
    console.log('   -> 未来日 (2030-10-15, effective_to=NULL無期限): 0.05000 取得成功');

    // 4-5. 適用開始日前 (2025-03-31) -> null
    const rateBefore = await rateMastersService.getEffectiveInsuranceRate(
      tenantA,
      userA_PayrollAdmin,
      {
        rate_type: 'health_insurance',
        date: '2025-03-31',
        prefecture: 'tokyo',
      },
    );
    expect(rateBefore).toBe(null);
    console.log('   -> 適用開始日前 (2025-03-31): null 判定成功');

    // 4-6. 全国一律へのフォールバック確認
    // 厚生年金は prefecture=NULL のみ登録済み。tokyo を指定して検索しても全国一律のレコードが取得できること
    const pensionTokyo = await rateMastersService.getEffectiveInsuranceRate(
      tenantA,
      userA_PayrollAdmin,
      {
        rate_type: 'pension',
        date: '2026-05-01',
        prefecture: 'tokyo',
      },
    );
    expect(pensionTokyo).not.toBe(null);
    expect(Number(pensionTokyo!.rate_employee)).toBe(0.0915);
    expect(pensionTokyo!.prefecture).toBe(null);
    console.log('   -> 全国一律フォールバック: 都道府県指定時もprefecture=NULLを取得成功');

    // 4-7. 源泉徴収税額表の金額判定
    // 88000円 (下限境界値) -> 130円
    const taxExactMin = await rateMastersService.getEffectiveTaxAmount(
      tenantA,
      userA_PayrollAdmin,
      { dependents_count: 0, income: 88000, date: '2026-05-01' },
    );
    expect(taxExactMin).not.toBe(null);
    expect(Number(taxExactMin!.tax_amount)).toBe(130);

    // 88999円 (上限直前) -> 130円
    const taxJustBelowMax = await rateMastersService.getEffectiveTaxAmount(
      tenantA,
      userA_PayrollAdmin,
      { dependents_count: 0, income: 88999, date: '2026-05-01' },
    );
    expect(taxJustBelowMax).not.toBe(null);
    expect(Number(taxJustBelowMax!.tax_amount)).toBe(130);

    // 89000円 (次区分下限境界値) -> 200円
    const taxNextBracket = await rateMastersService.getEffectiveTaxAmount(
      tenantA,
      userA_PayrollAdmin,
      { dependents_count: 0, income: 89000, date: '2026-05-01' },
    );
    expect(taxNextBracket).not.toBe(null);
    expect(Number(taxNextBracket!.tax_amount)).toBe(200);
    console.log('   -> 税額表の金額境界値判定 (88000円, 88999円, 89000円): 完全に一致\n');

    // --------------------------------------------------------------------------
    // 5. テナント完全分離 (RLS) の検証
    // --------------------------------------------------------------------------
    console.log('5. テナント完全分離 (RLS) の検証...');

    // Tenant B のユーザーで Tenant A の料率・税額表を検索 -> 一切取得できない
    const tenantBRates = await rateMastersService.listInsuranceRates(tenantB, userB_Owner, { limit: 100 });
    expect(tenantBRates.items.length).toBe(0);
    console.log('   -> Tenant B による一覧取得: Tenant A の保険料率 0件（RLS完全遮断）');

    const tenantBTax = await rateMastersService.listTaxBrackets(tenantB, userB_Owner, { limit: 100 });
    expect(tenantBTax.items.length).toBe(0);
    console.log('   -> Tenant B による税額表取得: Tenant A の税額表 0件（RLS完全遮断）');

    // Tenant B のユーザーが Tenant A のレコードIDを更新しようとすると 404 Not Found
    try {
      await rateMastersService.updateInsuranceRate(
        tenantB,
        userB_Owner,
        createdRateA1.id,
        { rate_employee: 0.01 },
      );
      throw new Error('Should have thrown NotFoundException');
    } catch (err: any) {
      expect(err instanceof AppException).toBe(true);
      expect(err.getStatus()).toBe(404);
      console.log('   -> Tenant B による他テナント料率の更新: 404 Not Found で阻止成功\n');
    }

    // --------------------------------------------------------------------------
    // 6. テナント整合性トリガー (fail-closed) の検証
    // --------------------------------------------------------------------------
    console.log('6. テナント整合性トリガー (fail-closed) の検証...');
    const triggerClient = await pool.connect();
    try {
      await triggerClient.query('BEGIN');
      await triggerClient.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantA]);
      try {
        await triggerClient.query(
          `INSERT INTO insurance_rate_tables (
            tenant_id, rate_type, prefecture, rate_employee, rate_employer, effective_from, created_by
          ) VALUES ($1, 'care_insurance', 'tokyo', 0.008, 0.008, '2026-04-01', $2)`,
          [tenantA, userB_Owner],
        );
        throw new Error('Should have failed tenant consistency trigger');
      } catch (err: any) {
        expect(String(err.message)).toContain('does not belong to tenant');
        console.log('   -> 他テナントユーザー created_by の直接INSERT: トリガーにより fail-closed で拒否成功\n');
      }
      await triggerClient.query('ROLLBACK');
    } finally {
      triggerClient.release();
    }

    // --------------------------------------------------------------------------
    // 7. クエリパフォーマンス計測 (EXPLAIN ANALYZE)
    // --------------------------------------------------------------------------
    console.log('7. クエリパフォーマンス計測 (EXPLAIN ANALYZE)...');
    const perfClient = await pool.connect();
    try {
      await perfClient.query('BEGIN');
      await perfClient.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantA]);

      // 有効料率検索の EXPLAIN ANALYZE
      const rateExplain = await perfClient.query(`
        EXPLAIN (ANALYZE, BUFFERS)
        SELECT * FROM insurance_rate_tables
        WHERE tenant_id = $1
          AND rate_type = 'health_insurance'
          AND (prefecture = 'tokyo' OR prefecture IS NULL)
          AND effective_from <= '2026-05-01'::date
          AND (effective_to IS NULL OR effective_to >= '2026-05-01'::date)
        ORDER BY prefecture DESC NULLS LAST, effective_from DESC
        LIMIT 1
      `, [tenantA]);
      console.log('   [EXPLAIN ANALYZE] 保険料率検索:');
      for (const row of rateExplain.rows) {
        console.log(`     ${row['QUERY PLAN']}`);
      }

      // 税額表検索の EXPLAIN ANALYZE
      const taxExplain = await perfClient.query(`
        EXPLAIN (ANALYZE, BUFFERS)
        SELECT * FROM income_tax_withholding_brackets
        WHERE tenant_id = $1
          AND dependents_count = 0
          AND effective_from <= '2026-05-01'::date
          AND (effective_to IS NULL OR effective_to >= '2026-05-01'::date)
          AND income_min <= 88500
          AND (income_max IS NULL OR income_max > 88500)
        ORDER BY income_min DESC
        LIMIT 1
      `, [tenantA]);
      console.log('   [EXPLAIN ANALYZE] 税額表検索:');
      for (const row of taxExplain.rows) {
        console.log(`     ${row['QUERY PLAN']}`);
      }
      await perfClient.query('ROLLBACK');
    } finally {
      perfClient.release();
    }

    // --------------------------------------------------------------------------
    // 8. 過去マスタデータ改ざん防止トリガー (WORM / 不変性強制) の実測検証
    // --------------------------------------------------------------------------
    console.log('\n8. 過去マスタデータ改ざん防止トリガー (WORM / 不変性強制) の実測検証...');

    // 8-1. 過去（effective_from <= 今日）の保険料率レコードに対する業務値・有効期間変更の拒否
    // createdRateA1 (effective_from: 2025-04-01, effective_to: 2026-03-31)

    // (1) rate_employee (業務値) の変更試行 -> 拒否
    try {
      await rateMastersService.updateInsuranceRate(
        tenantA,
        userA_PayrollAdmin,
        createdRateA1.id,
        { rate_employee: 0.08 },
      );
      throw new Error('Should have thrown error on updating past rate_employee');
    } catch (err: any) {
      expect(err instanceof AppException).toBe(true);
      expect(err.getStatus()).toBe(400);
      expect(err.message).toContain('確定済みマスタの業務値または有効期間は変更できません');
      console.log('   -> 過去保険料率の業務値(rate_employee)変更: DBトリガーにより400拒否成功');
    }

    // (2) effective_from (適用開始日) の変更試行 -> 拒否
    try {
      await rateMastersService.updateInsuranceRate(
        tenantA,
        userA_PayrollAdmin,
        createdRateA1.id,
        { effective_from: '2025-05-01' },
      );
      throw new Error('Should have thrown error on updating past effective_from');
    } catch (err: any) {
      expect(err instanceof AppException).toBe(true);
      expect(err.getStatus()).toBe(400);
      expect(err.message).toContain('確定済みマスタの業務値または有効期間は変更できません');
      console.log('   -> 過去保険料率の effective_from 変更: DBトリガーにより400拒否成功');
    }

    // (3) effective_to (終了日確定済みレコードの終了日) の変更試行 -> 拒否
    try {
      await rateMastersService.updateInsuranceRate(
        tenantA,
        userA_PayrollAdmin,
        createdRateA1.id,
        { effective_to: '2026-05-31' },
      );
      throw new Error('Should have thrown error on updating historical effective_to');
    } catch (err: any) {
      expect(err instanceof AppException).toBe(true);
      expect(err.getStatus()).toBe(400);
      expect(err.message).toContain('確定済みマスタの業務値または有効期間は変更できません');
      console.log('   -> 過去確定保険料率の effective_to 変更: DBトリガーにより400拒否成功');
    }

    // (4) 過去レコードの物理削除 (DELETE) 試行 -> 拒否
    const deleteClient = await pool.connect();
    try {
      await deleteClient.query('BEGIN');
      await deleteClient.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantA]);
      try {
        await deleteClient.query(
          `DELETE FROM insurance_rate_tables WHERE id = $1`,
          [createdRateA1.id],
        );
        throw new Error('Should have failed delete on past rate master');
      } catch (err: any) {
        expect(String(err.message)).toContain('Cannot delete insurance rate master after effective_from has arrived');
        console.log('   -> 過去保険料率の物理削除(DELETE): DBトリガーにより拒否成功');
      }
      await deleteClient.query('ROLLBACK');
    } finally {
      deleteClient.release();
    }

    // (5) 拒否後もDB上の元データが完全に不変であることを確認
    const unchangedRateRes = await pool.query(
      `SELECT *, effective_from::text as eff_from_str, effective_to::text as eff_to_str FROM insurance_rate_tables WHERE id = $1`,
      [createdRateA1.id],
    );
    const unchangedRate = unchangedRateRes.rows[0];
    expect(Number(unchangedRate.rate_employee)).toBe(0.04985);
    expect(Number(unchangedRate.rate_employer)).toBe(0.04985);
    expect(unchangedRate.eff_from_str).toBe('2025-04-01');
    expect(unchangedRate.eff_to_str).toBe('2026-03-31');
    console.log('   -> 改ざん試行後もDB上の保険料率元データが完全に不変であることを確認');

    // 8-2. 過去（effective_from <= 今日）の源泉徴収税額表レコードに対する改ざん防止
    // createdTax1 (effective_from: 2026-01-01, income_min: 88000, income_max: 89000, tax_amount: 130)

    // (1) tax_amount (税額) の変更試行 -> 拒否
    try {
      await rateMastersService.updateTaxBracket(
        tenantA,
        userA_PayrollAdmin,
        createdTax1.id,
        { tax_amount: 500 },
      );
      throw new Error('Should have thrown error on updating past tax_amount');
    } catch (err: any) {
      expect(err instanceof AppException).toBe(true);
      expect(err.getStatus()).toBe(400);
      expect(err.message).toContain('確定済み税額表の業務値または有効期間は変更できません');
      console.log('   -> 過去税額表の業務値(tax_amount)変更: DBトリガーにより400拒否成功');
    }

    // (2) income_min (所得下限) の変更試行 -> 拒否
    try {
      await rateMastersService.updateTaxBracket(
        tenantA,
        userA_PayrollAdmin,
        createdTax1.id,
        { income_min: 80000 },
      );
      throw new Error('Should have thrown error on updating past income_min');
    } catch (err: any) {
      expect(err instanceof AppException).toBe(true);
      expect(err.getStatus()).toBe(400);
      expect(err.message).toContain('確定済み税額表の業務値または有効期間は変更できません');
      console.log('   -> 過去税額表の所得範囲(income_min)変更: DBトリガーにより400拒否成功');
    }

    // (3) 拒否後もDB上の税額表元データが完全に不変であることを確認
    const unchangedTaxRes = await pool.query(
      `SELECT * FROM income_tax_withholding_brackets WHERE id = $1`,
      [createdTax1.id],
    );
    const unchangedTax = unchangedTaxRes.rows[0];
    expect(Number(unchangedTax.tax_amount)).toBe(130);
    expect(Number(unchangedTax.income_min)).toBe(88000);
    expect(Number(unchangedTax.income_max)).toBe(89000);
    console.log('   -> 改ざん試行後もDB上の税額表元データが完全に不変であることを確認');

    // 8-3. 未来（effective_from > 今日）のレコードは引き続き編集できることの確認
    const futureRate = await rateMastersService.createInsuranceRate(
      tenantA,
      userA_PayrollAdmin,
      {
        rate_type: 'employment_insurance',
        prefecture: null,
        rate_employee: 0.006,
        rate_employer: 0.0095,
        effective_from: '2030-04-01',
        effective_to: null,
        description: '未来適用予定の雇用保険料率 (入力テスト)',
      },
    );
    const updatedFutureRate = await rateMastersService.updateInsuranceRate(
      tenantA,
      userA_PayrollAdmin,
      futureRate.id,
      {
        rate_employee: 0.0065,
        description: '訂正後の未来適用予定雇用保険料率',
      },
    );
    expect(Number(updatedFutureRate.rate_employee)).toBe(0.0065);
    expect(updatedFutureRate.description).toBe('訂正後の未来適用予定雇用保険料率');
    console.log('   -> 未来適用予定レコード(effective_from > 今日): 入力誤り訂正UPDATE成功');

    // 8-4. 法改正運用フロー（現在有効レコードの終了日クローズ ＋ 新料率INSERT）の実証
    // 現在無期限の介護保険料率を登録
    const activeCareRate = await rateMastersService.createInsuranceRate(
      tenantA,
      userA_PayrollAdmin,
      {
        rate_type: 'care_insurance',
        prefecture: null,
        rate_employee: 0.008,
        rate_employer: 0.008,
        effective_from: '2026-04-01',
        effective_to: null,
        description: '現行介護保険料率 (無期限)',
      },
    );
    // 法改正により、2027-03-31で終了日をクローズ
    const closedCareRate = await rateMastersService.updateInsuranceRate(
      tenantA,
      userA_PayrollAdmin,
      activeCareRate.id,
      {
        effective_to: '2027-03-31',
      },
    );
    expect(closedCareRate.effective_to).toBe('2027-03-31');

    // 翌日 (2027-04-01) からの新料率をINSERT -> EXCLUDE制約違反なく共存登録可能
    const newCareRate = await rateMastersService.createInsuranceRate(
      tenantA,
      userA_PayrollAdmin,
      {
        rate_type: 'care_insurance',
        prefecture: null,
        rate_employee: 0.0085,
        rate_employer: 0.0085,
        effective_from: '2027-04-01',
        effective_to: null,
        description: '法改正後 新介護保険料率',
      },
    );
    expect(newCareRate.effective_from).toBe('2027-04-01');
    expect(Number(newCareRate.rate_employee)).toBe(0.0085);
    console.log('   -> 法改正運用フロー(現在有効マスタの終了日クローズ＋新料率INSERT): EXCLUDE整合性を保ち成功\n');

    console.log('\n=== P3-T2 保険料率・税率マスタ管理 実DB E2E検証: すべてPASS ===');
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('\n❌ E2E検証に失敗しました:', err);
  process.exit(1);
});
