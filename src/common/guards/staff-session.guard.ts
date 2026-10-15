import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { Request } from 'express';
import { PrismaService } from '../../database/prisma.service';
import { AppEnvironment } from '../../config/validate-env';
import { StaffPrincipal } from '../auth.types';
import { csrfTokenForSession } from '../crypto.util';

type StaffRequest = Request & { staff?: StaffPrincipal; sessionId?: string; sessionToken?: string; sessionCsrfHash?: string; csrfToken?: string };

@Injectable()
export class StaffSessionGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService<AppEnvironment, true>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<StaffRequest>();
    const token = request.cookies?.[this.config.get('SESSION_COOKIE_NAME', { infer: true })];
    if (typeof token !== 'string' || token.length < 32) throw new UnauthorizedException('Staff authentication is required');

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const session = await this.prisma.staffSession.findUnique({
      where: { tokenHash },
      include: { staffUser: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.staffUser.isActive) {
      throw new UnauthorizedException('Staff authentication is required');
    }

    request.staff = {
      id: session.staffUser.id,
      username: session.staffUser.username,
      role: session.staffUser.role,
      mustChangePassword: session.staffUser.mustChangePassword,
    };
    request.sessionId = session.id;
    request.sessionToken = token;
    request.sessionCsrfHash = session.csrfTokenHash;
    request.csrfToken = csrfTokenForSession(token);

    const isPasswordEndpoint = request.path.endsWith('/staff/auth/password');
    const isAuthEndpoint = request.path.endsWith('/staff/auth/me') || request.path.endsWith('/staff/auth/logout');
    if (session.staffUser.mustChangePassword && !isPasswordEndpoint && !isAuthEndpoint) {
      throw new UnauthorizedException('A password change is required before using this account');
    }
    return true;
  }
}
