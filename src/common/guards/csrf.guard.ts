import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { AppEnvironment } from '../../config/validate-env';
import { isConfiguredOrigin } from '../origin-policy';

type SessionRequest = Request & { sessionCsrfHash?: string };

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly config: ConfigService<AppEnvironment, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<SessionRequest>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;

    const allowedOrigins = this.config.get('CORS_ORIGINS', { infer: true });
    const origin = request.header('origin');
    if (!origin || !isConfiguredOrigin(origin, allowedOrigins)) throw new ForbiddenException('Request origin is not allowed');

    const headerToken = request.header('x-csrf-token');
    if (typeof headerToken !== 'string' || headerToken.length < 32 || !request.sessionCsrfHash) {
      throw new ForbiddenException('A valid CSRF token is required');
    }

    const actual = createHash('sha256').update(headerToken).digest();
    const expected = Buffer.from(request.sessionCsrfHash, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ForbiddenException('A valid CSRF token is required');
    return true;
  }
}
