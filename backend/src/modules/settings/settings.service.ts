import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../database/database.service';
import { AppException } from '../../common/exceptions/app.exception';
import { decryptSecret, encryptSecret } from '../../common/security/secret-encryption';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type {
  AccountingSettingsUpdateInput,
  AiSettingsUpdateInput,
  MemberInvitationCreateInput,
  MemberRoleUpdateInput,
  TenantSettingsUpdateInput,
} from './dto/settings.schemas';
import {
  mapAccountingSettingsRow,
  mapAiIntegrationSettingsRow,
  mapIntegrationSettingsRow,
  mapMemberInvitationRow,
  mapTenantMemberRow,
  mapTenantRow,
  TENANT_COLUMNS,
  type AccountingSettingsDto,
  type AccountingSettingsRow,
  type AiIntegrationSettingsDto,
  type IntegrationSettingsDto,
  type IntegrationSettingsRow,
  type MemberInvitationCreatedDto,
  type MemberInvitationDto,
  type MemberInvitationRow,
  type TenantDto,
  type TenantMemberDto,
  type TenantMemberRow,
  type TenantRow,
} from './settings.mapper';

const DEFAULT_ROUNDING_RULE = 'floor';
const INVITATION_TTL_DAYS = 7;
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173';
const MEMBER_INVITATION_COLUMNS = `id, email::text AS email, role_code::text AS role_code, expires_at, created_at`;
const INTEGRATION_SETTINGS_COLUMNS = `
  ai_provider::text AS ai_provider,
  ai_api_key_last4,
  ai_last_tested_at,
  ai_last_test_result,
  bank_connector_status
`;
const AI_CONNECTION_TEST_TIMEOUT_MS = 10_000;

interface AiConnectionTestResult {
  success: boolean;
  message: string;
  http_status: number | null;
}

/**
 * SettingsService
 * ================
 * 自社(テナント)情報・会計処理共通設定・メンバー権限管理を扱う。
 *
 * 外部時限アクセス(税理士・監査人)の発行/一覧/失効は、既に本番品質の
 * `external-access-grants` モジュール(owner/accounting_manager権限チェック・
 * 監査ログ・RLSによる多層防御込み)が存在するため、ここでは重複実装せず
 * フロントエンドの設定画面から直接そのAPIを呼び出す方針とする
 * (詳細は `docs/openapi.yaml` の Settings セクションのコメントを参照)。
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async getTenant(tenantId: string, userId: string | null): Promise<TenantDto> {
    return this.db.transaction(tenantId, userId, (client) => this.fetchTenant(client, tenantId));
  }

  async updateTenant(
    tenantId: string,
    userId: string,
    dto: TenantSettingsUpdateInput,
  ): Promise<TenantDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const fields: string[] = [];
      const params: unknown[] = [tenantId];
      const addField = (column: string, value: unknown): void => {
        params.push(value);
        fields.push(`${column} = $${params.length}`);
      };

      if (dto.name !== undefined) addField('name', dto.name);
      if (dto.legal_name !== undefined) addField('legal_name', dto.legal_name);
      if (dto.representative_name !== undefined) addField('representative_name', dto.representative_name);
      if (dto.address !== undefined) addField('address', dto.address);
      if (dto.fiscal_year_start_month !== undefined) {
        addField('fiscal_year_start_month', dto.fiscal_year_start_month);
      }
      if (dto.invoice_registration_number !== undefined) {
        addField('invoice_registration_number', dto.invoice_registration_number);
      }
      if (dto.consumption_tax_filing_method !== undefined) {
        addField('consumption_tax_filing_method', dto.consumption_tax_filing_method);
      }
      if (dto.base_currency_code !== undefined) {
        addField('base_currency_code', dto.base_currency_code);
      }

      const updated = await client.query<TenantRow>(
        `UPDATE tenants SET ${fields.join(', ')} WHERE id = $1 RETURNING ${TENANT_COLUMNS}`,
        params,
      );
      if (updated.rowCount === 0) {
        throw AppException.notFound('テナントが見つかりません');
      }

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'tenant.settings_updated',
        targetType: 'tenant',
        targetId: tenantId,
        afterData: dto,
      });

      return mapTenantRow(updated.rows[0]);
    });
  }

  async getAccountingSettings(
    tenantId: string,
    userId: string | null,
  ): Promise<AccountingSettingsDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<AccountingSettingsRow>(
        `SELECT rounding_rule, default_tax_category_id
         FROM tenant_accounting_settings WHERE tenant_id = $1`,
        [tenantId],
      );
      if (result.rowCount === 0) {
        return { rounding_rule: DEFAULT_ROUNDING_RULE, default_tax_category_id: null };
      }
      return mapAccountingSettingsRow(result.rows[0]);
    });
  }

  async updateAccountingSettings(
    tenantId: string,
    userId: string,
    dto: AccountingSettingsUpdateInput,
  ): Promise<AccountingSettingsDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      if (dto.default_tax_category_id) {
        const taxCategoryResult = await client.query(
          `SELECT 1 FROM tax_categories WHERE tenant_id = $1 AND id = $2`,
          [tenantId, dto.default_tax_category_id],
        );
        if (taxCategoryResult.rowCount === 0) {
          throw AppException.badRequest(
            `指定された税区分(id: ${dto.default_tax_category_id})が見つかりません`,
          );
        }
      }

      const hasTaxCategoryField = dto.default_tax_category_id !== undefined;
      const updated = await client.query<AccountingSettingsRow>(
        `INSERT INTO tenant_accounting_settings (tenant_id, rounding_rule, default_tax_category_id)
         VALUES ($1, COALESCE($2::rounding_rule_enum, $4::rounding_rule_enum), $3::uuid)
         ON CONFLICT (tenant_id) DO UPDATE SET
           rounding_rule = COALESCE($2::rounding_rule_enum, tenant_accounting_settings.rounding_rule),
           default_tax_category_id = CASE WHEN $5 THEN $3::uuid ELSE tenant_accounting_settings.default_tax_category_id END
         RETURNING rounding_rule, default_tax_category_id`,
        [
          tenantId,
          dto.rounding_rule ?? null,
          dto.default_tax_category_id ?? null,
          DEFAULT_ROUNDING_RULE,
          hasTaxCategoryField,
        ],
      );

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'tenant.accounting_settings_updated',
        targetType: 'tenant',
        targetId: tenantId,
        afterData: dto,
      });

      return mapAccountingSettingsRow(updated.rows[0]);
    });
  }

  async listMembers(tenantId: string, userId: string | null): Promise<TenantMemberDto[]> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<TenantMemberRow>(
        `SELECT
           tu.user_id AS user_id,
           u.email AS email,
           u.name AS name,
           tu.employee_code AS employee_code,
           tu.department AS department,
           tu.is_active AS is_active,
           ARRAY_REMOVE(ARRAY_AGG(r.code::text ORDER BY r.code), NULL) AS roles
         FROM tenant_users tu
         JOIN users u ON u.id = tu.user_id
         LEFT JOIN user_roles ur ON ur.tenant_id = tu.tenant_id AND ur.user_id = tu.user_id
         LEFT JOIN roles r ON r.id = ur.role_id
         WHERE tu.tenant_id = $1
         GROUP BY tu.user_id, u.email, u.name, tu.employee_code, tu.department, tu.is_active
         ORDER BY u.name ASC`,
        [tenantId],
      );
      return result.rows.map(mapTenantMemberRow);
    });
  }

  async updateMemberRole(
    tenantId: string,
    userId: string,
    targetUserId: string,
    dto: MemberRoleUpdateInput,
  ): Promise<TenantMemberDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const memberResult = await client.query(
        `SELECT 1 FROM tenant_users WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, targetUserId],
      );
      if (memberResult.rowCount === 0) {
        throw AppException.notFound('指定されたメンバーが見つかりません');
      }

      const currentRolesResult = await client.query<{ code: string }>(
        `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.tenant_id = $1 AND ur.user_id = $2`,
        [tenantId, targetUserId],
      );
      const currentlyOwner = currentRolesResult.rows.some((row) => row.code === 'owner');

      // 最後の1人のownerを降格させるとテナントの管理者が不在になるため禁止する
      // (自己承認防止トリガー等、本コードベース全体の「重要な業務不変条件はアプリ/DB双方で守る」
      // 方針に倣った防御的チェック)。
      if (currentlyOwner && dto.role !== 'owner') {
        const otherOwnerCountResult = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
           WHERE ur.tenant_id = $1 AND r.code = 'owner' AND ur.user_id <> $2`,
          [tenantId, targetUserId],
        );
        if (Number(otherOwnerCountResult.rows[0].count) === 0) {
          throw AppException.conflict(
            'LAST_OWNER_PROTECTED',
            'テナントに最低1人のowner(管理者)が必要なため、最後のownerのロールは変更できません',
          );
        }
      }

      const roleRowResult = await client.query<{ id: string }>(
        `SELECT id FROM roles WHERE code = $1`,
        [dto.role],
      );
      const roleId = roleRowResult.rows[0]?.id;
      if (!roleId) {
        throw AppException.badRequest(`ロール(code: ${dto.role})が見つかりません`);
      }

      const beforeRoles = currentRolesResult.rows.map((row) => row.code);

      await client.query(`DELETE FROM user_roles WHERE tenant_id = $1 AND user_id = $2`, [
        tenantId,
        targetUserId,
      ]);
      await client.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_id, granted_by) VALUES ($1, $2, $3, $4)`,
        [tenantId, targetUserId, roleId, userId],
      );

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'tenant_member.role_changed',
        targetType: 'user',
        targetId: targetUserId,
        beforeData: { roles: beforeRoles },
        afterData: { roles: [dto.role] },
      });

      return this.fetchMember(client, tenantId, targetUserId);
    });
  }

  /**
   * メンバーをテナントから削除/アクセス停止する。
   * 過去の仕訳・経費申請・監査ログ等が `users.id` を参照しているため、`tenant_users` 行自体は
   * 物理削除せず `is_active = false` へのフラグ更新で対応する(参照整合性の保護)。
   * `user_roles` は即座に全削除し、DBを直接参照する権限チェック(最後のowner判定等)へ
   * 即時反映させる。
   */
  async removeMember(
    tenantId: string,
    userId: string,
    targetUserId: string,
  ): Promise<TenantMemberDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      if (targetUserId === userId) {
        throw new AppException(
          'CANNOT_REMOVE_SELF',
          '自分自身をテナントから削除することはできません(離脱は別途対応してください)',
          400,
        );
      }

      const memberResult = await client.query<{ is_active: boolean }>(
        `SELECT is_active FROM tenant_users WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, targetUserId],
      );
      if (memberResult.rowCount === 0 || !memberResult.rows[0].is_active) {
        throw AppException.notFound('指定されたメンバーが見つかりません');
      }

      const currentRolesResult = await client.query<{ code: string }>(
        `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.tenant_id = $1 AND ur.user_id = $2`,
        [tenantId, targetUserId],
      );
      const currentlyOwner = currentRolesResult.rows.some((row) => row.code === 'owner');

      // 最後の1人のownerを削除するとテナントの管理者が不在になるため禁止する(updateMemberRoleと同じ方針)。
      if (currentlyOwner) {
        const otherOwnerCountResult = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
           WHERE ur.tenant_id = $1 AND r.code = 'owner' AND ur.user_id <> $2`,
          [tenantId, targetUserId],
        );
        if (Number(otherOwnerCountResult.rows[0].count) === 0) {
          throw AppException.conflict(
            'CANNOT_REMOVE_LAST_OWNER',
            'テナントに最低1人のowner(管理者)が必要なため、最後のownerは削除できません',
          );
        }
      }

      const beforeRoles = currentRolesResult.rows.map((row) => row.code);

      await client.query(
        `UPDATE tenant_users SET is_active = FALSE, left_at = now() WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, targetUserId],
      );
      await client.query(`DELETE FROM user_roles WHERE tenant_id = $1 AND user_id = $2`, [
        tenantId,
        targetUserId,
      ]);

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'tenant_member.removed',
        targetType: 'user',
        targetId: targetUserId,
        beforeData: { is_active: true, roles: beforeRoles },
        afterData: { is_active: false, roles: [] },
      });

      return this.fetchMember(client, tenantId, targetUserId);
    });
  }

  async listInvitations(tenantId: string, userId: string | null): Promise<MemberInvitationDto[]> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<MemberInvitationRow>(
        `SELECT ${MEMBER_INVITATION_COLUMNS} FROM member_invitations
         WHERE tenant_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
         ORDER BY created_at DESC`,
        [tenantId],
      );
      return result.rows.map(mapMemberInvitationRow);
    });
  }

  /**
   * メンバー招待を発行する。生トークンはこの呼び出しのレスポンスでのみ返却し、DBには
   * `refresh_tokens` と同様にSHA-256ハッシュのみ保存する(以降は復元不可)。
   * 招待の受諾(サインアップ)フローは別タスクのスコープであり、本メソッドは発行のみを担う。
   */
  async createInvitation(
    tenantId: string,
    userId: string,
    dto: MemberInvitationCreateInput,
  ): Promise<MemberInvitationCreatedDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const existingMember = await client.query(
        `SELECT 1 FROM tenant_users tu JOIN users u ON u.id = tu.user_id
         WHERE tu.tenant_id = $1 AND u.email = $2 AND tu.is_active = TRUE`,
        [tenantId, dto.email],
      );
      if ((existingMember.rowCount ?? 0) > 0) {
        throw AppException.conflict(
          'ALREADY_EXISTS',
          '指定されたメールアドレスは既にこのテナントに所属しています',
        );
      }

      const existingInvitation = await client.query(
        `SELECT 1 FROM member_invitations
         WHERE tenant_id = $1 AND email = $2
           AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
        [tenantId, dto.email],
      );
      if ((existingInvitation.rowCount ?? 0) > 0) {
        throw AppException.conflict('ALREADY_EXISTS', '指定されたメールアドレスは既に招待中です');
      }

      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');

      const inserted = await client.query<MemberInvitationRow>(
        `INSERT INTO member_invitations (tenant_id, email, role_code, token_hash, invited_by, expires_at)
         VALUES ($1, $2, $3::role_code_enum, $4, $5, now() + make_interval(days => $6))
         RETURNING ${MEMBER_INVITATION_COLUMNS}`,
        [tenantId, dto.email, dto.role, tokenHash, userId, INVITATION_TTL_DAYS],
      );
      const invitation = inserted.rows[0];

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'tenant_member.invited',
        targetType: 'member_invitation',
        targetId: invitation.id,
        afterData: { email: invitation.email, role: invitation.role_code },
      });

      return {
        ...mapMemberInvitationRow(invitation),
        token: rawToken,
        invite_url: `${FRONTEND_BASE_URL}/accept-invite?token=${rawToken}`,
      };
    });
  }

  async cancelInvitation(
    tenantId: string,
    userId: string,
    invitationId: string,
  ): Promise<MemberInvitationDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<MemberInvitationRow>(
        `UPDATE member_invitations SET revoked_at = now()
         WHERE tenant_id = $1 AND id = $2 AND accepted_at IS NULL AND revoked_at IS NULL
         RETURNING ${MEMBER_INVITATION_COLUMNS}`,
        [tenantId, invitationId],
      );
      if (result.rowCount === 0) {
        throw AppException.notFound('指定された招待が見つからないか、既に取消/参加済みです');
      }
      const invitation = result.rows[0];

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'tenant_member.invitation_cancelled',
        targetType: 'member_invitation',
        targetId: invitation.id,
        afterData: { email: invitation.email },
      });

      return mapMemberInvitationRow(invitation);
    });
  }

  async getIntegrationSettings(
    tenantId: string,
    userId: string | null,
  ): Promise<IntegrationSettingsDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<IntegrationSettingsRow>(
        `SELECT ${INTEGRATION_SETTINGS_COLUMNS} FROM tenant_integration_settings WHERE tenant_id = $1`,
        [tenantId],
      );
      if (result.rowCount === 0) {
        return mapIntegrationSettingsRow({
          ai_provider: null,
          ai_api_key_last4: null,
          ai_last_tested_at: null,
          ai_last_test_result: null,
          bank_connector_status: 'not_connected',
        });
      }
      return mapIntegrationSettingsRow(result.rows[0]);
    });
  }

  /**
   * APIキーはAES-256-GCMで暗号化して保存し、平文は保持しない。
   * `dto.api_key` が省略された場合は既存の暗号化済みキーを保持したまま `provider` のみ更新する
   * (フロントエンドの「変更時のみ送信」要件に対応するため)。
   */
  async updateAiSettings(
    tenantId: string,
    userId: string,
    dto: AiSettingsUpdateInput,
  ): Promise<AiIntegrationSettingsDto> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const insertColumns = ['tenant_id', 'ai_provider'];
      const insertValues = ['$1', '$2::ai_provider_enum'];
      const updateSetParts = ['ai_provider = $2::ai_provider_enum'];
      const params: unknown[] = [tenantId, dto.provider];

      if (dto.api_key !== undefined) {
        const encrypted = encryptSecret(dto.api_key);
        const last4 = dto.api_key.slice(-4);
        params.push(encrypted.ciphertext, encrypted.iv, encrypted.tag, last4);
        insertColumns.push(
          'ai_api_key_ciphertext',
          'ai_api_key_iv',
          'ai_api_key_tag',
          'ai_api_key_last4',
        );
        insertValues.push('$3', '$4', '$5', '$6');
        updateSetParts.push(
          'ai_api_key_ciphertext = $3',
          'ai_api_key_iv = $4',
          'ai_api_key_tag = $5',
          'ai_api_key_last4 = $6',
        );
      }

      const updated = await client.query<IntegrationSettingsRow>(
        `INSERT INTO tenant_integration_settings (${insertColumns.join(', ')})
         VALUES (${insertValues.join(', ')})
         ON CONFLICT (tenant_id) DO UPDATE SET ${updateSetParts.join(', ')}
         RETURNING ${INTEGRATION_SETTINGS_COLUMNS}`,
        params,
      );
      const row = updated.rows[0];

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'tenant.ai_integration_updated',
        targetType: 'tenant',
        targetId: tenantId,
        afterData: { provider: dto.provider, api_key_changed: dto.api_key !== undefined },
      });

      return mapAiIntegrationSettingsRow(row);
    });
  }

  /**
   * 保存済みのAPIキーを復号し、対象プロバイダへ実際に最小限のリクエスト(モデル一覧取得等、
   * トークン課金の発生しないエンドポイント)を送信して疎通を確認する。
   */
  async testAiConnection(tenantId: string, userId: string): Promise<AiConnectionTestResult> {
    return this.db.transaction(tenantId, userId, async (client) => {
      const result = await client.query<{
        ai_provider: string | null;
        ai_api_key_ciphertext: string | null;
        ai_api_key_iv: string | null;
        ai_api_key_tag: string | null;
      }>(
        `SELECT ai_provider::text AS ai_provider, ai_api_key_ciphertext, ai_api_key_iv, ai_api_key_tag
         FROM tenant_integration_settings WHERE tenant_id = $1`,
        [tenantId],
      );
      const row = result.rows[0];
      if (
        !row?.ai_provider ||
        !row.ai_api_key_ciphertext ||
        !row.ai_api_key_iv ||
        !row.ai_api_key_tag
      ) {
        throw AppException.badRequest('AIプロバイダのAPIキーが設定されていません');
      }

      const apiKey = decryptSecret({
        ciphertext: row.ai_api_key_ciphertext,
        iv: row.ai_api_key_iv,
        tag: row.ai_api_key_tag,
      });
      const testResult = await this.runAiConnectionTest(row.ai_provider, apiKey);

      await client.query(
        `UPDATE tenant_integration_settings SET ai_last_tested_at = now(), ai_last_test_result = $2
         WHERE tenant_id = $1`,
        [tenantId, testResult.success ? 'success' : 'failure'],
      );

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'tenant.ai_integration_tested',
        targetType: 'tenant',
        targetId: tenantId,
        afterData: { provider: row.ai_provider, success: testResult.success },
      });

      return testResult;
    });
  }

  /**
   * 保存済みのAIプロバイダAPIキーを復号して返す(呼び出し元のトランザクション内で使用する)。
   * 経費精算OCR機能等、他モジュールから設定済みAI連携を利用するための公開API。
   */
  async getDecryptedAiCredentials(
    client: PoolClient,
    tenantId: string,
  ): Promise<{ provider: string; apiKey: string }> {
    const result = await client.query<{
      ai_provider: string | null;
      ai_api_key_ciphertext: string | null;
      ai_api_key_iv: string | null;
      ai_api_key_tag: string | null;
    }>(
      `SELECT ai_provider::text AS ai_provider, ai_api_key_ciphertext, ai_api_key_iv, ai_api_key_tag
       FROM tenant_integration_settings WHERE tenant_id = $1`,
      [tenantId],
    );
    const row = result.rows[0];
    if (
      !row?.ai_provider ||
      !row.ai_api_key_ciphertext ||
      !row.ai_api_key_iv ||
      !row.ai_api_key_tag
    ) {
      throw AppException.badRequest('AIプロバイダのAPIキーが設定されていません');
    }
    const apiKey = decryptSecret({
      ciphertext: row.ai_api_key_ciphertext,
      iv: row.ai_api_key_iv,
      tag: row.ai_api_key_tag,
    });
    return { provider: row.ai_provider, apiKey };
  }

  private async runAiConnectionTest(
    provider: string,
    apiKey: string,
  ): Promise<AiConnectionTestResult> {
    try {
      switch (provider) {
        case 'anthropic': {
          const client = new Anthropic({ apiKey });
          await client.models.list();
          return { success: true, message: '接続に成功しました', http_status: 200 };
        }
        case 'openai': {
          const response = await fetch('https://api.openai.com/v1/models', {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(AI_CONNECTION_TEST_TIMEOUT_MS),
          });
          return response.ok
            ? { success: true, message: '接続に成功しました', http_status: response.status }
            : {
                success: false,
                message: `APIエラーが返却されました(HTTP ${response.status})`,
                http_status: response.status,
              };
        }
        case 'gemini': {
          const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
            { signal: AbortSignal.timeout(AI_CONNECTION_TEST_TIMEOUT_MS) },
          );
          return response.ok
            ? { success: true, message: '接続に成功しました', http_status: response.status }
            : {
                success: false,
                message: `APIエラーが返却されました(HTTP ${response.status})`,
                http_status: response.status,
              };
        }
        default:
          return { success: false, message: `未対応のプロバイダです: ${provider}`, http_status: null };
      }
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        return { success: false, message: 'APIキーが無効です(認証エラー)', http_status: 401 };
      }
      if (error instanceof Anthropic.APIError) {
        return {
          success: false,
          message: `APIエラー: ${error.message}`,
          http_status: error.status ?? null,
        };
      }
      return {
        success: false,
        message: '接続テストに失敗しました(ネットワークエラーまたはタイムアウト)',
        http_status: null,
      };
    }
  }

  // --------------------------------------------------------------------------
  // 内部ヘルパー
  // --------------------------------------------------------------------------

  private async fetchTenant(client: PoolClient, tenantId: string): Promise<TenantDto> {
    const result = await client.query<TenantRow>(
      `SELECT ${TENANT_COLUMNS} FROM tenants WHERE id = $1`,
      [tenantId],
    );
    if (result.rowCount === 0) {
      throw AppException.notFound('テナントが見つかりません');
    }
    return mapTenantRow(result.rows[0]);
  }

  private async fetchMember(
    client: PoolClient,
    tenantId: string,
    targetUserId: string,
  ): Promise<TenantMemberDto> {
    const result = await client.query<TenantMemberRow>(
      `SELECT
         tu.user_id AS user_id,
         u.email AS email,
         u.name AS name,
         tu.employee_code AS employee_code,
         tu.department AS department,
         tu.is_active AS is_active,
         ARRAY_REMOVE(ARRAY_AGG(r.code::text ORDER BY r.code), NULL) AS roles
       FROM tenant_users tu
       JOIN users u ON u.id = tu.user_id
       LEFT JOIN user_roles ur ON ur.tenant_id = tu.tenant_id AND ur.user_id = tu.user_id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE tu.tenant_id = $1 AND tu.user_id = $2
       GROUP BY tu.user_id, u.email, u.name, tu.employee_code, tu.department, tu.is_active`,
      [tenantId, targetUserId],
    );
    const row = result.rows[0];
    if (!row) {
      throw AppException.notFound('指定されたメンバーが見つかりません');
    }
    return mapTenantMemberRow(row);
  }
}
