import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppException } from '../../common/exceptions/app.exception';
import type { JwtPayload } from '../../common/guards/tenant-auth.guard';
import { hashPassword, verifyPassword } from '../../common/security/password';
import { verifyTotp } from '../../common/security/totp';
import { DatabaseService } from '../../database/database.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { AcceptInviteInput, SignupInput } from './dto/auth.schemas';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30日
const MFA_TOKEN_TTL = '5m';

// ユーザーが存在しない場合でも `verifyPassword` の実行時間を一定に保ち、
// 応答時間差からのユーザー列挙(タイミング攻撃)を防ぐためのダミーハッシュ。
// 起動のたびに固定のダミー文字列から算出されるだけで、実在のパスワードとは無関係。
const DUMMY_PASSWORD_HASH = hashPassword('dummy-password-for-timing-safety');

export interface TenantSummary {
  tenant_id: string;
  tenant_name: string;
}

interface TenantMembership extends TenantSummary {
  roles: string[];
}

export interface LoginResult {
  access_token?: string;
  refresh_token?: string;
  mfa_required: boolean;
  mfa_token?: string;
  tenants: TenantSummary[];
}

export interface SessionTokens {
  access_token: string;
  refresh_token: string;
}

interface AuthUserRow {
  id: string;
  password_hash: string | null;
  is_active: boolean;
  mfa_enabled: boolean;
}

interface MfaUserRow {
  id: string;
  mfa_secret: string | null;
  is_active: boolean;
}

interface MembershipRow {
  tenant_id: string;
  tenant_name: string;
  role_code: string | null;
}

interface MfaTokenPayload {
  sub: string;
  purpose: 'mfa';
}

export interface InvitationValidationResult {
  tenant_name: string;
  email: string;
  role: string;
}

interface InvitationRow {
  id: string;
  tenant_id: string;
  tenant_name: string;
  email: string;
  role_code: string;
  invited_by: string;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
}

/**
 * AuthService
 * ===========
 * `docs/openapi.yaml` `tags: [Auth]` の6エンドポイント(ログイン・MFA検証・ログアウト・
 * サインアップ・招待検証・招待受諾)を実装する。
 *
 * ログイン/MFA検証はいずれも「これからテナントコンテキストを確立する」処理であり、
 * `DatabaseService.transaction()` が要求する tenantId/userId をまだ持たない。
 * そのため `db.query()` (RLSコンテキストを設定しない低レベルエスケープハッチ)経由で、
 * `sql/001_initial_schema_all_in_one.sql` に定義した認証専用の SECURITY DEFINER 関数
 * (`fn_authenticate_user_by_email` 等)を呼び出す。これらの関数は返却列を認証に
 * 必要な最小限に絞ってあり、`fn_has_active_external_grant()` と同じ設計方針
 * (狭く限定された目的のみのRLSバイパス)に従う。
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  private async loadTenantMemberships(userId: string): Promise<TenantMembership[]> {
    const result = await this.db.query<MembershipRow>(
      'SELECT tenant_id, tenant_name, role_code FROM fn_list_user_tenant_memberships($1)',
      [userId],
    );
    const memberships = new Map<string, TenantMembership>();
    for (const row of result.rows) {
      if (!memberships.has(row.tenant_id)) {
        memberships.set(row.tenant_id, {
          tenant_id: row.tenant_id,
          tenant_name: row.tenant_name,
          roles: [],
        });
      }
      if (row.role_code) {
        memberships.get(row.tenant_id)?.roles.push(row.role_code);
      }
    }
    return Array.from(memberships.values());
  }

  private async issueSessionTokens(userId: string, tenant: TenantMembership): Promise<SessionTokens> {
    const payload: JwtPayload = { sub: userId, tenant_id: tenant.tenant_id, roles: tenant.roles };
    const accessToken = this.jwtService.sign(payload);
    const refreshToken = await this.createRefreshToken(userId);
    return { access_token: accessToken, refresh_token: refreshToken };
  }

  private async createRefreshToken(userId: string): Promise<string> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    await this.db.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [userId, tokenHash, expiresAt],
    );
    return rawToken;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const userResult = await this.db.query<AuthUserRow>(
      'SELECT id, password_hash, is_active, mfa_enabled FROM fn_authenticate_user_by_email($1)',
      [email],
    );
    const user = userResult.rows[0];

    const passwordOk = verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!user || !user.is_active || !passwordOk) {
      throw AppException.unauthorized('メールアドレスまたはパスワードが正しくありません');
    }

    const memberships = await this.loadTenantMemberships(user.id);
    const tenants = memberships.map(({ tenant_id, tenant_name }) => ({ tenant_id, tenant_name }));

    if (user.mfa_enabled) {
      const mfaPayload: MfaTokenPayload = { sub: user.id, purpose: 'mfa' };
      const mfaToken = this.jwtService.sign(mfaPayload, { expiresIn: MFA_TOKEN_TTL });
      return { mfa_required: true, mfa_token: mfaToken, tenants };
    }

    if (memberships.length === 0) {
      throw AppException.unauthorized('有効なテナントに所属していないためログインできません');
    }

    const tokens = await this.issueSessionTokens(user.id, memberships[0]);
    return { ...tokens, mfa_required: false, tenants };
  }

  async verifyMfa(mfaToken: string, code: string): Promise<SessionTokens> {
    let payload: MfaTokenPayload;
    try {
      payload = this.jwtService.verify<MfaTokenPayload>(mfaToken);
    } catch {
      throw AppException.unauthorized('MFAトークンが無効、または有効期限が切れています');
    }
    if (payload.purpose !== 'mfa' || !payload.sub) {
      throw AppException.unauthorized('MFAトークンが無効です');
    }

    const userResult = await this.db.query<MfaUserRow>(
      'SELECT id, mfa_secret, is_active FROM fn_get_user_for_mfa($1)',
      [payload.sub],
    );
    const user = userResult.rows[0];
    if (!user || !user.is_active || !user.mfa_secret || !verifyTotp(user.mfa_secret, code)) {
      throw AppException.unauthorized('MFAコードが正しくありません');
    }

    const memberships = await this.loadTenantMemberships(user.id);
    if (memberships.length === 0) {
      throw AppException.unauthorized('有効なテナントに所属していないためログインできません');
    }

    return this.issueSessionTokens(user.id, memberships[0]);
  }

  /**
   * `refreshToken` が指定されればそのセッションのみ、未指定なら当該ユーザーの
   * 全リフレッシュトークンを失効させる(`dto/auth.schemas.ts` のコメント参照)。
   */
  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
      await this.db.query(
        'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND token_hash = $2 AND revoked_at IS NULL',
        [userId, tokenHash],
      );
      return;
    }
    await this.db.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * 招待の状態(未検出・取消・使用済み・期限切れ)を検証し、問題があれば例外を投げる。
   * `validateInvitation` / `acceptInvite` の双方から共有される。
   */
  private assertInvitationUsable(invitation: InvitationRow | undefined): asserts invitation is InvitationRow {
    if (!invitation) {
      throw AppException.notFound('招待が見つかりません。URLをご確認ください');
    }
    if (invitation.revoked_at) {
      throw AppException.conflict('INVITATION_REVOKED', 'この招待は取り消されています');
    }
    if (invitation.accepted_at) {
      throw AppException.conflict('INVITATION_ALREADY_ACCEPTED', 'この招待は既に使用されています');
    }
    if (invitation.expires_at.getTime() <= Date.now()) {
      throw AppException.conflict('INVITATION_EXPIRED', 'この招待の有効期限が切れています');
    }
  }

  private async findInvitationByRawToken(rawToken: string): Promise<InvitationRow | undefined> {
    const tokenHash = this.hashToken(rawToken);
    const result = await this.db.query<InvitationRow>(
      `SELECT id, tenant_id, tenant_name, email::text AS email, role_code, invited_by,
              expires_at, accepted_at, revoked_at
       FROM fn_get_invitation_by_token_hash($1)`,
      [tokenHash],
    );
    return result.rows[0];
  }

  /**
   * `POST /auth/signup`: 新規テナントとそのオーナーユーザーを一括作成する。
   *
   * テナント/ユーザーのいずれもこのリクエストの中で初めて存在するため、
   * `tenants.id = fn_current_tenant_id()` / `users.id = fn_current_user_id()` という
   * RLSのWITH CHECKを満たすには、両IDをアプリ層で先に生成し、その値で
   * `db.transaction()` のRLSコンテキストを確立してから各INSERTを実行する必要がある
   * (`DatabaseService.transaction` のJSDoc参照)。
   */
  async signup(input: SignupInput): Promise<LoginResult> {
    const tenantId = randomUUID();
    const userId = randomUUID();
    const passwordHash = hashPassword(input.password);

    await this.db.transaction(tenantId, userId, async (client) => {
      // `fn_authenticate_user_by_email` はSECURITY DEFINERでテナント非依存にメール検索できるため、
      // ログイン認証だけでなく「サインアップ時点でのメール重複チェック」にもそのまま流用する。
      // 挿入直前(同一トランザクション内)でチェックすることで、チェックと挿入の間に
      // 別コネクションの処理が割り込む余地を狭める(`settings.service.ts` の
      // `createInvitation` と同じパターン。最終的な一意性は `users.email` の
      // UNIQUE制約が担保する)。
      const existing = await client.query<AuthUserRow>(
        'SELECT id, password_hash, is_active, mfa_enabled FROM fn_authenticate_user_by_email($1)',
        [input.email],
      );
      if (existing.rows.length > 0) {
        throw AppException.conflict('ALREADY_EXISTS', '指定されたメールアドレスは既に登録されています');
      }

      await client.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [tenantId, input.tenant_name]);
      await client.query(
        'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
        [userId, input.email, input.name, passwordHash],
      );
      await client.query('INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)', [tenantId, userId]);

      const roleRow = await client.query<{ id: string }>(`SELECT id FROM roles WHERE code = 'owner'`);
      const roleId = roleRow.rows[0]?.id;
      if (!roleId) {
        throw AppException.badRequest('ロール(code: owner)が見つかりません');
      }
      await client.query(
        'INSERT INTO user_roles (tenant_id, user_id, role_id, granted_by) VALUES ($1, $2, $3, $4)',
        [tenantId, userId, roleId, userId],
      );

      await client.query('INSERT INTO tenant_accounting_settings (tenant_id) VALUES ($1)', [tenantId]);

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'tenant.signed_up',
        targetType: 'tenant',
        targetId: tenantId,
        afterData: { name: input.tenant_name, owner_email: input.email },
      });
    });

    const tokens = await this.issueSessionTokens(userId, {
      tenant_id: tenantId,
      tenant_name: input.tenant_name,
      roles: ['owner'],
    });
    return {
      ...tokens,
      mfa_required: false,
      tenants: [{ tenant_id: tenantId, tenant_name: input.tenant_name }],
    };
  }

  /** `GET /auth/invitations/validate`: 招待トークンの有効性を検証し、招待先情報を返す。 */
  async validateInvitation(rawToken: string): Promise<InvitationValidationResult> {
    const invitation = await this.findInvitationByRawToken(rawToken);
    this.assertInvitationUsable(invitation);
    return { tenant_name: invitation.tenant_name, email: invitation.email, role: invitation.role_code };
  }

  /**
   * `POST /auth/accept-invite`: 招待を受諾し、対象テナントへ参加する。
   *
   * 招待先メールアドレスが既存ユーザーのものであれば新規作成はせず、送信された
   * パスワードで本人確認した上でそのユーザーを対象テナントへ追加する
   * (第三者が招待URLを知っただけで他人の既存アカウントを乗っ取れないようにするため)。
   * 未登録のメールアドレスであれば、送信されたパスワード・氏名で新規ユーザーを作成する。
   */
  async acceptInvite(input: AcceptInviteInput): Promise<LoginResult> {
    const invitation = await this.findInvitationByRawToken(input.token);
    this.assertInvitationUsable(invitation);

    const tenantId = invitation.tenant_id;
    const tenantName = invitation.tenant_name;
    const roleCode = invitation.role_code;

    // 新規ユーザーになる場合に備えてUUIDを先に生成し、`db.transaction()` のRLS
    // コンテキスト(`app.current_user_id`)をこの値で確立しておく。既存ユーザーだった
    // 場合は下記コールバック内で実際のIDに読み替える(`tenant_users`/`user_roles`/
    // `audit_logs` のRLSは `tenant_id` のみで判定するため、`current_user_id` が
    // 実際に書き込む `user_id` と一致していなくても問題ない)。
    const candidateUserId = randomUUID();
    let userId: string = candidateUserId;

    await this.db.transaction(tenantId, candidateUserId, async (client) => {
      // メール重複チェック(既存ユーザー検索)を挿入直前(同一トランザクション内)で
      // 行うことで、チェックと挿入の間に別コネクションの処理が割り込む余地を狭める。
      const existingUserResult = await client.query<AuthUserRow>(
        'SELECT id, password_hash, is_active, mfa_enabled FROM fn_authenticate_user_by_email($1)',
        [invitation.email],
      );
      const existingUser = existingUserResult.rows[0];

      if (existingUser) {
        const passwordOk = verifyPassword(input.password, existingUser.password_hash ?? DUMMY_PASSWORD_HASH);
        if (!existingUser.is_active || !passwordOk) {
          throw AppException.unauthorized('既存アカウントのパスワードが正しくないため招待を受諾できません');
        }
        userId = existingUser.id;
      } else {
        const passwordHash = hashPassword(input.password);
        await client.query(
          'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
          [candidateUserId, invitation.email, input.name, passwordHash],
        );
      }

      const memberResult = await client.query(
        'SELECT 1 FROM tenant_users WHERE tenant_id = $1 AND user_id = $2',
        [tenantId, userId],
      );
      if ((memberResult.rowCount ?? 0) > 0) {
        await client.query(
          'UPDATE tenant_users SET is_active = TRUE, left_at = NULL WHERE tenant_id = $1 AND user_id = $2',
          [tenantId, userId],
        );
      } else {
        await client.query('INSERT INTO tenant_users (tenant_id, user_id) VALUES ($1, $2)', [tenantId, userId]);
      }

      const roleRow = await client.query<{ id: string }>('SELECT id FROM roles WHERE code = $1', [roleCode]);
      const roleId = roleRow.rows[0]?.id;
      if (!roleId) {
        throw AppException.badRequest(`ロール(code: ${roleCode})が見つかりません`);
      }
      await client.query('DELETE FROM user_roles WHERE tenant_id = $1 AND user_id = $2', [tenantId, userId]);
      await client.query(
        'INSERT INTO user_roles (tenant_id, user_id, role_id, granted_by) VALUES ($1, $2, $3, $4)',
        [tenantId, userId, roleId, invitation.invited_by],
      );

      const acceptResult = await client.query(
        `UPDATE member_invitations SET accepted_at = now()
         WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`,
        [invitation.id],
      );
      if ((acceptResult.rowCount ?? 0) === 0) {
        throw AppException.conflict('INVITATION_ALREADY_ACCEPTED', 'この招待は既に使用されているか、無効です');
      }

      await this.auditLogs.record(client, tenantId, {
        actorUserId: userId,
        action: 'tenant_member.invitation_accepted',
        targetType: 'member_invitation',
        targetId: invitation.id,
        afterData: { email: invitation.email, role: roleCode },
      });
    });

    const tokens = await this.issueSessionTokens(userId, { tenant_id: tenantId, tenant_name: tenantName, roles: [roleCode] });
    return {
      ...tokens,
      mfa_required: false,
      tenants: [{ tenant_id: tenantId, tenant_name: tenantName }],
    };
  }
}
