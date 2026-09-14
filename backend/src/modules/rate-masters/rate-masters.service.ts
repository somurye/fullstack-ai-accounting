import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import {
  InsuranceRateCreateInput,
  InsuranceRateUpdateInput,
  InsuranceRateListQuery,
  InsuranceRateEffectiveQuery,
  InsuranceRateDto,
  TaxBracketCreateInput,
  TaxBracketBulkCreateInput,
  TaxBracketUpdateInput,
  TaxBracketListQuery,
  TaxBracketEffectiveQuery,
  TaxBracketDto,
} from './dto/rate-masters.schemas';

interface InsuranceRateRow {
  id: string;
  tenant_id: string;
  rate_type: string;
  prefecture: string | null;
  rate_employee: string | number;
  rate_employer: string | number;
  effective_from: string | Date;
  effective_to: string | Date | null;
  description: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

interface TaxBracketRow {
  id: string;
  tenant_id: string;
  dependents_count: number;
  income_min: string | number;
  income_max: string | number | null;
  tax_amount: string | number;
  effective_from: string | Date;
  effective_to: string | Date | null;
  description: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

function toDateString(val: string | Date | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    const year = val.getFullYear();
    const month = String(val.getMonth() + 1).padStart(2, '0');
    const day = String(val.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(val).split('T')[0]!;
}

function mapInsuranceRateRow(row: InsuranceRateRow): InsuranceRateDto {
  const employee = Number(row.rate_employee);
  const employer = Number(row.rate_employer);
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    rate_type: row.rate_type,
    prefecture: row.prefecture,
    rate_employee: employee,
    rate_employer: employer,
    rate_total: Math.round((employee + employer + Number.EPSILON) * 100000) / 100000,
    effective_from: toDateString(row.effective_from)!,
    effective_to: toDateString(row.effective_to),
    description: row.description,
    created_by: row.created_by,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function mapTaxBracketRow(row: TaxBracketRow): TaxBracketDto {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    dependents_count: Number(row.dependents_count),
    income_min: Number(row.income_min),
    income_max: row.income_max !== null ? Number(row.income_max) : null,
    tax_amount: Number(row.tax_amount),
    effective_from: toDateString(row.effective_from)!,
    effective_to: toDateString(row.effective_to),
    description: row.description,
    created_by: row.created_by,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

@Injectable()
export class RateMastersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * Service層での二重RBAC認可チェック (多層防御)
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

    const res = await client.query(
      `SELECT 1
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE ur.tenant_id = $1 AND ur.user_id = $2 AND p.code = $3
       LIMIT 1`,
      [tenantId, userId, permissionCode],
    );

    if ((res.rowCount ?? 0) === 0) {
      throw AppException.forbidden(`権限 '${permissionCode}' が必要です`);
    }
  }

  // ==========================================================================
  // 社会保険料率マスタ (insurance_rate_tables)
  // ==========================================================================

  /**
   * 社会保険料率の新規登録
   */
  async createInsuranceRate(
    tenantId: string,
    userId: string | null,
    input: InsuranceRateCreateInput,
  ): Promise<InsuranceRateDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'rate_master.create');

      try {
        const res = await client.query<InsuranceRateRow>(
          `INSERT INTO insurance_rate_tables (
             tenant_id, rate_type, prefecture, rate_employee, rate_employer,
             effective_from, effective_to, description, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            tenantId,
            input.rate_type,
            input.prefecture ?? null,
            input.rate_employee,
            input.rate_employer,
            input.effective_from,
            input.effective_to ?? null,
            input.description ?? null,
            userId,
          ],
        );

        const created = res.rows[0]!;
        await this.auditLogs.record(client, tenantId, {
          actorUserId: userId,
          action: 'rate_master.insurance_rate.created',
          targetType: 'insurance_rate_table',
          targetId: created.id,
          afterData: {
            rate_type: created.rate_type,
            prefecture: created.prefecture,
            effective_from: created.effective_from,
            effective_to: created.effective_to,
          },
        });

        return mapInsuranceRateRow(created);
      } catch (err: any) {
        if (err.code === '23P01') {
          // exclusion_violation
          throw AppException.badRequest(
            '同一料率種別・都道府県において有効期間が既存のマスタデータと重複しています',
          );
        }
        throw err;
      }
    });
  }

  /**
   * 社会保険料率の更新
   */
  async updateInsuranceRate(
    tenantId: string,
    userId: string | null,
    id: string,
    input: InsuranceRateUpdateInput,
  ): Promise<InsuranceRateDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'rate_master.edit');

      const existingRes = await client.query<InsuranceRateRow>(
        `SELECT * FROM insurance_rate_tables WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, id],
      );
      const existing = existingRes.rows[0];
      if (!existing) {
        throw AppException.notFound('指定された保険料率マスタが見つかりません');
      }

      const prefecture = input.prefecture !== undefined ? input.prefecture : existing.prefecture;
      const rateEmployee = input.rate_employee !== undefined ? input.rate_employee : existing.rate_employee;
      const rateEmployer = input.rate_employer !== undefined ? input.rate_employer : existing.rate_employer;
      const effectiveFrom = input.effective_from !== undefined ? input.effective_from : existing.effective_from;
      const effectiveTo = input.effective_to !== undefined ? input.effective_to : existing.effective_to;
      const description = input.description !== undefined ? input.description : existing.description;

      try {
        const res = await client.query<InsuranceRateRow>(
          `UPDATE insurance_rate_tables
           SET prefecture = $3,
               rate_employee = $4,
               rate_employer = $5,
               effective_from = $6,
               effective_to = $7,
               description = $8,
               updated_at = now()
           WHERE tenant_id = $1 AND id = $2
           RETURNING *`,
          [
            tenantId,
            id,
            prefecture ?? null,
            rateEmployee,
            rateEmployer,
            effectiveFrom,
            effectiveTo ?? null,
            description ?? null,
          ],
        );

        const updated = res.rows[0]!;
        await this.auditLogs.record(client, tenantId, {
          actorUserId: userId,
          action: 'rate_master.insurance_rate.updated',
          targetType: 'insurance_rate_table',
          targetId: updated.id,
          beforeData: {
            rate_employee: existing.rate_employee,
            rate_employer: existing.rate_employer,
            effective_from: existing.effective_from,
            effective_to: existing.effective_to,
          },
          afterData: {
            rate_employee: updated.rate_employee,
            rate_employer: updated.rate_employer,
            effective_from: updated.effective_from,
            effective_to: updated.effective_to,
          },
        });

        return mapInsuranceRateRow(updated);
      } catch (err: any) {
        if (err.code === '23P01') {
          throw AppException.badRequest(
            '同一料率種別・都道府県において有効期間が既存のマスタデータと重複しています',
          );
        }
        throw err;
      }
    });
  }

  /**
   * 社会保険料率の一覧取得
   */
  async listInsuranceRates(
    tenantId: string,
    userId: string | null,
    query: InsuranceRateListQuery,
  ): Promise<{ items: InsuranceRateDto[]; total: number; page: number; limit: number }> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'rate_master.view');

      const page = query.page ?? 1;
      const limit = query.limit ?? 20;
      const offset = (page - 1) * limit;

      const whereClauses: string[] = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];
      let paramIdx = 2;

      if (query.rate_type) {
        whereClauses.push(`rate_type = $${paramIdx++}`);
        params.push(query.rate_type);
      }

      if (query.prefecture) {
        whereClauses.push(`prefecture = $${paramIdx++}`);
        params.push(query.prefecture);
      }

      if (query.effective_date) {
        whereClauses.push(
          `effective_from <= $${paramIdx} AND (effective_to IS NULL OR effective_to >= $${paramIdx})`,
        );
        params.push(query.effective_date);
        paramIdx++;
      }

      const whereSql = whereClauses.join(' AND ');

      const countRes = await client.query<{ count: string }>(
        `SELECT count(*) as count FROM insurance_rate_tables WHERE ${whereSql}`,
        params,
      );
      const total = parseInt(countRes.rows[0]?.count ?? '0', 10);

      const itemsRes = await client.query<InsuranceRateRow>(
        `SELECT * FROM insurance_rate_tables
         WHERE ${whereSql}
         ORDER BY rate_type ASC, prefecture ASC NULLS FIRST, effective_from DESC
         LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        [...params, limit, offset],
      );

      return {
        items: itemsRes.rows.map(mapInsuranceRateRow),
        total,
        page,
        limit,
      };
    });
  }

  /**
   * 指定日時点で有効な社会保険料率を取得
   */
  async getEffectiveInsuranceRate(
    tenantId: string,
    userId: string | null,
    query: InsuranceRateEffectiveQuery,
  ): Promise<InsuranceRateDto | null> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'rate_master.view');

      const whereClauses: string[] = [
        'tenant_id = $1',
        'rate_type = $2',
        'effective_from <= $3',
        '(effective_to IS NULL OR effective_to >= $3)',
      ];
      const params: unknown[] = [tenantId, query.rate_type, query.date];

      if (query.prefecture) {
        whereClauses.push('(prefecture = $4 OR prefecture IS NULL)');
        params.push(query.prefecture);
      } else {
        whereClauses.push('prefecture IS NULL');
      }

      const res = await client.query<InsuranceRateRow>(
        `SELECT * FROM insurance_rate_tables
         WHERE ${whereClauses.join(' AND ')}
         ORDER BY prefecture DESC NULLS LAST, effective_from DESC
         LIMIT 1`,
        params,
      );

      if (res.rows.length === 0) {
        return null;
      }

      return mapInsuranceRateRow(res.rows[0]!);
    });
  }

  // ==========================================================================
  // 所得税源泉徴収税額表 (income_tax_withholding_brackets)
  // ==========================================================================

  /**
   * 税額帯の新規単票登録
   */
  async createTaxBracket(
    tenantId: string,
    userId: string | null,
    input: TaxBracketCreateInput,
  ): Promise<TaxBracketDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'rate_master.create');

      try {
        const res = await client.query<TaxBracketRow>(
          `INSERT INTO income_tax_withholding_brackets (
             tenant_id, dependents_count, income_min, income_max, tax_amount,
             effective_from, effective_to, description, created_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            tenantId,
            input.dependents_count,
            input.income_min,
            input.income_max ?? null,
            input.tax_amount,
            input.effective_from,
            input.effective_to ?? null,
            input.description ?? null,
            userId,
          ],
        );

        const created = res.rows[0]!;
        await this.auditLogs.record(client, tenantId, {
          actorUserId: userId,
          action: 'rate_master.tax_bracket.created',
          targetType: 'income_tax_withholding_bracket',
          targetId: created.id,
          afterData: {
            dependents_count: created.dependents_count,
            income_min: created.income_min,
            income_max: created.income_max,
            tax_amount: created.tax_amount,
          },
        });

        return mapTaxBracketRow(created);
      } catch (err: any) {
        if (err.code === '23P01') {
          throw AppException.badRequest(
            '同一扶養人数・期間において所得範囲が既存の税額表データと重複しています',
          );
        }
        throw err;
      }
    });
  }

  /**
   * 税額表の一括登録 (バルクインポート)
   */
  async bulkCreateTaxBrackets(
    tenantId: string,
    userId: string | null,
    input: TaxBracketBulkCreateInput,
  ): Promise<TaxBracketDto[]> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'rate_master.create');

      const results: TaxBracketDto[] = [];
      try {
        for (const item of input.items) {
          const res = await client.query<TaxBracketRow>(
            `INSERT INTO income_tax_withholding_brackets (
               tenant_id, dependents_count, income_min, income_max, tax_amount,
               effective_from, effective_to, description, created_by
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [
              tenantId,
              item.dependents_count,
              item.income_min,
              item.income_max ?? null,
              item.tax_amount,
              item.effective_from,
              item.effective_to ?? null,
              item.description ?? null,
              userId,
            ],
          );
          results.push(mapTaxBracketRow(res.rows[0]!));
        }

        await this.auditLogs.record(client, tenantId, {
          actorUserId: userId,
          action: 'rate_master.tax_bracket.bulk_created',
          targetType: 'income_tax_withholding_bracket',
          targetId: results[0]?.id ?? 'bulk',
          afterData: { count: results.length },
        });

        return results;
      } catch (err: any) {
        if (err.code === '23P01') {
          throw AppException.badRequest(
            '一括登録データ内または既存データとの間で、所得範囲または有効期間が重複しています',
          );
        }
        throw err;
      }
    });
  }

  /**
   * 税額帯の更新
   */
  async updateTaxBracket(
    tenantId: string,
    userId: string | null,
    id: string,
    input: TaxBracketUpdateInput,
  ): Promise<TaxBracketDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'rate_master.edit');

      const existingRes = await client.query<TaxBracketRow>(
        `SELECT * FROM income_tax_withholding_brackets WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, id],
      );
      const existing = existingRes.rows[0];
      if (!existing) {
        throw AppException.notFound('指定された税額帯データが見つかりません');
      }

      const dependentsCount =
        input.dependents_count !== undefined ? input.dependents_count : existing.dependents_count;
      const incomeMin = input.income_min !== undefined ? input.income_min : existing.income_min;
      const incomeMax = input.income_max !== undefined ? input.income_max : existing.income_max;
      const taxAmount = input.tax_amount !== undefined ? input.tax_amount : existing.tax_amount;
      const effectiveFrom = input.effective_from !== undefined ? input.effective_from : existing.effective_from;
      const effectiveTo = input.effective_to !== undefined ? input.effective_to : existing.effective_to;
      const description = input.description !== undefined ? input.description : existing.description;

      try {
        const res = await client.query<TaxBracketRow>(
          `UPDATE income_tax_withholding_brackets
           SET dependents_count = $3,
               income_min = $4,
               income_max = $5,
               tax_amount = $6,
               effective_from = $7,
               effective_to = $8,
               description = $9,
               updated_at = now()
           WHERE tenant_id = $1 AND id = $2
           RETURNING *`,
          [
            tenantId,
            id,
            dependentsCount,
            incomeMin,
            incomeMax ?? null,
            taxAmount,
            effectiveFrom,
            effectiveTo ?? null,
            description ?? null,
          ],
        );

        const updated = res.rows[0]!;
        await this.auditLogs.record(client, tenantId, {
          actorUserId: userId,
          action: 'rate_master.tax_bracket.updated',
          targetType: 'income_tax_withholding_bracket',
          targetId: updated.id,
          beforeData: {
            income_min: existing.income_min,
            income_max: existing.income_max,
            tax_amount: existing.tax_amount,
          },
          afterData: {
            income_min: updated.income_min,
            income_max: updated.income_max,
            tax_amount: updated.tax_amount,
          },
        });

        return mapTaxBracketRow(updated);
      } catch (err: any) {
        if (err.code === '23P01') {
          throw AppException.badRequest(
            '同一扶養人数・期間において所得範囲が既存の税額表データと重複しています',
          );
        }
        throw err;
      }
    });
  }

  /**
   * 税額表の一覧取得
   */
  async listTaxBrackets(
    tenantId: string,
    userId: string | null,
    query: TaxBracketListQuery,
  ): Promise<{ items: TaxBracketDto[]; total: number; page: number; limit: number }> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'rate_master.view');

      const page = query.page ?? 1;
      const limit = query.limit ?? 20;
      const offset = (page - 1) * limit;

      const whereClauses: string[] = ['tenant_id = $1'];
      const params: unknown[] = [tenantId];
      let paramIdx = 2;

      if (query.dependents_count !== undefined) {
        whereClauses.push(`dependents_count = $${paramIdx++}`);
        params.push(query.dependents_count);
      }

      if (query.effective_date) {
        whereClauses.push(
          `effective_from <= $${paramIdx} AND (effective_to IS NULL OR effective_to >= $${paramIdx})`,
        );
        params.push(query.effective_date);
        paramIdx++;
      }

      const whereSql = whereClauses.join(' AND ');

      const countRes = await client.query<{ count: string }>(
        `SELECT count(*) as count FROM income_tax_withholding_brackets WHERE ${whereSql}`,
        params,
      );
      const total = parseInt(countRes.rows[0]?.count ?? '0', 10);

      const itemsRes = await client.query<TaxBracketRow>(
        `SELECT * FROM income_tax_withholding_brackets
         WHERE ${whereSql}
         ORDER BY dependents_count ASC, effective_from DESC, income_min ASC
         LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        [...params, limit, offset],
      );

      return {
        items: itemsRes.rows.map(mapTaxBracketRow),
        total,
        page,
        limit,
      };
    });
  }

  /**
   * 指定日・所得金額・扶養人数から該当する所得税源泉徴収税額を取得
   */
  async getEffectiveTaxAmount(
    tenantId: string,
    userId: string | null,
    query: TaxBracketEffectiveQuery,
  ): Promise<TaxBracketDto | null> {
    return this.db.transaction(tenantId, userId, async (client) => {
      await this.assertUserPermission(client, tenantId, userId, 'rate_master.view');

      const res = await client.query<TaxBracketRow>(
        `SELECT * FROM income_tax_withholding_brackets
         WHERE tenant_id = $1
           AND dependents_count = $2
           AND effective_from <= $3 AND (effective_to IS NULL OR effective_to >= $3)
           AND income_min <= $4 AND (income_max IS NULL OR income_max > $4)
         ORDER BY effective_from DESC
         LIMIT 1`,
        [tenantId, query.dependents_count, query.date, query.income],
      );

      if (res.rows.length === 0) {
        return null;
      }

      return mapTaxBracketRow(res.rows[0]!);
    });
  }
}
