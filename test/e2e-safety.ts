export type E2eDatabaseConfiguration = {
  databaseUrl: string;
  databaseName: string;
};

export async function withValidatedE2eConfiguration<T>(
  env: NodeJS.ProcessEnv,
  setup: (configuration: E2eDatabaseConfiguration) => Promise<T> | T,
): Promise<T> {
  const configuration = validateE2eConfiguration(env);
  return setup(configuration);
}

type DatabaseTarget = { host: string; port: string; databaseName: string };

export function validateE2eConfiguration(env: NodeJS.ProcessEnv = process.env): E2eDatabaseConfiguration {
  if (env.NODE_ENV !== 'test') throw new Error('E2E tests require NODE_ENV=test');

  const databaseUrl = env.E2E_DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('E2E_DATABASE_URL must point to a disposable test database');

  const databaseName = env.E2E_DATABASE_NAME?.trim();
  if (!databaseName || !/^[a-zA-Z0-9_]+_test$/.test(databaseName)) {
    throw new Error('E2E_DATABASE_NAME must be an explicit database name ending in _test');
  }

  if (env.E2E_ALLOW_DATABASE_RESET !== databaseName) {
    throw new Error('E2E_ALLOW_DATABASE_RESET must exactly match E2E_DATABASE_NAME');
  }

  const e2eTarget = parseDatabaseTarget(databaseUrl, 'E2E_DATABASE_URL');
  if (e2eTarget.databaseName !== databaseName) {
    throw new Error('The database in E2E_DATABASE_URL must match E2E_DATABASE_NAME');
  }

  const applicationDatabaseUrl = env.DATABASE_URL?.trim();
  if (applicationDatabaseUrl) {
    const applicationTarget = parseDatabaseTarget(applicationDatabaseUrl, 'DATABASE_URL');
    if (sameDatabaseTarget(e2eTarget, applicationTarget)) {
      throw new Error('The E2E database must be separate from DATABASE_URL');
    }
  }

  return { databaseUrl, databaseName };
}

export function assertE2eDatabaseIdentity(actualDatabaseName: string, expectedDatabaseName: string): void {
  if (actualDatabaseName !== expectedDatabaseName) {
    throw new Error('Connected PostgreSQL database does not match E2E_DATABASE_NAME');
  }
}

export async function runOnlyAfterDatabaseIdentity<T>(
  expectedDatabaseName: string,
  readDatabaseName: () => Promise<string>,
  destructiveAction: () => Promise<T>,
): Promise<T> {
  const actualDatabaseName = await readDatabaseName();
  assertE2eDatabaseIdentity(actualDatabaseName, expectedDatabaseName);
  return destructiveAction();
}

function parseDatabaseTarget(value: string, variableName: string): DatabaseTarget {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL connection URL`);
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
    throw new Error(`${variableName} must be a PostgreSQL connection URL with a database name`);
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error(`${variableName} contains an invalid database name`);
  }
  if (!databaseName || databaseName.includes('/')) throw new Error(`${variableName} must contain one database name`);

  return {
    host: normalizeHost(url.hostname),
    port: url.port || '5432',
    databaseName,
  };
}

function sameDatabaseTarget(left: DatabaseTarget, right: DatabaseTarget): boolean {
  return left.databaseName === right.databaseName && left.port === right.port && left.host === right.host;
}

function normalizeHost(host: string): string {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') return '<loopback>';
  return normalized;
}
