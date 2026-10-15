import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { NextFunction, Request, Response } from 'express';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RequestStatus, StaffRole } from '@prisma/client';
import * as argon2 from 'argon2';
import request, { Agent } from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import { configureHttpApplication } from '../src/common/application-setup';
import { StaffUsersService } from '../src/staff-users/staff-users.service';
import { runOnlyAfterDatabaseIdentity, withValidatedE2eConfiguration } from './e2e-safety';

describe('Barangay request API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Agent;
  let processor: Agent;
  let adminCsrf: string;
  let processorCsrf: string;
  let processorId: string;
  let typeId: string;
  let staffRequestSequence = 0;

  const origin = 'http://localhost:5173';
  const testProxySecret = Buffer.alloc(32, 23);

  beforeAll(async () => withValidatedE2eConfiguration(process.env, async (database) => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = database.databaseUrl;
    process.env.CORS_ORIGINS = origin;
    process.env.TRUST_PROXY = 'false';
    process.env.LOG_LEVEL = 'silent';
    process.env.COOKIE_SECURE = 'false';
    process.env.COOKIE_SAME_SITE = 'lax';
    process.env.SESSION_COOKIE_NAME = 'test_staff_session';
    process.env.IDEMPOTENCY_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64');
    process.env.CLIENT_IP_HMAC_SECRET = testProxySecret.toString('base64');
    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ bodyParser: false });
    configureHttpApplication(app);
    // Simulate the Pages edge locally: only this test proxy signs its synthetic IP header.
    app.use((req: Request, _res: Response, next: NextFunction) => {
      if (req.headers['x-proxy-client-ip']) return next();
      const forwarded = req.headers['x-forwarded-for'];
      const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '';
      if (isIP(ip) !== 0) {
        const timestamp = String(Math.floor(Date.now() / 1000));
        const message = ['v1', timestamp, ip, req.method.toUpperCase(), req.path].join('\n');
        req.headers['x-proxy-client-ip'] = ip;
        req.headers['x-proxy-client-ip-timestamp'] = timestamp;
        req.headers['x-proxy-client-ip-signature'] = createHmac('sha256', testProxySecret).update(message).digest('hex');
      }
      next();
    });
    try {
      await app.init();
      prisma = app.get(PrismaService);
      await runOnlyAfterDatabaseIdentity(database.databaseName, async () => {
        const rows = await prisma.$queryRaw<Array<{ databaseName: string }>>`SELECT current_database() AS "databaseName"`;
        return rows[0]?.databaseName ?? '';
      }, clearDatabase);
      await prisma.staffUser.create({
        data: {
          username: 'admin', passwordHash: await argon2.hash('initial-admin-password', { type: argon2.argon2id }),
          role: StaffRole.ADMINISTRATOR,
        },
      });

      admin = request.agent(app.getHttpServer());
      const adminLogin = await admin.post('/api/v1/staff/auth/login').send({ username: 'admin', password: 'initial-admin-password' }).expect(201);
      expect(adminLogin.headers['x-request-id']).toBeTruthy();
      adminCsrf = adminLogin.body.csrfToken;
      const restoredSession = await withTestIp(admin).get('/api/v1/staff/auth/me').expect(200);
      expect(restoredSession.body.csrfToken).toBe(adminCsrf);
    } catch (error) {
      await app.close();
      throw error;
    }
  }));

  afterAll(async () => {
    await app?.close();
  });

  async function clearDatabase() {
    await prisma.submissionIdempotency.deleteMany();
    await prisma.auditEvent.deleteMany();
    await prisma.requestStatusHistory.deleteMany();
    await prisma.documentRequest.deleteMany();
    await prisma.documentTypeVersion.deleteMany();
    await prisma.documentType.deleteMany();
    await prisma.staffSession.deleteMany();
    await prisma.staffUser.deleteMany();
  }

  function adminRequest() {
    return withTestIp(admin);
  }

  function processorRequest() {
    return withTestIp(processor);
  }

  function withTestIp(agent: Agent) {
    const ip = testIp(`staff-request-${++staffRequestSequence}`);
    return {
      get: (path: string) => agent.get(path).set('X-Forwarded-For', ip),
      post: (path: string) => agent.post(path).set('X-Forwarded-For', ip),
      patch: (path: string) => agent.patch(path).set('X-Forwarded-For', ip),
    };
  }

  function createRequest(idempotencyKey: string, options: {
    documentTypeId?: string;
    fullName?: string;
    contactNumber?: string;
    address?: string;
    fields?: Record<string, unknown>;
  } = {}) {
    return request(app.getHttpServer()).post('/api/v1/requests')
      .set('X-Forwarded-For', testIp(idempotencyKey))
      .set('Idempotency-Key', idempotencyKey)
      .send({
        documentTypeId: options.documentTypeId ?? typeId,
        applicant: {
          fullName: options.fullName ?? 'Resident Example',
          contactNumber: options.contactNumber ?? '+639171234567',
          address: options.address ?? 'Barangay Example',
        },
        fields: options.fields ?? { purpose: 'Employment' },
      });
  }

  it('does not treat valid proxy rate-limit metadata as staff authentication', async () => {
    const path = '/api/v1/staff/auth/me';
    const ip = '198.51.100.230';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const message = ['v1', timestamp, ip, 'GET', path].join('\n');
    const signature = createHmac('sha256', testProxySecret).update(message).digest('hex');
    await request(app.getHttpServer()).get(path).set({
      'X-Proxy-Client-IP': ip,
      'X-Proxy-Client-IP-Timestamp': timestamp,
      'X-Proxy-Client-IP-Signature': signature,
    }).expect(401);
  });

  it('serializes concurrent first-administrator bootstrap attempts', async () => {
    await prisma.staffSession.deleteMany();
    await prisma.staffUser.deleteMany();
    const users = app.get(StaffUsersService);
    const passwordHash = await argon2.hash('bootstrap-test-password', { type: argon2.argon2id });
    const attempts = await Promise.allSettled([
      users.createFirstAdministrator('bootstrap.first', passwordHash),
      users.createFirstAdministrator('bootstrap.second', passwordHash),
    ]);
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason.message).toContain('An administrator already exists');
    await expect(prisma.staffUser.count({ where: { role: StaffRole.ADMINISTRATOR } })).resolves.toBe(1);
    await expect(users.createFirstAdministrator('bootstrap.third', passwordHash)).rejects.toThrow('An administrator already exists');

    await prisma.staffSession.deleteMany();
    await prisma.staffUser.deleteMany();
    await prisma.staffUser.create({
      data: {
        username: 'admin', passwordHash: await argon2.hash('initial-admin-password', { type: argon2.argon2id }),
        role: StaffRole.ADMINISTRATOR,
      },
    });
    admin = request.agent(app.getHttpServer());
    const login = await admin.post('/api/v1/staff/auth/login').send({ username: 'admin', password: 'initial-admin-password' }).expect(201);
    adminCsrf = login.body.csrfToken;
  });

  it('keeps an active administrator during simultaneous demotion and deactivation', async () => {
    const baselineAdmin = await prisma.staffUser.findUniqueOrThrow({ where: { username: 'admin' } });
    await prisma.staffUser.update({ where: { id: baselineAdmin.id }, data: { role: StaffRole.PROCESSOR } });
    const passwordHash = await argon2.hash('concurrency-test-password', { type: argon2.argon2id });
    const actorA = await prisma.staffUser.create({ data: { username: 'concurrency.admin.a', passwordHash, role: StaffRole.ADMINISTRATOR } });
    const actorB = await prisma.staffUser.create({ data: { username: 'concurrency.admin.b', passwordHash, role: StaffRole.ADMINISTRATOR } });
    try {
      const users = app.get(StaffUsersService);
      const results = await Promise.allSettled([
        users.update(actorA.id, actorB.id, { role: StaffRole.PROCESSOR }),
        users.update(actorB.id, actorA.id, { isActive: false }),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected?.status === 'rejected' && rejected.reason.message).toContain('last active administrator');
      await expect(prisma.staffUser.count({ where: { role: StaffRole.ADMINISTRATOR, isActive: true } })).resolves.toBe(1);
    } finally {
      await prisma.staffSession.deleteMany({ where: { staffUserId: { in: [actorA.id, actorB.id] } } });
      await prisma.staffUser.deleteMany({ where: { id: { in: [actorA.id, actorB.id] } } });
      await prisma.staffUser.update({ where: { id: baselineAdmin.id }, data: { role: StaffRole.ADMINISTRATOR, isActive: true } });
    }
  });

  it('publishes accurate OpenAPI schemas, security, headers, and endpoint methods', async () => {
    const document = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const search = document.body.paths['/api/v1/staff/requests/search'].post;
    expect(search.summary).toContain('Search the request queue');
    expect(search.security).toContainEqual({ cookie: [] });
    const searchSchema = search.requestBody.content['application/json'].schema;
    const searchDto = document.body.components.schemas.RequestQueueSearchDto;
    expect(searchDto.required).toContain('search');
    expect(searchDto.properties.search.maxLength).toBe(160);
    expect(search.parameters.map((parameter: { name: string }) => parameter.name)).toEqual(expect.arrayContaining(['Origin', 'X-CSRF-Token']));
    expect(search.responses['200'].content['application/json'].schema.properties).toEqual(expect.objectContaining({ data: expect.any(Object), nextCursor: expect.any(Object) }));
    expect(search.responses['400'].content['application/problem+json'].schema.$ref).toContain('ProblemDetailsDto');
    expect(document.body.paths['/api/v1/staff/requests'].get.parameters.map((parameter: { name: string }) => parameter.name)).not.toContain('search');
    expect(document.body.paths['/api/v1/requests'].post.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Idempotency-Key', required: true })]));
    expect(document.body.paths['/api/v1/staff/requests/{id}'].get.responses['200'].headers.ETag).toBeDefined();
    expect(document.body.paths['/api/v1/staff/requests/{id}/transitions'].post.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'If-Match', required: true })]));
    expect(document.body.paths['/api/v1/staff/users'].post.description ?? document.body.paths['/api/v1/staff/users'].post.summary).toContain('Administrator');
    expect(searchSchema.$ref).toContain('RequestQueueSearchDto');
    expect(document.body.components.securitySchemes.cookie).toMatchObject({ type: 'apiKey', in: 'cookie' });
  });

  it('creates a catalog type and enforces processor permissions', async () => {
    const catalog = await adminRequest().post('/api/v1/staff/document-types')
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf)
      .send({
        slug: 'barangay-clearance', name: 'Barangay Clearance', description: 'Certificate for local use',
        requirements: ['Bring a valid ID'],
        fields: [{ key: 'purpose', label: 'Purpose', type: 'text', required: true }],
      }).expect(201);
    typeId = catalog.body.id;
    expect(catalog.body.version).toBe(1);

    const created = await adminRequest().post('/api/v1/staff/users')
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf)
      .send({ username: 'processor.one', role: 'PROCESSOR' }).expect(201);
    processorId = created.body.staff.id;
    processor = request.agent(app.getHttpServer());
    const login = await processor.post('/api/v1/staff/auth/login').set('X-Forwarded-For', testIp('processor-login-one'))
      .send({ username: 'processor.one', password: created.body.temporaryPassword }).expect(201);
    const sessionCookie = String(login.headers['set-cookie']).toLowerCase();
    expect(sessionCookie).toContain('httponly');
    expect(sessionCookie).toContain('samesite=lax');
    expect(sessionCookie).toContain('path=/api/v1/staff');
    processorCsrf = login.body.csrfToken;
    expect(login.body.staff.mustChangePassword).toBe(true);
    await processorRequest().get('/api/v1/staff/requests').expect(401);
    const secondProcessorSession = request.agent(app.getHttpServer());
    await secondProcessorSession.post('/api/v1/staff/auth/login').set('X-Forwarded-For', testIp('processor-login-two'))
      .send({ username: 'processor.one', password: created.body.temporaryPassword }).expect(201);
    await processorRequest().patch('/api/v1/staff/auth/password').set('Origin', origin).set('X-CSRF-Token', processorCsrf)
      .send({ currentPassword: created.body.temporaryPassword, newPassword: 'new-processor-password' }).expect(200);
    await withTestIp(secondProcessorSession).get('/api/v1/staff/auth/me').expect(401);
    await processorRequest().get('/api/v1/staff/requests').expect(200);
    await processorRequest().get('/api/v1/staff/users').expect(403);
    await processorRequest().get('/api/v1/staff/audit-events').expect(403);
    await processorRequest().get('/api/v1/staff/document-types').expect(403);
    await processorRequest().post('/api/v1/staff/users').set('Origin', origin).set('X-CSRF-Token', processorCsrf)
      .send({ username: 'processor.cannot.create', role: StaffRole.PROCESSOR }).expect(403);
    await processorRequest().patch(`/api/v1/staff/document-types/${typeId}`)
      .set('Origin', origin).set('X-CSRF-Token', processorCsrf)
      .send({ name: 'Unauthorized change' }).expect(403);

    const logoutSession = request.agent(app.getHttpServer());
    const logoutLogin = await logoutSession.post('/api/v1/staff/auth/login').set('X-Forwarded-For', testIp('processor-logout-login'))
      .send({ username: 'processor.one', password: 'new-processor-password' }).expect(201);
    await withTestIp(logoutSession).post('/api/v1/staff/auth/logout')
      .set('Origin', origin).set('X-CSRF-Token', logoutLogin.body.csrfToken).expect(201);
    await withTestIp(logoutSession).get('/api/v1/staff/auth/me').expect(401);

    const reset = await adminRequest().post(`/api/v1/staff/users/${processorId}/reset-password`)
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf).expect(201);
    await processorRequest().get('/api/v1/staff/requests').expect(401);
    const resetLogin = await processor.post('/api/v1/staff/auth/login').set('X-Forwarded-For', testIp('processor-reset-login'))
      .send({ username: 'processor.one', password: reset.body.temporaryPassword }).expect(201);
    processorCsrf = resetLogin.body.csrfToken;
    await processorRequest().get('/api/v1/staff/requests').expect(401);
    await processorRequest().patch('/api/v1/staff/auth/password').set('Origin', origin).set('X-CSRF-Token', processorCsrf)
      .send({ currentPassword: reset.body.temporaryPassword, newPassword: 'after-admin-reset-password' }).expect(200);
    await adminRequest().patch(`/api/v1/staff/users/${processorId}`)
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf).send({ isActive: false }).expect(200);
    await processorRequest().get('/api/v1/staff/requests').expect(401);
    const disabledLogin = await request(app.getHttpServer()).post('/api/v1/staff/auth/login')
      .set('X-Forwarded-For', testIp('processor-disabled-login'))
      .send({ username: 'processor.one', password: 'after-admin-reset-password' }).expect(401);
    expect(disabledLogin.body.detail).toBe('Invalid username or password');
  });

  it('returns the same login failure for unknown users and wrong passwords', async () => {
    const unknown = await request(app.getHttpServer()).post('/api/v1/staff/auth/login')
      .set('X-Forwarded-For', testIp('unknown-user-login'))
      .send({ username: 'no.such.user', password: 'wrong-password' }).expect(401);
    const wrongPassword = await request(app.getHttpServer()).post('/api/v1/staff/auth/login')
      .set('X-Forwarded-For', testIp('wrong-password-login'))
      .send({ username: 'admin', password: 'incorrect-password' }).expect(401);
    expect(unknown.body.title).toBe(wrongPassword.body.title);
    expect(unknown.body.detail).toBe(wrongPassword.body.detail);
    expect(unknown.body.detail).toBe('Invalid username or password');
  });

  it('enforces session expiry and revokes sessions when an account role changes', async () => {
    const created = await adminRequest().post('/api/v1/staff/users')
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf)
      .send({ username: 'rolechange.one', role: StaffRole.PROCESSOR }).expect(201);
    const oldSession = request.agent(app.getHttpServer());
    const login = await oldSession.post('/api/v1/staff/auth/login').set('X-Forwarded-For', testIp('rolechange-login'))
      .send({ username: 'rolechange.one', password: created.body.temporaryPassword }).expect(201);
    await withTestIp(oldSession).patch('/api/v1/staff/auth/password')
      .set('Origin', origin).set('X-CSRF-Token', login.body.csrfToken)
      .send({ currentPassword: created.body.temporaryPassword, newPassword: 'role-change-test-password' }).expect(200);

    await adminRequest().patch(`/api/v1/staff/users/${created.body.staff.id}`)
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf).send({ role: StaffRole.ADMINISTRATOR }).expect(200);
    await withTestIp(oldSession).get('/api/v1/staff/users').expect(401);

    const administratorSession = request.agent(app.getHttpServer());
    await administratorSession.post('/api/v1/staff/auth/login').set('X-Forwarded-For', testIp('rolechange-admin-login'))
      .send({ username: 'rolechange.one', password: 'role-change-test-password' }).expect(201);
    await withTestIp(administratorSession).get('/api/v1/staff/users').expect(200);
    await adminRequest().patch(`/api/v1/staff/users/${created.body.staff.id}`)
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf).send({ role: StaffRole.PROCESSOR }).expect(200);
    await withTestIp(administratorSession).get('/api/v1/staff/users').expect(401);

    const processorSession = request.agent(app.getHttpServer());
    await processorSession.post('/api/v1/staff/auth/login').set('X-Forwarded-For', testIp('rolechange-processor-login'))
      .send({ username: 'rolechange.one', password: 'role-change-test-password' }).expect(201);
    await withTestIp(processorSession).get('/api/v1/staff/users').expect(403);

    const expiring = await adminRequest().post('/api/v1/staff/users')
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf)
      .send({ username: 'session.expiry', role: StaffRole.PROCESSOR }).expect(201);
    const expiringSession = request.agent(app.getHttpServer());
    await expiringSession.post('/api/v1/staff/auth/login').set('X-Forwarded-For', testIp('session-expiry-login'))
      .send({ username: 'session.expiry', password: expiring.body.temporaryPassword }).expect(201);
    const expiringUser = await prisma.staffUser.findUniqueOrThrow({ where: { username: 'session.expiry' } });
    await prisma.staffSession.updateMany({ where: { staffUserId: expiringUser.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await withTestIp(expiringSession).get('/api/v1/staff/auth/me').expect(401);
  });

  it('supports anonymous submission, idempotent retry, secure tracking, and privacy-limited responses', async () => {
    const key = 'test-idempotency-key-00001';
    const submitted = await createRequest(key).expect(201);
    const replay = await createRequest(key).expect(201);
    expect(replay.body.reference).toBe(submitted.body.reference);
    expect(replay.body.trackingCredential).toBe(submitted.body.trackingCredential);
    const separateRequest = await createRequest('separate-anonymous-request-key-001').expect(201);
    expect(separateRequest.body.reference).not.toBe(submitted.body.reference);
    expect(separateRequest.body.trackingCredential).not.toBe(submitted.body.trackingCredential);

    await request(app.getHttpServer()).post('/api/v1/requests').set('Idempotency-Key', key)
      .set('X-Forwarded-For', testIp(key))
      .send({
        documentTypeId: typeId,
        applicant: { fullName: 'Resident Example', contactNumber: '+639171234567', address: 'Barangay Example' },
        fields: { purpose: 'Different purpose' },
      }).expect(409);

    const tracked = await request(app.getHttpServer()).post('/api/v1/requests/track')
      .send({ reference: submitted.body.reference, trackingCredential: submitted.body.trackingCredential }).expect(200);
    expect(tracked.body.status).toBe('SUBMITTED');
    expect(tracked.body.documentName).toBe('Barangay Clearance');
    expect(tracked.body).not.toHaveProperty('fullName');
    expect(tracked.body).not.toHaveProperty('address');
    expect(tracked.body).not.toHaveProperty('trackingCredential');
    await request(app.getHttpServer()).post('/api/v1/requests/track')
      .send({ reference: submitted.body.reference, trackingCredential: `${submitted.body.trackingCredential}x` }).expect(404);

    const invalid = await request(app.getHttpServer()).post('/api/v1/requests')
      .set('Idempotency-Key', 'another-idempotency-key-0001')
      .send({ documentTypeId: typeId, applicant: { fullName: 'Resident Example', contactNumber: '09171234567', address: 'Barangay Example' }, fields: {} })
      .expect(400);
    expect(invalid.headers['content-type']).toContain('application/problem+json');
  });

  it('validates document-specific fields and applicant boundary values', async () => {
    const createdType = await adminRequest().post('/api/v1/staff/document-types')
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf)
      .send({
        slug: 'phase3-validation', name: 'Phase 3 validation fixture', description: 'Temporary E2E validation fixture',
        requirements: ['Bring a valid ID'],
        fields: [
          { key: 'purpose', label: 'Purpose', type: 'text', required: true },
          { key: 'appointment_date', label: 'Appointment date', type: 'date', required: false },
          { key: 'category', label: 'Category', type: 'select', required: true, options: ['General', 'Employment'] },
        ],
      }).expect(201);
    const validationTypeId = createdType.body.id as string;
    const validOptions = { documentTypeId: validationTypeId, fields: { purpose: 'Work', category: 'General' } };

    await createRequest('phase3-missing-category-0001', { ...validOptions, fields: { purpose: 'Work' } }).expect(400);
    await createRequest('phase3-invalid-date-000001', { ...validOptions, fields: { purpose: 'Work', category: 'General', appointment_date: '2026-02-30' } }).expect(400);
    await createRequest('phase3-invalid-option-000001', { ...validOptions, fields: { purpose: 'Work', category: 'Unknown' } }).expect(400);
    await createRequest('phase3-unknown-field-000001', { ...validOptions, fields: { purpose: 'Work', category: 'General', private: 'unexpected' } }).expect(400);
    await createRequest('phase3-long-field-0000001', { ...validOptions, fields: { purpose: 'x'.repeat(1001), category: 'General' } }).expect(400);
    await request(app.getHttpServer()).post('/api/v1/requests').set('X-Forwarded-For', testIp('phase3-missing-applicant'))
      .set('Idempotency-Key', 'phase3-missing-applicant-0001')
      .send({ documentTypeId: validationTypeId, applicant: { fullName: 'Resident Name', address: 'Example address' }, fields: { purpose: 'Work', category: 'General' } })
      .expect(400);
    await request(app.getHttpServer()).post('/api/v1/requests').set('X-Forwarded-For', testIp('phase3-unknown-top-level'))
      .set('Idempotency-Key', 'phase3-unknown-top-level-0001')
      .send({ documentTypeId: validationTypeId, applicant: { fullName: 'Resident Name', contactNumber: '+639171234567', address: 'Example address' }, fields: { purpose: 'Work', category: 'General' }, extra: true })
      .expect(400);
    await createRequest('phase3-blank-name-0000001', { ...validOptions, fullName: '   ' }).expect(400);
    await createRequest('phase3-no-digit-phone-00001', { ...validOptions, contactNumber: '--------' }).expect(400);
    await request(app.getHttpServer()).post('/api/v1/requests/track').set('X-Forwarded-For', testIp('phase3-invalid-track-input'))
      .send({ reference: 'valid-looking-reference', trackingCredential: 'too-short' }).expect(400);

    const boundary = await createRequest('b'.repeat(200), {
      ...validOptions,
      fullName: 'R'.repeat(160), contactNumber: '+639'.padEnd(40, '1'), address: 'A'.repeat(500),
      fields: { purpose: 'x'.repeat(1000), category: 'Employment' },
    }).expect(201);
    expect(boundary.body.reference).toBeTruthy();
    await createRequest('c'.repeat(201), validOptions).expect(400);
    await createRequest('x'.repeat(15), validOptions).expect(400);
  });

  it('handles concurrent idempotent retries and expired replay credentials safely', async () => {
    const key = 'phase3-concurrent-idempotency-key';
    const [first, second] = await Promise.all([createRequest(key), createRequest(key)]);
    expect([first.status, second.status].sort()).toEqual([201, 201]);
    expect(first.body.reference).toBe(second.body.reference);
    expect(first.body.trackingCredential).toBe(second.body.trackingCredential);
    await expect(prisma.documentRequest.count({ where: { reference: first.body.reference } })).resolves.toBe(1);

    const expiringKey = 'phase3-expired-idempotency-key';
    const submitted = await createRequest(expiringKey).expect(201);
    await prisma.submissionIdempotency.update({
      where: { requestId: (await prisma.documentRequest.findUniqueOrThrow({ where: { reference: submitted.body.reference } })).id },
      data: { responseExpiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await createRequest(expiringKey).expect(409);
    expect(expired.body.code).toBe('IDEMPOTENCY_RESPONSE_EXPIRED');

    const wrongReference = await request(app.getHttpServer()).post('/api/v1/requests/track')
      .set('X-Forwarded-For', testIp('tracking-wrong-reference'))
      .send({ reference: 'NOT-A-REAL-REFERENCE', trackingCredential: submitted.body.trackingCredential }).expect(404);
    const wrongCredential = await request(app.getHttpServer()).post('/api/v1/requests/track')
      .set('X-Forwarded-For', testIp('tracking-wrong-credential'))
      .send({ reference: submitted.body.reference, trackingCredential: `${submitted.body.trackingCredential}x` }).expect(404);
    expect(wrongReference.body.detail).toBe(wrongCredential.body.detail);
  });

  it('accepts applicant search filters in a POST body and rejects search in a GET URL', async () => {
    const submitted = await createRequest('post-search-test-key-00001').expect(201);
    const searched = await adminRequest().post('/api/v1/staff/requests/search')
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf)
      .send({ search: 'Resident Example', status: 'SUBMITTED', limit: 1 }).expect(200);
    expect(searched.body).toHaveProperty('data');
    expect(searched.body).toHaveProperty('nextCursor');
    expect(searched.body.data.some((entry: { reference: string }) => entry.reference === submitted.body.reference)).toBe(true);

    await adminRequest().get('/api/v1/staff/requests?search=Resident%20Example').expect(400);
  });

  it('blocks new requests after deactivation while preserving existing requests and history', async () => {
    const submitted = await createRequest('deactivation-test-key-00001').expect(201);
    const found = await prisma.documentRequest.findUniqueOrThrow({ where: { reference: submitted.body.reference } });
    await adminRequest().patch(`/api/v1/staff/document-types/${typeId}`)
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf)
      .send({
        name: 'Barangay Clearance v2',
        requirements: ['Bring a different valid ID'],
        fields: [
          { key: 'purpose', label: 'Updated purpose', type: 'text', required: true },
          { key: 'reference_note', label: 'Reference note', type: 'text', required: false },
        ],
      }).expect(200);
    const activeTypesAfterEdit = await request(app.getHttpServer()).get('/api/v1/document-types').expect(200);
    expect(activeTypesAfterEdit.body).toEqual(expect.arrayContaining([expect.objectContaining({
      id: typeId, name: 'Barangay Clearance v2', version: 2,
      requirements: ['Bring a different valid ID'],
      fields: expect.arrayContaining([expect.objectContaining({ key: 'reference_note', required: false })]),
    })]));
    const submittedOnV2 = await createRequest('deactivation-version-two-key1', {
      fields: { purpose: 'Employment', reference_note: 'Version two request' },
    }).expect(201);
    await adminRequest().post(`/api/v1/staff/document-types/${typeId}/deactivate`)
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf).expect(201);

    const publicTypes = await request(app.getHttpServer()).get('/api/v1/document-types').expect(200);
    expect(publicTypes.body.some((documentType: { id: string }) => documentType.id === typeId)).toBe(false);
    await createRequest('inactive-document-type-key-001').expect(404);
    await adminRequest().get(`/api/v1/staff/requests/${found.id}`).expect(200).expect(({ body }) => {
      expect(body.reference).toBe(submitted.body.reference);
      expect(body.documentTypeVersion.name).toBe('Barangay Clearance');
      expect(body.documentTypeVersion.version).toBe(1);
      expect(body.documentTypeVersion.requirements).toEqual(['Bring a valid ID']);
      expect(body.documentTypeVersion.fieldDefinitions).toEqual([{ key: 'purpose', label: 'Purpose', type: 'text', required: true }]);
      expect(body.applicantFields).toEqual({ purpose: 'Employment' });
      expect(body.history).toHaveLength(1);
      expect(body).not.toHaveProperty('trackingSecretHash');
    });
    const v2Request = await prisma.documentRequest.findUniqueOrThrow({ where: { reference: submittedOnV2.body.reference } });
    await adminRequest().get(`/api/v1/staff/requests/${v2Request.id}`).expect(200).expect(({ body }) => {
      expect(body.documentTypeVersion.version).toBe(2);
      expect(body.documentTypeVersion.fieldDefinitions).toEqual([
        { key: 'purpose', label: 'Updated purpose', type: 'text', required: true },
        { key: 'reference_note', label: 'Reference note', type: 'text', required: false },
      ]);
      expect(body.applicantFields).toEqual({ purpose: 'Employment', reference_note: 'Version two request' });
    });

    await adminRequest().post(`/api/v1/staff/document-types/${typeId}/activate`)
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf).expect(201);
  });

  it('enforces valid transitions, release dates, audit history, and optimistic concurrency', async () => {
    const submitted = await createRequest('lifecycle-test-key-000001').expect(201);
    const found = await prisma.documentRequest.findUniqueOrThrow({ where: { reference: submitted.body.reference } });

    const details = await adminRequest().get(`/api/v1/staff/requests/${found.id}`).expect(200);
    const etag = details.headers.etag;
    const transition = (toStatus: string, expectedEtag: string) => adminRequest().post(`/api/v1/staff/requests/${found.id}/transitions`)
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf).set('If-Match', expectedEtag).send({ toStatus });

    await transition('RELEASED', etag).expect(409);
    const simultaneous = await Promise.all([
      transition('UNDER_REVIEW', etag),
      transition('UNDER_REVIEW', etag),
    ]);
    expect(simultaneous.map((response) => response.status).sort()).toEqual([201, 409]);
    const refreshed = await adminRequest().get(`/api/v1/staff/requests/${found.id}`).expect(200);
    await transition('PROCESSING', etag).expect(409);

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const scheduled = await adminRequest().patch(`/api/v1/staff/requests/${found.id}/release-date`)
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf).set('If-Match', refreshed.headers.etag)
      .send({ expectedReleaseDate: today }).expect(200);
    expect(scheduled.body.expectedReleaseDate).toBe(today);

    await transition('PROCESSING', `"${scheduled.body.version}"`).expect(201);
    const processing = await adminRequest().get(`/api/v1/staff/requests/${found.id}`).expect(200);
    await adminRequest().post(`/api/v1/staff/requests/${found.id}/transitions`)
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf).set('If-Match', processing.headers.etag)
      .send({ toStatus: 'READY_FOR_PICKUP' }).expect(201);
    const ready = await adminRequest().get(`/api/v1/staff/requests/${found.id}`).expect(200);
    expect(ready.body.readyAt).toBeTruthy();
    await adminRequest().post(`/api/v1/staff/requests/${found.id}/transitions`)
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf).set('If-Match', ready.headers.etag)
      .send({ toStatus: 'RELEASED' }).expect(201);
    const released = await adminRequest().get(`/api/v1/staff/requests/${found.id}`).expect(200);
    expect(released.body.releasedAt).toBeTruthy();
    expect(released.body.history).toHaveLength(6);

    const audit = await adminRequest().get('/api/v1/staff/audit-events').expect(200);
    expect(audit.body.data.some((entry: { action: string }) => entry.action === 'REQUEST_STATUS_CHANGED')).toBe(true);
  });

  it('covers rejection, cancellation, transition preconditions, and resident-visible messages', async () => {
    const rejected = await createRequest('phase3-rejected-lifecycle-key01').expect(201);
    const rejectedRow = await prisma.documentRequest.findUniqueOrThrow({ where: { reference: rejected.body.reference } });
    const details = await adminRequest().get(`/api/v1/staff/requests/${rejectedRow.id}`).expect(200);
    const transition = (body: object, etag?: string) => {
      let call = adminRequest().post(`/api/v1/staff/requests/${rejectedRow.id}/transitions`)
        .set('Origin', origin).set('X-CSRF-Token', adminCsrf).send(body);
      if (etag) call = call.set('If-Match', etag);
      return call;
    };

    await transition({ toStatus: RequestStatus.REJECTED }, details.headers.etag).expect(400);
    await transition({ toStatus: RequestStatus.REJECTED, reason: 'Incomplete application' }, details.headers.etag).expect(400);
    await transition({ toStatus: RequestStatus.RELEASED }, details.headers.etag).expect(409);
    await transition({ toStatus: RequestStatus.PROCESSING }, 'not-an-etag').expect(400);
    await transition({ toStatus: RequestStatus.UNDER_REVIEW }).expect(428);
    const result = await transition({
      toStatus: RequestStatus.REJECTED, reason: 'Incomplete application',
      publicMessage: 'Please provide the missing information.', internalNote: 'Staff-only note sentinel',
    }, details.headers.etag).expect(201);
    const tracked = await request(app.getHttpServer()).post('/api/v1/requests/track')
      .set('X-Forwarded-For', testIp('phase3-track-rejected'))
      .send({ reference: rejected.body.reference, trackingCredential: rejected.body.trackingCredential }).expect(200);
    expect(tracked.body.status).toBe(RequestStatus.REJECTED);
    expect(tracked.body.statusMessage).toBe('Please provide the missing information.');
    expect(tracked.body).not.toHaveProperty('internalNote');
    expect(result.body.version).toBe(2);
    await transition({ toStatus: RequestStatus.PROCESSING }, `"${result.body.version}"`).expect(409);
    const rejectedDetail = await adminRequest().get(`/api/v1/staff/requests/${rejectedRow.id}`).expect(200);
    expect(rejectedDetail.body.history[1]).toMatchObject({ reason: 'Incomplete application', internalNote: 'Staff-only note sentinel' });

    const cancelled = await createRequest('phase3-cancelled-lifecycle-key01').expect(201);
    const cancelledRow = await prisma.documentRequest.findUniqueOrThrow({ where: { reference: cancelled.body.reference } });
    const cancelDetails = await adminRequest().get(`/api/v1/staff/requests/${cancelledRow.id}`).expect(200);
    await adminRequest().post(`/api/v1/staff/requests/${cancelledRow.id}/transitions`)
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf).set('If-Match', cancelDetails.headers.etag)
      .send({ toStatus: RequestStatus.CANCELLED, reason: 'Withdrawn in person', publicMessage: 'The request was closed as requested.' }).expect(201);
    const cancelTrack = await request(app.getHttpServer()).post('/api/v1/requests/track')
      .set('X-Forwarded-For', testIp('phase3-track-cancelled'))
      .send({ reference: cancelled.body.reference, trackingCredential: cancelled.body.trackingCredential }).expect(200);
    expect(cancelTrack.body.status).toBe(RequestStatus.CANCELLED);
    expect(cancelTrack.body.statusMessage).toBe('The request was closed as requested.');
  });

  it('validates release-date creation, revision reasons, and closed-request restrictions', async () => {
    const submitted = await createRequest('phase3-release-date-update-key01').expect(201);
    const row = await prisma.documentRequest.findUniqueOrThrow({ where: { reference: submitted.body.reference } });
    const initial = await adminRequest().get(`/api/v1/staff/requests/${row.id}`).expect(200);
    const releaseDate = (date: string, etag?: string, reason?: string) => {
      let call = adminRequest().patch(`/api/v1/staff/requests/${row.id}/release-date`)
        .set('Origin', origin).set('X-CSRF-Token', adminCsrf).send({ expectedReleaseDate: date, ...(reason ? { reason } : {}) });
      if (etag) call = call.set('If-Match', etag);
      return call;
    };
    await releaseDate(addDays(manilaToday(), 1)).expect(428);
    await releaseDate(addDays(manilaToday(), 1), 'bad-version').expect(400);
    await releaseDate(addDays(manilaToday(), -1), initial.headers.etag).expect(400);
    await releaseDate('2026-02-30', initial.headers.etag).expect(400);

    const firstDate = addDays(manilaToday(), 1);
    const scheduled = await releaseDate(firstDate, initial.headers.etag).expect(200);
    const unchanged = await releaseDate(firstDate, `"${scheduled.body.version}"`).expect(200);
    expect(unchanged.body.version).toBe(scheduled.body.version);
    const revisedDate = addDays(manilaToday(), 2);
    await releaseDate(revisedDate, `"${scheduled.body.version}"`).expect(400);
    const revised = await releaseDate(revisedDate, `"${scheduled.body.version}"`, 'Supplier delivery changed').expect(200);
    expect(revised.body.version).toBe(scheduled.body.version + 1);

    const current = await adminRequest().get(`/api/v1/staff/requests/${row.id}`).expect(200);
    const history = current.body.history.filter((entry: { eventType: string }) => entry.eventType === 'RELEASE_DATE_CHANGED');
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({ reason: 'Supplier delivery changed', newReleaseDate: `${revisedDate}T00:00:00.000Z` });
    const releaseDateAudit = await adminRequest().get('/api/v1/staff/audit-events').query({ action: 'REQUEST_RELEASE_DATE_CHANGED', limit: 100 }).expect(200);
    expect(releaseDateAudit.body.data.some((entry: { targetId: string }) => entry.targetId === row.id)).toBe(true);
    await adminRequest().post(`/api/v1/staff/requests/${row.id}/transitions`)
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf).set('If-Match', current.headers.etag)
      .send({ toStatus: RequestStatus.UNDER_REVIEW }).expect(201);
    const underReview = await adminRequest().get(`/api/v1/staff/requests/${row.id}`).expect(200);
    await adminRequest().post(`/api/v1/staff/requests/${row.id}/transitions`)
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf).set('If-Match', underReview.headers.etag)
      .send({ toStatus: RequestStatus.PROCESSING }).expect(201);
    const processing = await adminRequest().get(`/api/v1/staff/requests/${row.id}`).expect(200);
    await adminRequest().post(`/api/v1/staff/requests/${row.id}/transitions`)
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf).set('If-Match', processing.headers.etag)
      .send({ toStatus: RequestStatus.READY_FOR_PICKUP }).expect(201);
    const ready = await adminRequest().get(`/api/v1/staff/requests/${row.id}`).expect(200);
    await prisma.documentRequest.update({ where: { id: row.id }, data: { expectedReleaseDate: new Date(`${addDays(manilaToday(), -1)}T00:00:00.000Z`) } });
    const readyOverdueCheck = await adminRequest().get('/api/v1/staff/requests').query({ overdue: true, limit: 100 }).expect(200);
    expect(readyOverdueCheck.body.data.map((entry: { id: string }) => entry.id)).not.toContain(row.id);
    await releaseDate(addDays(manilaToday(), 3), ready.headers.etag).expect(409);
  });

  it('filters and paginates the queue and reports overdue summary counts', async () => {
    const submissions = await Promise.all([
      createRequest('phase3-queue-pagination-key-01', { fullName: 'Pagination Resident A' }),
      createRequest('phase3-queue-pagination-key-02', { fullName: 'Pagination Resident B' }),
      createRequest('phase3-queue-pagination-key-03', { fullName: 'Pagination Resident C' }),
    ]);
    const requestRows = await Promise.all(submissions.map((submission) =>
      prisma.documentRequest.findUniqueOrThrow({ where: { reference: submission.body.reference } })));
    await prisma.documentRequest.update({ where: { id: requestRows[0].id }, data: { expectedReleaseDate: new Date(`${addDays(manilaToday(), -1)}T00:00:00.000Z`) } });

    const firstPage = await adminRequest().post('/api/v1/staff/requests/search')
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf)
      .send({ search: 'Pagination Resident', status: RequestStatus.SUBMITTED, documentTypeId: typeId, limit: 2 }).expect(200);
    expect(firstPage.body.data).toHaveLength(2);
    expect(firstPage.body.nextCursor).toBeTruthy();
    const secondPage = await adminRequest().post('/api/v1/staff/requests/search')
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf)
      .send({ search: 'Pagination Resident', status: RequestStatus.SUBMITTED, documentTypeId: typeId, limit: 2, cursor: firstPage.body.nextCursor }).expect(200);
    expect(secondPage.body.data).toHaveLength(1);
    expect(new Set([...firstPage.body.data, ...secondPage.body.data].map((entry: { id: string }) => entry.id)).size).toBe(3);

    const overdue = await adminRequest().get('/api/v1/staff/requests').query({ overdue: true, documentTypeId: typeId, limit: 100 }).expect(200);
    expect(overdue.body.data.map((entry: { id: string }) => entry.id)).toContain(requestRows[0].id);
    expect(overdue.body.data.map((entry: { id: string }) => entry.id)).not.toContain(requestRows[1].id);
    const exactDate = addDays(manilaToday(), -1);
    const byDateRange = await adminRequest().get('/api/v1/staff/requests')
      .query({ releaseDateFrom: exactDate, releaseDateTo: exactDate, limit: 100 }).expect(200);
    expect(byDateRange.body.data.map((entry: { id: string }) => entry.id)).toContain(requestRows[0].id);
    const malformedCursor = Buffer.from(JSON.stringify({ createdAt: new Date().toISOString(), id: 'not-a-uuid' })).toString('base64url');
    await adminRequest().get(`/api/v1/staff/requests?cursor=${malformedCursor}`).expect(400);
    await adminRequest().get(`/api/v1/staff/audit-events?cursor=${malformedCursor}`).expect(400);

    const today = new Date(`${manilaToday()}T00:00:00.000Z`);
    const requests = await prisma.documentRequest.findMany({ select: { status: true, expectedReleaseDate: true } });
    const expected = {
      pending: requests.filter((item) => item.status === RequestStatus.SUBMITTED || item.status === RequestStatus.UNDER_REVIEW).length,
      processing: requests.filter((item) => item.status === RequestStatus.PROCESSING).length,
      ready: requests.filter((item) => item.status === RequestStatus.READY_FOR_PICKUP).length,
      overdue: requests.filter((item) => ([RequestStatus.SUBMITTED, RequestStatus.UNDER_REVIEW, RequestStatus.PROCESSING] as RequestStatus[]).includes(item.status)
        && item.expectedReleaseDate !== null && item.expectedReleaseDate < today).length,
    };
    await adminRequest().get('/api/v1/staff/summary').expect(200).expect(({ body }) => expect(body).toEqual(expected));
  });

  it('enforces session, role, and CSRF checks on staff routes', async () => {
    await request(app.getHttpServer()).get('/api/v1/staff/requests').expect(401);
    const activeAdmin = await prisma.staffUser.findUniqueOrThrow({ where: { username: 'admin' } });
    await adminRequest().patch(`/api/v1/staff/users/${activeAdmin.id}`)
      .set('Origin', origin).set('X-CSRF-Token', adminCsrf).send({ isActive: false }).expect(400);
    const body = { slug: 'phase3-csrf-valid', name: 'CSRF validation', description: '', requirements: [], fields: [] };
    await adminRequest().post('/api/v1/staff/document-types').set('Origin', origin)
      .send(body).expect(403);
    await adminRequest().post('/api/v1/staff/document-types').set('Origin', 'https://untrusted.example').set('X-CSRF-Token', adminCsrf)
      .send(body).expect(403);
    await adminRequest().post('/api/v1/staff/document-types').set('Origin', origin).set('X-CSRF-Token', 'invalid-csrf-token')
      .send(body).expect(403);
    await adminRequest().post('/api/v1/staff/document-types').set('Origin', origin).set('X-CSRF-Token', adminCsrf)
      .send(body).expect(201);
    await adminRequest().post('/api/v1/staff/requests/search').set('Origin', origin)
      .send({ search: 'resident' }).expect(403);
  });

  it('validates malformed identifiers and preserves request IDs on problem responses', async () => {
    const malformed = await adminRequest().get('/api/v1/staff/requests/not-a-uuid').expect(400);
    expect(malformed.headers['content-type']).toContain('application/problem+json');
    expect(malformed.headers['x-request-id']).toBe(malformed.body.requestId);
    expect(malformed.body).toMatchObject({ status: 400, type: 'about:blank', requestId: expect.any(String) });

    const unknown = await adminRequest().get(`/api/v1/staff/requests/${'00000000-0000-4000-8000-000000000000'}`).expect(404);
    expect(unknown.headers['content-type']).toContain('application/problem+json');
    expect(unknown.headers['x-request-id']).toBe(unknown.body.requestId);
  });

  it('applies configured CORS rules and rejects oversized request bodies consistently', async () => {
    const allowed = await request(app.getHttpServer()).get('/api/v1/document-types').set('Origin', origin).expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe(origin);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(allowed.headers['access-control-expose-headers']).toContain('ETag');

    const denied = await request(app.getHttpServer()).get('/api/v1/document-types').set('Origin', 'https://untrusted.example').expect(200);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await request(app.getHttpServer()).options('/api/v1/requests')
      .set('Origin', origin).set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,idempotency-key').expect(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(origin);

    const tooLarge = await request(app.getHttpServer()).post('/api/v1/requests')
      .set('Origin', origin).set('Idempotency-Key', 'phase3-oversized-request-key')
      .send({ payload: 'x'.repeat(101 * 1024) }).expect(413);
    expect(tooLarge.headers['content-type']).toContain('application/problem+json');
    expect(tooLarge.headers['x-request-id']).toBe(tooLarge.body.requestId);
    expect(tooLarge.body.detail).toBe('Request body exceeds the 100 KB limit');
  });

  it('rate-limits repeated public submissions by client IP', async () => {
    const clientIp = '192.0.2.99';
    const attempts = await Promise.all(Array.from({ length: 6 }, (_, index) => request(app.getHttpServer()).post('/api/v1/requests')
      .set('X-Forwarded-For', clientIp)
      .set('Idempotency-Key', `rate-limit-key-${String(index).padStart(8, '0')}`)
      .send({ invalid: true })));
    expect(attempts.slice(0, 5).every((response) => response.status === 400)).toBe(true);
    expect(attempts[5].status).toBe(429);
  });

  it('rate-limits staff login and public tracking by client IP', async () => {
    const loginAttempts = [];
    for (let index = 0; index < 6; index += 1) {
      loginAttempts.push(await request(app.getHttpServer()).post('/api/v1/staff/auth/login')
        .set('X-Forwarded-For', '198.51.100.240')
        .send({ username: 'rate.limit.user', password: 'incorrect-password' }));
    }
    expect(loginAttempts.slice(0, 5).every((response) => response.status === 401)).toBe(true);
    expect(loginAttempts[5].status).toBe(429);

    const trackingAttempts = [];
    for (let index = 0; index < 21; index += 1) {
      trackingAttempts.push(await request(app.getHttpServer()).post('/api/v1/requests/track')
        .set('X-Forwarded-For', '198.51.100.241')
        .send({ reference: 'UNKNOWN-REQUEST-0001', trackingCredential: 'z'.repeat(40) }));
    }
    expect(trackingAttempts.slice(0, 20).every((response) => response.status === 404)).toBe(true);
    expect(trackingAttempts[20].status).toBe(429);
  });
});

function manilaToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addDays(value: string, count: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function testIp(value: string): string {
  const hash = [...value].reduce((sum, character) => (sum * 31 + character.charCodeAt(0)) >>> 0, 7);
  return `192.0.2.${(hash % 254) + 1}`;
}
