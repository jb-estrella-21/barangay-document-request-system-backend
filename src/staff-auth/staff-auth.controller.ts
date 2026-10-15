import { Body, Controller, Get, Patch, Post, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { AppEnvironment } from '../config/validate-env';
import { CurrentCsrfToken, CurrentSession, CurrentStaff } from '../common/auth.decorators';
import { StaffPrincipal } from '../common/auth.types';
import { CsrfGuard } from '../common/guards/csrf.guard';
import { StaffSessionGuard } from '../common/guards/staff-session.guard';
import { LoginDto, ChangePasswordDto } from './staff-auth.dto';
import { safeStaff, StaffAuthService } from './staff-auth.service';
import { ApiJsonResponse, ApiProblemResponses, ApiStaffCsrfHeaders, schemas } from '../common/openapi';

@ApiTags('staff authentication')
@Controller('staff/auth')
export class StaffAuthController {
  constructor(private readonly auth: StaffAuthService, private readonly config: ConfigService<AppEnvironment, true>) {}

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a staff session', description: 'Public login endpoint; limit: 5 attempts per client IP per minute. On success, sets the configured Secure/HttpOnly/SameSite session cookie and returns a CSRF token. Inactive accounts and incorrect credentials share the same response.' })
  @ApiBody({ type: LoginDto })
  @ApiJsonResponse(201, 'Session created.', schemas.login, {
    'Set-Cookie': { description: 'Configured staff session cookie; HttpOnly, path-scoped to /api/v1/staff, and expires with the session.', schema: { type: 'string' } },
  })
  @ApiProblemResponses({ status: 400, description: 'Invalid login body.' }, { status: 401, description: 'Invalid username or password.' }, { status: 413, description: 'Request body exceeds 100 KB.' }, { status: 429, description: 'Login rate limit exceeded.' }, { status: 500, description: 'Unexpected API failure.' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(dto.username, dto.password);
    this.setSessionCookies(response, result.sessionToken, result.expiresAt);
    return { staff: result.staff, expiresAt: result.expiresAt, csrfToken: result.csrfToken };
  }

  @Get('me')
  @ApiCookieAuth()
  @UseGuards(StaffSessionGuard)
  @ApiOperation({ summary: 'Get the current staff account and session-bound CSRF token', description: 'Requires an active session cookie. Allowed even while a newly issued temporary password must be changed.' })
  @ApiJsonResponse(200, 'Current session and its CSRF token.', schemas.me)
  @ApiProblemResponses({ status: 401, description: 'Staff authentication is required or a password change is required for another route.' }, { status: 429, description: 'Global rate limit exceeded.' }, { status: 500, description: 'Unexpected API failure.' })
  me(@CurrentStaff() staff: StaffPrincipal, @CurrentCsrfToken() csrfToken: string) { return { staff, csrfToken }; }

  @Post('logout')
  @ApiCookieAuth()
  @UseGuards(StaffSessionGuard, CsrfGuard)
  @ApiOperation({ summary: 'Revoke the current staff session', description: 'Requires a valid staff session, allowed Origin, and session-bound CSRF token. Clears the session cookie.' })
  @ApiStaffCsrfHeaders()
  @ApiJsonResponse(201, 'Session revoked.', schemas.statusOk, { 'Set-Cookie': { description: 'Clears the configured staff session cookie.', schema: { type: 'string' } } })
  @ApiProblemResponses({ status: 401, description: 'Staff authentication is required.' }, { status: 403, description: 'Origin or CSRF verification failed.' }, { status: 413, description: 'Request body exceeds 100 KB.' }, { status: 429, description: 'Global rate limit exceeded.' }, { status: 500, description: 'Unexpected API failure.' })
  async logout(@CurrentSession() sessionId: string, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(sessionId);
    this.clearSessionCookies(response);
    return { status: 'ok' };
  }

  @Patch('password')
  @ApiCookieAuth()
  @UseGuards(StaffSessionGuard, CsrfGuard)
  @ApiOperation({ summary: 'Change the current staff password', description: 'Requires a valid staff session, allowed Origin, and CSRF token. A newly issued temporary password can be changed here; other protected actions remain unavailable until changed.' })
  @ApiStaffCsrfHeaders()
  @ApiBody({ type: ChangePasswordDto })
  @ApiJsonResponse(200, 'Password changed; other sessions for this account are revoked.', { type: 'object', required: ['status', 'mustChangePassword'], properties: { status: { type: 'string', enum: ['ok'] }, mustChangePassword: { type: 'boolean', enum: [false] } } })
  @ApiProblemResponses({ status: 400, description: 'Invalid password body or new password matches the current password.' }, { status: 401, description: 'Session is invalid or current password is incorrect.' }, { status: 403, description: 'Origin or CSRF verification failed.' }, { status: 413, description: 'Request body exceeds 100 KB.' }, { status: 429, description: 'Global rate limit exceeded.' }, { status: 500, description: 'Unexpected API failure.' })
  async changePassword(@CurrentStaff() staff: StaffPrincipal, @CurrentSession() sessionId: string, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(staff.id, sessionId, dto.currentPassword, dto.newPassword);
    return { status: 'ok', mustChangePassword: false };
  }

  private setSessionCookies(response: Response, token: string, expiresAt: Date): void {
    const options = {
      secure: this.config.get('COOKIE_SECURE', { infer: true }),
      sameSite: this.config.get('COOKIE_SAME_SITE', { infer: true }),
      expires: expiresAt,
    } as const;
    const name = this.config.get('SESSION_COOKIE_NAME', { infer: true });
    response.cookie(name, token, { ...options, httpOnly: true, path: '/api/v1/staff' });
  }

  private clearSessionCookies(response: Response): void {
    const secure = this.config.get('COOKIE_SECURE', { infer: true });
    const sameSite = this.config.get('COOKIE_SAME_SITE', { infer: true });
    const name = this.config.get('SESSION_COOKIE_NAME', { infer: true });
    response.clearCookie(name, { secure, sameSite, httpOnly: true, path: '/api/v1/staff' });
  }
}
