import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context';
import { AppException } from '../../common/exceptions/app.exception';
import { type AuthenticatedRequest, TenantAuthGuard } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import {
  accountingSettingsUpdateSchema,
  aiSettingsUpdateSchema,
  memberInvitationCreateSchema,
  memberRoleUpdateSchema,
  tenantSettingsUpdateSchema,
} from './dto/settings.schemas';
import { SettingsService } from './settings.service';

const idParamSchema = z.string().uuid('idはUUID形式で指定してください');

/** 自社情報・会計処理設定の変更を行えるロール */
const SETTINGS_EDITOR_ROLES = ['owner', 'accounting_manager'];
/** メンバーのロール変更・削除を行えるロール */
const MEMBER_ROLE_EDITOR_ROLES = ['owner'];
/** メンバー招待の発行/取消を行えるロール */
const MEMBER_INVITATION_EDITOR_ROLES = ['owner', 'accounting_manager'];

@Controller('settings')
@UseGuards(TenantAuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('tenant')
  async getTenant() {
    const tenantId = this.requireTenantId();
    const tenant = await this.settingsService.getTenant(tenantId, RequestContext.getUserId());
    return successEnvelope(tenant);
  }

  @Patch('tenant')
  async updateTenant(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    this.requireRole(req, SETTINGS_EDITOR_ROLES, '自社情報の更新は owner または accounting_manager ロールのみ実行できます');
    const dto = parseWithZod(tenantSettingsUpdateSchema, body);
    const tenant = await this.settingsService.updateTenant(tenantId, userId, dto);
    return successEnvelope(tenant);
  }

  @Get('accounting')
  async getAccounting() {
    const tenantId = this.requireTenantId();
    const settings = await this.settingsService.getAccountingSettings(
      tenantId,
      RequestContext.getUserId(),
    );
    return successEnvelope(settings);
  }

  @Patch('accounting')
  async updateAccounting(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    this.requireRole(
      req,
      SETTINGS_EDITOR_ROLES,
      '会計処理設定の更新は owner または accounting_manager ロールのみ実行できます',
    );
    const dto = parseWithZod(accountingSettingsUpdateSchema, body);
    const settings = await this.settingsService.updateAccountingSettings(tenantId, userId, dto);
    return successEnvelope(settings);
  }

  @Get('integrations')
  async getIntegrations(@Req() req: AuthenticatedRequest) {
    const tenantId = this.requireTenantId();
    this.requireRole(
      req,
      SETTINGS_EDITOR_ROLES,
      '外部連携設定の閲覧は owner または accounting_manager ロールのみ実行できます',
    );
    const settings = await this.settingsService.getIntegrationSettings(
      tenantId,
      RequestContext.getUserId(),
    );
    return successEnvelope(settings);
  }

  @Patch('integrations/ai')
  async updateAiIntegration(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    this.requireRole(
      req,
      SETTINGS_EDITOR_ROLES,
      'AI連携設定の更新は owner または accounting_manager ロールのみ実行できます',
    );
    const dto = parseWithZod(aiSettingsUpdateSchema, body);
    const settings = await this.settingsService.updateAiSettings(tenantId, userId, dto);
    return successEnvelope(settings);
  }

  @Post('integrations/ai/test')
  async testAiIntegration(@Req() req: AuthenticatedRequest) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    this.requireRole(
      req,
      SETTINGS_EDITOR_ROLES,
      'AI連携の接続テストは owner または accounting_manager ロールのみ実行できます',
    );
    const result = await this.settingsService.testAiConnection(tenantId, userId);
    return successEnvelope(result);
  }

  @Get('members')
  async listMembers() {
    const tenantId = this.requireTenantId();
    const members = await this.settingsService.listMembers(tenantId, RequestContext.getUserId());
    return successEnvelope(members);
  }

  @Patch('members/:userId/role')
  async updateMemberRole(
    @Req() req: AuthenticatedRequest,
    @Param('userId') targetUserId: string,
    @Body() body: unknown,
  ) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    this.requireRole(req, MEMBER_ROLE_EDITOR_ROLES, 'メンバーのロール変更は owner ロールのみ実行できます');
    const parsedUserId = parseWithZod(idParamSchema, targetUserId);
    const dto = parseWithZod(memberRoleUpdateSchema, body);
    const member = await this.settingsService.updateMemberRole(tenantId, userId, parsedUserId, dto);
    return successEnvelope(member);
  }

  @Delete('members/invitations/:invitationId')
  async cancelInvitation(@Req() req: AuthenticatedRequest, @Param('invitationId') invitationId: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    this.requireRole(
      req,
      MEMBER_INVITATION_EDITOR_ROLES,
      'メンバー招待の取消は owner または accounting_manager ロールのみ実行できます',
    );
    const parsedId = parseWithZod(idParamSchema, invitationId);
    const invitation = await this.settingsService.cancelInvitation(tenantId, userId, parsedId);
    return successEnvelope(invitation);
  }

  @Get('members/invitations')
  async listInvitations() {
    const tenantId = this.requireTenantId();
    const invitations = await this.settingsService.listInvitations(
      tenantId,
      RequestContext.getUserId(),
    );
    return successEnvelope(invitations);
  }

  @Post('members/invitations')
  async createInvitation(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    this.requireRole(
      req,
      MEMBER_INVITATION_EDITOR_ROLES,
      'メンバー招待の発行は owner または accounting_manager ロールのみ実行できます',
    );
    const dto = parseWithZod(memberInvitationCreateSchema, body);
    const invitation = await this.settingsService.createInvitation(tenantId, userId, dto);
    return successEnvelope(invitation);
  }

  @Delete('members/:userId')
  async removeMember(@Req() req: AuthenticatedRequest, @Param('userId') targetUserId: string) {
    const tenantId = this.requireTenantId();
    const userId = this.requireUserId();
    this.requireRole(req, MEMBER_ROLE_EDITOR_ROLES, 'メンバーの削除は owner ロールのみ実行できます');
    const parsedUserId = parseWithZod(idParamSchema, targetUserId);
    const member = await this.settingsService.removeMember(tenantId, userId, parsedUserId);
    return successEnvelope(member);
  }

  private requireRole(req: AuthenticatedRequest, allowedRoles: string[], message: string): void {
    const roles = req.user?.roles ?? [];
    if (!roles.some((role) => allowedRoles.includes(role))) {
      throw AppException.forbidden(message);
    }
  }

  private requireTenantId(): string {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw AppException.unauthorized('テナントコンテキストが確立されていません');
    }
    return tenantId;
  }

  private requireUserId(): string {
    const userId = RequestContext.getUserId();
    if (!userId) {
      throw AppException.unauthorized('ユーザーコンテキストが確立されていません');
    }
    return userId;
  }
}
