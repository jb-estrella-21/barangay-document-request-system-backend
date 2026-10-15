import { RequestMethod } from '@nestjs/common';
import request from 'supertest';

describe('OpenAPI document', () => {
  it('describes queue search, authentication, CSRF, version headers, and problem responses', async () => {
    const previous = {
      NODE_ENV: process.env.NODE_ENV,
      DATABASE_URL: process.env.DATABASE_URL,
      IDEMPOTENCY_ENCRYPTION_KEY: process.env.IDEMPOTENCY_ENCRYPTION_KEY,
      CORS_ORIGINS: process.env.CORS_ORIGINS,
    };
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/openapi_test';
    process.env.IDEMPOTENCY_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.CORS_ORIGINS = 'https://client.example';

    let app: import('@nestjs/common').INestApplication | undefined;
    try {
      const [{ Test }, { AppModule }, { PrismaService }, { setupOpenApi }] = await Promise.all([
        import('@nestjs/testing'),
        import('../app.module'),
        import('../database/prisma.service'),
        import('./openapi'),
      ]);
      const testingModule = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue({})
        .compile();
      app = testingModule.createNestApplication();
      app.setGlobalPrefix('api/v1', { exclude: [{ path: 'health', method: RequestMethod.GET }] });
      const document = setupOpenApi(app, 'test_staff_session');
      await app.init();
      const published = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
      const search = document.paths['/api/v1/staff/requests/search'].post!;
      const searchDto = document.components?.schemas?.RequestQueueSearchDto as {
        required?: string[];
        properties?: Record<string, { maxLength?: number }>;
      };
      const searchResponses = search.responses as unknown as Record<string, {
        content?: Record<string, { schema?: Record<string, unknown> }>;
      }>;
      const requestDetailResponses = document.paths['/api/v1/staff/requests/{id}'].get?.responses as unknown as Record<string, {
        headers?: Record<string, unknown>;
      }>;

      expect(search.summary).toContain('Search the request queue');
      expect(search.security).toContainEqual({ cookie: [] });
      expect(search.responses?.['200']).toBeDefined();
      expect(searchDto.required).toContain('search');
      expect(searchDto.properties?.search?.maxLength).toBe(160);
      expect(search.parameters?.map((parameter) => (parameter as { name: string }).name)).toEqual(expect.arrayContaining(['Origin', 'X-CSRF-Token']));
      expect(searchResponses['200']?.content?.['application/json']?.schema).toMatchObject({
        properties: { data: expect.any(Object), nextCursor: expect.any(Object) },
      });
      expect(searchResponses['400']?.content?.['application/problem+json']?.schema).toMatchObject({ $ref: expect.stringContaining('ProblemDetailsDto') });
      expect(document.paths['/api/v1/staff/requests'].get?.parameters?.map((parameter) => (parameter as { name: string }).name)).not.toContain('search');
      expect(document.paths['/api/v1/requests'].post?.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Idempotency-Key', required: true })]));
      expect(document.paths['/api/v1/requests'].post?.responses?.['201']).toBeDefined();
      expect(document.paths['/api/v1/requests/track'].post?.responses?.['200']).toBeDefined();
      expect(requestDetailResponses['200']?.headers?.ETag).toBeDefined();
      expect(document.paths['/api/v1/staff/requests/{id}/transitions'].post?.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'If-Match', required: true })]));
      expect(document.paths['/api/v1/staff/requests/{id}/transitions'].post?.responses?.['201']).toBeDefined();
      expect(document.paths['/api/v1/staff/requests/{id}/release-date'].patch?.responses?.['200']).toBeDefined();
      expect(document.components?.securitySchemes?.cookie).toMatchObject({ type: 'apiKey', in: 'cookie', name: 'test_staff_session' });
      expect(document.paths['/api/v1/staff/users'].post?.description).toContain('Administrator only');
      expect(document.paths['/health'].get).toBeDefined();
      expect(published.body.paths['/api/v1/staff/requests/search'].post.summary).toBe(search.summary);
      const implementedRoutes: Array<[string, string]> = [
        ['/health', 'get'], ['/api/v1/document-types', 'get'], ['/api/v1/requests', 'post'], ['/api/v1/requests/track', 'post'],
        ['/api/v1/staff/auth/login', 'post'], ['/api/v1/staff/auth/me', 'get'], ['/api/v1/staff/auth/logout', 'post'], ['/api/v1/staff/auth/password', 'patch'],
        ['/api/v1/staff/summary', 'get'], ['/api/v1/staff/requests', 'get'], ['/api/v1/staff/requests/search', 'post'],
        ['/api/v1/staff/requests/{id}', 'get'], ['/api/v1/staff/requests/{id}/transitions', 'post'], ['/api/v1/staff/requests/{id}/release-date', 'patch'],
        ['/api/v1/staff/document-types', 'get'], ['/api/v1/staff/document-types', 'post'], ['/api/v1/staff/document-types/{id}', 'patch'],
        ['/api/v1/staff/document-types/{id}/activate', 'post'], ['/api/v1/staff/document-types/{id}/deactivate', 'post'],
        ['/api/v1/staff/users', 'get'], ['/api/v1/staff/users', 'post'], ['/api/v1/staff/users/{id}', 'patch'],
        ['/api/v1/staff/users/{id}/reset-password', 'post'], ['/api/v1/staff/audit-events', 'get'],
      ];
      for (const [path, method] of implementedRoutes) {
        expect((document.paths[path] as unknown as Record<string, unknown> | undefined)?.[method]).toBeDefined();
      }
    } finally {
      await app?.close();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
