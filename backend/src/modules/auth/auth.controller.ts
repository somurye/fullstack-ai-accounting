import { Body, Controller, Get, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../common/guards/tenant-auth.guard';
import { successEnvelope } from '../../common/http/envelope';
import { parseWithZod } from '../../common/validation/zod-parse';
import { AuthService } from './auth.service';
import {
  acceptInviteSchema,
  loginSchema,
  logoutSchema,
  mfaVerifySchema,
  signupSchema,
  validateInvitationSchema,
} from './dto/auth.schemas';

/**
 * AuthController
 * ==============
 * `docs/openapi.yaml` `tags: [Auth]` を実装する。`/auth/login` `/auth/mfa` `/auth/signup`
 * `/auth/invitations/validate` `/auth/accept-invite` はスキーマ上 `security: []` (認証不要)。
 * `/auth/logout` のみアクセストークンが必須。
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown) {
    const dto = parseWithZod(loginSchema, body);
    const result = await this.authService.login(dto.email, dto.password);
    return successEnvelope(result);
  }

  @Post('mfa')
  @HttpCode(200)
  async verifyMfa(@Body() body: unknown) {
    const dto = parseWithZod(mfaVerifySchema, body);
    const result = await this.authService.verifyMfa(dto.mfa_token, dto.code);
    return successEnvelope(result);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async logout(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<void> {
    const dto = parseWithZod(logoutSchema, body ?? {});
    await this.authService.logout(req.user.sub, dto.refresh_token);
  }

  @Post('signup')
  @HttpCode(201)
  async signup(@Body() body: unknown) {
    const dto = parseWithZod(signupSchema, body);
    const result = await this.authService.signup(dto);
    return successEnvelope(result);
  }

  @Get('invitations/validate')
  @HttpCode(200)
  async validateInvitation(@Query() query: unknown) {
    const dto = parseWithZod(validateInvitationSchema, query);
    const result = await this.authService.validateInvitation(dto.token);
    return successEnvelope(result);
  }

  @Post('accept-invite')
  @HttpCode(200)
  async acceptInvite(@Body() body: unknown) {
    const dto = parseWithZod(acceptInviteSchema, body);
    const result = await this.authService.acceptInvite(dto);
    return successEnvelope(result);
  }
}
