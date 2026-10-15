import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { NextFunction, Request, Response } from 'express';
import { json, urlencoded } from 'express';
import { AppEnvironment } from '../config/validate-env';
import { ProblemDetailsFilter } from './problem-details.filter';
import { ensureResponseRequestId, sanitizeRoute } from './request-logging';
import { setupOpenApi } from './openapi';

/** Apply the same HTTP middleware and API configuration in production and E2E tests. */
export function configureHttpApplication(app: INestApplication): ConfigService<AppEnvironment, true> {
  const config = app.get(ConfigService) as ConfigService<AppEnvironment, true>;
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1', { exclude: [{ path: 'health', method: RequestMethod.GET }] });
  app.use(json({ limit: '100kb' }), urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  if (config.get('TRUST_PROXY', { infer: true })) app.getHttpAdapter().getInstance().set('trust proxy', 1);

  const origins = config.get('CORS_ORIGINS', { infer: true });
  app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      if (!origin || origins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key', 'If-Match'],
    exposedHeaders: ['ETag', 'X-Request-Id'],
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new ProblemDetailsFilter());
  setupOpenApi(app, config.get('SESSION_COOKIE_NAME', { infer: true }));

  app.use((error: { type?: string }, request: Request, response: Response, next: NextFunction) => {
    if (error?.type === 'entity.too.large') {
      const requestId = ensureResponseRequestId(response);
      return response.status(413).type('application/problem+json').json({
        type: 'about:blank', title: 'Payload Too Large', status: 413,
        detail: 'Request body exceeds the 100 KB limit', instance: sanitizeRoute(request), requestId,
      });
    }
    return next(error);
  });

  return config;
}
