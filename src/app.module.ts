import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppEnvironment, validateEnvironment } from './config/validate-env';
import { clientIpForRateLimit } from './common/proxy-client-ip';
import { PrismaModule } from './database/prisma.module';
import { CommonModule } from './common/common.module';
import { HealthModule } from './health/health.module';
import { StaffAuthModule } from './staff-auth/staff-auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { PublicRequestsModule } from './requests/public-requests.module';
import { StaffRequestsModule } from './requests/staff-requests.module';
import { StaffUsersModule } from './staff-users/staff-users.module';
import { AuditModule } from './audit/audit.module';
import { RequestRouteGuard } from './common/guards/request-route.guard';
import { generateRequestId, sanitizeErrorLog, sanitizeRequestLog, sanitizeResponseLog } from './common/request-logging';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        genReqId: generateRequestId,
        quietReqLogger: true,
        quietResLogger: true,
        wrapSerializers: false,
        redact: { paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers.set-cookie'], censor: '[REDACTED]' },
        customSuccessObject: (request: object, _response: object, successObject: object) => ({ ...successObject, req: request }),
        customErrorObject: (request: object, response: object, error: Error, errorObject: { responseTime?: number }) => ({
          req: request, res: response, err: error, responseTime: errorObject.responseTime,
        }),
        serializers: {
          req: sanitizeRequestLog,
          res: sanitizeResponseLog,
          err: sanitizeErrorLog,
        },
      },
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnvironment, true>) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
        getTracker: (request: Record<string, unknown>) => clientIpForRateLimit(
          request as unknown as Parameters<typeof clientIpForRateLimit>[0],
          config.get('CLIENT_IP_HMAC_SECRET', { infer: true }),
        ),
      }),
    }),
    PrismaModule,
    CommonModule,
    HealthModule,
    StaffAuthModule,
    CatalogModule,
    PublicRequestsModule,
    StaffRequestsModule,
    StaffUsersModule,
    AuditModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: RequestRouteGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
