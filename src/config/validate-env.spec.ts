import { validateEnvironment } from './validate-env';

const validProductionEnvironment = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://demo:demo@localhost/demo',
  IDEMPOTENCY_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  CLIENT_IP_HMAC_SECRET: Buffer.alloc(32, 2).toString('base64'),
  COOKIE_SECURE: 'true',
  COOKIE_SAME_SITE: 'lax',
  CORS_ORIGINS: 'https://resident.pages.dev,https://staff.pages.dev',
  TRUST_PROXY: 'false',
};

describe('production client IP signing configuration', () => {
  it('accepts a distinct 32-byte base64 HMAC key', () => {
    const config = validateEnvironment(validProductionEnvironment);
    expect(config.CLIENT_IP_HMAC_SECRET).toEqual(Buffer.alloc(32, 2));
    expect(config.TRUST_PROXY).toBe(false);
  });

  it('requires a valid non-zero signing key in production', () => {
    const { CLIENT_IP_HMAC_SECRET: _secret, ...missing } = validProductionEnvironment;
    expect(() => validateEnvironment(missing)).toThrow('CLIENT_IP_HMAC_SECRET is required in production');
    expect(() => validateEnvironment({
      ...validProductionEnvironment,
      CLIENT_IP_HMAC_SECRET: Buffer.alloc(31, 2).toString('base64'),
    })).toThrow('CLIENT_IP_HMAC_SECRET must be a base64-encoded 32-byte key');
    expect(() => validateEnvironment({
      ...validProductionEnvironment,
      CLIENT_IP_HMAC_SECRET: Buffer.alloc(32).toString('base64'),
    })).toThrow('CLIENT_IP_HMAC_SECRET must not use an all-zero key in production');
  });

  it('rejects reuse of the idempotency encryption key for proxy signatures', () => {
    const key = Buffer.alloc(32, 4).toString('base64');
    expect(() => validateEnvironment({
      ...validProductionEnvironment,
      IDEMPOTENCY_ENCRYPTION_KEY: key,
      CLIENT_IP_HMAC_SECRET: key,
    })).toThrow('CLIENT_IP_HMAC_SECRET must be distinct from IDEMPOTENCY_ENCRYPTION_KEY');
  });
});
