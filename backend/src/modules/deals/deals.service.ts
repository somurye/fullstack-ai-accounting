import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ROLE_PERMISSIONS } from '../../common/guards/permissions.guard';
import { buildPagination, type PaginationMeta } from '../../common/http/envelope';
import {
  type CreateDealInput,
  type UpdateDealInput,
  type CloseDealInput,
  type DealListQuery,
} from './dto/deal.schemas';
import {
  type DealDto,
  type DealRow,
  mapDealRow,
  SQL_DEAL_COLUMNS,
} from './deals.mapper';

export interface DealListResult {
  deals: DealDto[];
  pagination: PaginationMeta;
}

@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * サービス層でのRBAC権限チェック (多層防御)
   */
  private assertPermission(roles: string[], requiredPerm: string): void {
    const userPerms = new Set<string>();
    for (const role of roles || []) {
      const perms = ROLE_PERMISSIONS[role] ?? [];
      for (const p of perms) {
        userPerms.add(p);
      }
    }
    if (!userPerms.has(requiredPerm)) {
      throw AppException.forbidden(`この操作を行う権限がありません(必要権限: ${requiredPerm})`);
    }
  }

  /**
   * 案件一覧取得
   */
  async list(
    tenantId: string,
    userId: string,
    roles: string[],
    query: DealListQuery,
  ): Promise<DealListResult> {
    this.assertPermission(roles, 'deal.view');

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const offset = (page - 1) * limit;

    const conditions: string[] = ['d.tenant_id = $1'];
    const params: (string | number)[] = [tenantId];
    let paramIndex = 2;

    if (query.stage) {
      conditions.push(`d.stage = $${paramIndex++}`);
      params.push(query.stage);
    }

    if (query.customer_id) {
      conditions.push(`d.customer_id = $${paramIndex++}`);
      params.push(query.customer_id);
    }

    if (query.owner_user_id) {
      conditions.push(`d.owner_user_id = $${paramIndex++}`);
      params.push(query.owner_user_id);
    }

    if (query.search) {
      const searchPattern = `%${query.search}%`;
      conditions.push(`(d.title ILIKE $${paramIndex} OR c.name ILIKE $${paramIndex})`);
      params.push(searchPattern);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const countSql = `
      SELECT COUNT(*) AS total
      FROM deals d
      LEFT JOIN customers c ON c.id = d.customer_id
      WHERE ${whereClause}
    `;

    const selectSql = `
      SELECT ${SQL_DEAL_COLUMNS}
      FROM deals d
      LEFT JOIN customers c ON c.id = d.customer_id
      LEFT JOIN users ou ON ou.id = d.owner_user_id
      LEFT JOIN users cu ON cu.id = d.created_by
      WHERE ${whereClause}
      ORDER BY d.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    return this.db.transaction(tenantId, userId, async (client) => {
      const countRes = await client.query<{ total: string }>(countSql, params);
      const totalCount = Number(countRes.rows[0]?.total ?? 0);

      const selectParams = [...params, limit, offset];
      const res = await client.query<DealRow>(selectSql, selectParams);

      return {
        deals: res.rows.map(mapDealRow),
        pagination: buildPagination(page, limit, totalCount),
      };
    });
  }

  /**
   * 案件詳細取得
   */
  async findById(
    tenantId: string,
    userId: string,
    roles: string[],
    id: string,
  ): Promise<DealDto> {
    this.assertPermission(roles, 'deal.view');

    return this.db.transaction(tenantId, userId, async (client) => {
      const sql = `
        SELECT ${SQL_DEAL_COLUMNS}
        FROM deals d
        LEFT JOIN customers c ON c.id = d.customer_id
        LEFT JOIN users ou ON ou.id = d.owner_user_id
        LEFT JOIN users cu ON cu.id = d.created_by
        WHERE d.id = $1 AND d.tenant_id = $2
      `;
      const res = await client.query<DealRow>(sql, [id, tenantId]);
      if (res.rows.length === 0) {
        throw AppException.notFound(`案件が見つかりません (ID: ${id})`);
      }
      return mapDealRow(res.rows[0]);
    });
  }

  /**
   * 案件新規作成
   */
  async create(
    tenantId: string,
    userId: string,
    roles: string[],
    input: CreateDealInput,
    options?: { skipPermissionCheck?: boolean },
  ): Promise<DealDto> {
    if (!options?.skipPermissionCheck) {
      this.assertPermission(roles, 'deal.create');
    }

    return this.db.transaction(tenantId, userId, async (client) => {
      // 1. 顧客の存在・テナント所属チェック
      const custRes = await client.query(
        `SELECT id FROM customers WHERE id = $1 AND tenant_id = $2`,
        [input.customer_id, tenantId],
      );
      if (custRes.rows.length === 0) {
        throw AppException.notFound(`顧客が見つかりません (ID: ${input.customer_id})`);
      }

      // 2. 担当者のテナント所属チェック
      if (input.owner_user_id) {
        const userRes = await client.query(
          `SELECT user_id FROM tenant_users WHERE user_id = $1 AND tenant_id = $2`,
          [input.owner_user_id, tenantId],
        );
        if (userRes.rows.length === 0) {
          throw AppException.badRequest(`指定された担当者ユーザーはこのテナントに所属していません`);
        }
      }

      // 3. INSERT
      const insertSql = `
        INSERT INTO deals (
          tenant_id, customer_id, title, stage, expected_amount,
          currency_code, expected_close_date, owner_user_id, lost_reason, created_by
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10
        )
        RETURNING id
      `;
      const insertParams = [
        tenantId,
        input.customer_id,
        input.title.trim(),
        input.stage ?? 'lead',
        input.expected_amount ?? 0,
        input.currency_code ?? 'JPY',
        input.expected_close_date ?? null,
        input.owner_user_id ?? null,
        input.lost_reason ?? null,
        userId,
      ];

      const res = await client.query<{ id: string }>(insertSql, insertParams);
      const newDealId = res.rows[0].id;

      // 4. 監査ログ
      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'deal.create',
        targetType: 'deal',
        targetId: newDealId,
        afterData: {
          title: input.title,
          stage: input.stage ?? 'lead',
          expected_amount: input.expected_amount,
          customer_id: input.customer_id,
        },
      });

      // 5. 作成された詳細を取得して返却
      const detailSql = `
        SELECT ${SQL_DEAL_COLUMNS}
        FROM deals d
        LEFT JOIN customers c ON c.id = d.customer_id
        LEFT JOIN users ou ON ou.id = d.owner_user_id
        LEFT JOIN users cu ON cu.id = d.created_by
        WHERE d.id = $1 AND d.tenant_id = $2
      `;
      const detailRes = await client.query<DealRow>(detailSql, [newDealId, tenantId]);
      return mapDealRow(detailRes.rows[0]);
    });
  }

  /**
   * 案件更新 (進行中ステージのみ)
   *
   * 設計方針 (設計確認-01):
   * - 非終端ステージ間 (lead, qualified, proposal, negotiation) の遷移は、商談の実務プロセス
   *   (再提案や条件再確認による後退、即時商談化によるスキップ等) を踏まえ、双方向・非線形な遷移を
   *   意図的に許可している (DB・アプリ双方で一方向順序の強制なし)。
   * - 終端状態 (won / lost) への遷移のみを不可逆・一方向として保護し、終端状態からの更新は
   *   DBトリガーおよび本メソッド冒頭のガードで fail-closed に拒絶する。
   */
  async update(
    tenantId: string,
    userId: string,
    roles: string[],
    id: string,
    input: UpdateDealInput,
  ): Promise<DealDto> {
    this.assertPermission(roles, 'deal.edit');

    return this.db.transaction(tenantId, userId, async (client) => {
      // 1. 対象レコード取得 (ロック付加)
      const currentRes = await client.query<DealRow>(
        `SELECT * FROM deals WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenantId],
      );
      if (currentRes.rows.length === 0) {
        throw AppException.notFound(`案件が見つかりません (ID: ${id})`);
      }
      const current = currentRes.rows[0];

      // 2. 終端状態ガード
      if (current.stage === 'won' || current.stage === 'lost') {
        throw AppException.badRequest(
          `終端状態(${current.stage})の案件は変更できません (不可変レコード)`,
        );
      }

      // 3. 顧客の存在・テナント所属チェック (更新指定時)
      if (input.customer_id && input.customer_id !== current.customer_id) {
        const custRes = await client.query(
          `SELECT id FROM customers WHERE id = $1 AND tenant_id = $2`,
          [input.customer_id, tenantId],
        );
        if (custRes.rows.length === 0) {
          throw AppException.notFound(`顧客が見つかりません (ID: ${input.customer_id})`);
        }
      }

      // 4. 担当者のテナント所属チェック (更新指定時)
      if (input.owner_user_id && input.owner_user_id !== current.owner_user_id) {
        const userRes = await client.query(
          `SELECT user_id FROM tenant_users WHERE user_id = $1 AND tenant_id = $2`,
          [input.owner_user_id, tenantId],
        );
        if (userRes.rows.length === 0) {
          throw AppException.badRequest(`指定された担当者ユーザーはこのテナントに所属していません`);
        }
      }

      // 5. UPDATE
      const targetStage = input.stage ?? current.stage;
      const targetLostReason = targetStage === 'lost' ? (input.lost_reason ?? current.lost_reason) : null;

      const updateSql = `
        UPDATE deals SET
          customer_id = COALESCE($1, customer_id),
          title = COALESCE($2, title),
          stage = COALESCE($3, stage),
          expected_amount = COALESCE($4, expected_amount),
          currency_code = COALESCE($5, currency_code),
          expected_close_date = CASE WHEN $6::boolean THEN $7::date ELSE expected_close_date END,
          owner_user_id = CASE WHEN $8::boolean THEN $9::uuid ELSE owner_user_id END,
          lost_reason = $10,
          updated_at = now()
        WHERE id = $11 AND tenant_id = $12
      `;

      const updateParams = [
        input.customer_id ?? null,
        input.title ? input.title.trim() : null,
        input.stage ?? null,
        input.expected_amount !== undefined ? input.expected_amount : null,
        input.currency_code ?? null,
        input.expected_close_date !== undefined,
        input.expected_close_date ?? null,
        input.owner_user_id !== undefined,
        input.owner_user_id ?? null,
        targetLostReason,
        id,
        tenantId,
      ];

      await client.query(updateSql, updateParams);

      // 6. 監査ログ
      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'deal.update',
        targetType: 'deal',
        targetId: id,
        beforeData: {
          title: current.title,
          stage: current.stage,
          expected_amount: current.expected_amount,
        },
        afterData: input,
      });

      // 7. 更新後データ取得
      const detailSql = `
        SELECT ${SQL_DEAL_COLUMNS}
        FROM deals d
        LEFT JOIN customers c ON c.id = d.customer_id
        LEFT JOIN users ou ON ou.id = d.owner_user_id
        LEFT JOIN users cu ON cu.id = d.created_by
        WHERE d.id = $1 AND d.tenant_id = $2
      `;
      const detailRes = await client.query<DealRow>(detailSql, [id, tenantId]);
      return mapDealRow(detailRes.rows[0]);
    });
  }

  /**
   * 案件クローズ (won / lost 確定)
   */
  async close(
    tenantId: string,
    userId: string,
    roles: string[],
    id: string,
    input: CloseDealInput,
  ): Promise<DealDto> {
    this.assertPermission(roles, 'deal.close');

    return this.db.transaction(tenantId, userId, async (client) => {
      // 1. 対象レコード取得 (ロック付加)
      const currentRes = await client.query<DealRow>(
        `SELECT * FROM deals WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenantId],
      );
      if (currentRes.rows.length === 0) {
        throw AppException.notFound(`案件が見つかりません (ID: ${id})`);
      }
      const current = currentRes.rows[0];

      // 2. 終端状態ガード
      if (current.stage === 'won' || current.stage === 'lost') {
        throw AppException.badRequest(
          `既にクローズ済みの案件です (現在の状態: ${current.stage})`,
        );
      }

      // 3. lost時の理由必須チェック
      if (input.stage === 'lost' && (!input.lost_reason || input.lost_reason.trim().length === 0)) {
        throw AppException.badRequest('失注(lost)の場合は失注理由を入力してください');
      }

      // 4. UPDATE
      const updateSql = `
        UPDATE deals SET
          stage = $1,
          lost_reason = $2,
          closed_at = now(),
          updated_at = now()
        WHERE id = $3 AND tenant_id = $4
      `;
      await client.query(updateSql, [
        input.stage,
        input.stage === 'lost' ? input.lost_reason!.trim() : null,
        id,
        tenantId,
      ]);

      // 5. 監査ログ
      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'deal.close',
        targetType: 'deal',
        targetId: id,
        beforeData: { stage: current.stage },
        afterData: { stage: input.stage, lost_reason: input.lost_reason },
      });

      // 6. 更新後データ取得
      const detailSql = `
        SELECT ${SQL_DEAL_COLUMNS}
        FROM deals d
        LEFT JOIN customers c ON c.id = d.customer_id
        LEFT JOIN users ou ON ou.id = d.owner_user_id
        LEFT JOIN users cu ON cu.id = d.created_by
        WHERE d.id = $1 AND d.tenant_id = $2
      `;
      const detailRes = await client.query<DealRow>(detailSql, [id, tenantId]);
      return mapDealRow(detailRes.rows[0]);
    });
  }

  /**
   * 案件削除 (終端状態以外のみ可能)
   */
  async delete(
    tenantId: string,
    userId: string,
    roles: string[],
    id: string,
  ): Promise<{ success: boolean; id: string }> {
    this.assertPermission(roles, 'deal.edit');

    return this.db.transaction(tenantId, userId, async (client) => {
      // 1. 対象レコード取得 (ロック付加)
      const currentRes = await client.query<DealRow>(
        `SELECT * FROM deals WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [id, tenantId],
      );
      if (currentRes.rows.length === 0) {
        throw AppException.notFound(`案件が見つかりません (ID: ${id})`);
      }
      const current = currentRes.rows[0];

      // 2. 終端状態ガード
      if (current.stage === 'won' || current.stage === 'lost') {
        throw AppException.badRequest(
          `終端状態(${current.stage})の案件は削除できません`,
        );
      }

      // 3. 紐づく見積の存在チェック
      const quoteRes = await client.query(
        `SELECT id, quote_no FROM quotations WHERE deal_id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (quoteRes.rows.length > 0) {
        throw AppException.badRequest(
          `この案件に紐づく見積書(${quoteRes.rows[0].quote_no})が存在するため削除できません`,
        );
      }

      // 4. DELETE
      await client.query(`DELETE FROM deals WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);

      // 5. 監査ログ
      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'deal.delete',
        targetType: 'deal',
        targetId: id,
        beforeData: { title: current.title, stage: current.stage },
      });

      return { success: true, id };
    });
  }
}
