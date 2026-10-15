export type AppEnvironment = {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  SESSION_COOKIE_NAME: string;
  SESSION_TTL_HOURS: number;
  COOKIE_SECURE: boolean;
  COOKIE_SAME_SITE: 'lax' | 'strict' | 'none';
  CORS_ORIGINS: string[];
  TRUST_PROXY: boolean;
  IDEMPOTENCY_ENCRYPTION_KEY: Buffer;
  CLIENT_IP_HMAC_SECRET: Buffer | null;
  LOG_LEVEL: string;
};

const toBoolean = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined || value === '') return fallback;
  return ['true', '1', 'yes'].includes(value.toLowerCase());
};

const positiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('Expected a positive integer environment value');
  return parsed;
};

export function validateEnvironment(raw: Record<string, unknown>): AppEnvironment {
  const nodeEnv = String(raw.NODE_ENV ?? 'development');
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('NODE_ENV must be development, test, or production');

  const databaseUrl = String(raw.DATABASE_URL ?? '');
  if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://')) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }

  const encodedKey = String(raw.IDEMPOTENCY_ENCRYPTION_KEY ?? '');
  const encryptionKey = Buffer.from(encodedKey, 'base64');
  if (encryptionKey.length !== 32 || encryptionKey.toString('base64').replace(/=+$/, '') !== encodedKey.replace(/=+$/, '')) {
    throw new Error('IDEMPOTENCY_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }

  const encodedProxyKey = String(raw.CLIENT_IP_HMAC_SECRET ?? '');
  const proxyKey = encodedProxyKey ? Buffer.from(encodedProxyKey, 'base64') : null;
  if (proxyKey && (proxyKey.length !== 32 || proxyKey.toString('base64').replace(/=+$/, '') !== encodedProxyKey.replace(/=+$/, ''))) {
    throw new Error('CLIENT_IP_HMAC_SECRET must be a base64-encoded 32-byte key');
  }
  if (nodeEnv === 'production' && !proxyKey) throw new Error('CLIENT_IP_HMAC_SECRET is required in production');
  if (nodeEnv === 'production' && proxyKey?.every((byte) => byte === 0)) {
    throw new Error('CLIENT_IP_HMAC_SECRET must not use an all-zero key in production');
  }

  const sameSite = String(raw.COOKIE_SAME_SITE ?? 'lax').toLowerCase();
  if (!['lax', 'strict', 'none'].includes(sameSite)) throw new Error('COOKIE_SAME_SITE must be lax, strict, or none');
  const cookieSecure = toBoolean(String(raw.COOKIE_SECURE ?? ''), nodeEnv === 'production');
  if (nodeEnv === 'production' && !cookieSecure) throw new Error('COOKIE_SECURE must be true in production');
  if (sameSite === 'none' && !cookieSecure) throw new Error('SameSite=None cookies require COOKIE_SECURE=true');
  const corsOrigins = String(raw.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  if (nodeEnv === 'production' && corsOrigins.length === 0) throw new Error('CORS_ORIGINS must contain the configured client origin in production');
  if (nodeEnv === 'production' && encryptionKey.every((byte) => byte === 0)) throw new Error('IDEMPOTENCY_ENCRYPTION_KEY must not use the example key in production');

  return {
    NODE_ENV: nodeEnv as AppEnvironment['NODE_ENV'],
    PORT: positiveInteger(String(raw.PORT ?? ''), 3000),
    DATABASE_URL: databaseUrl,
    SESSION_COOKIE_NAME: String(raw.SESSION_COOKIE_NAME ?? 'barangay_staff_session'),
    SESSION_TTL_HOURS: positiveInteger(String(raw.SESSION_TTL_HOURS ?? ''), 8),
    COOKIE_SECURE: cookieSecure,
    COOKIE_SAME_SITE: sameSite as AppEnvironment['COOKIE_SAME_SITE'],
    CORS_ORIGINS: corsOrigins,
    TRUST_PROXY: toBoolean(String(raw.TRUST_PROXY ?? '')),
    IDEMPOTENCY_ENCRYPTION_KEY: encryptionKey,
    CLIENT_IP_HMAC_SECRET: proxyKey,
    LOG_LEVEL: String(raw.LOG_LEVEL ?? 'info'),
  };
}
