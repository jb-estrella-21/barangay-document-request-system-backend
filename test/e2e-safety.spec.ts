import { assertE2eDatabaseIdentity, runOnlyAfterDatabaseIdentity, validateE2eConfiguration, withValidatedE2eConfiguration } from './e2e-safety';

const databaseName = 'barangay_booking_test';
const databaseUrl = 'postgresql://test-user:test-password@localhost:5432/barangay_booking_test?schema=public';

function validEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    E2E_DATABASE_URL: databaseUrl,
    E2E_DATABASE_NAME: databaseName,
    E2E_ALLOW_DATABASE_RESET: databaseName,
    ...overrides,
  };
}

describe('E2E database safety gate', () => {
  it.each([
    ['wrong environment', { NODE_ENV: 'development' }],
    ['missing test URL', { E2E_DATABASE_URL: undefined }],
    ['missing expected database name', { E2E_DATABASE_NAME: undefined }],
    ['database name without test suffix', { E2E_DATABASE_NAME: 'barangay_booking' }],
    ['URL database name mismatch', { E2E_DATABASE_URL: 'postgresql://test:test@localhost:5432/other_test' }],
    ['missing reset confirmation', { E2E_ALLOW_DATABASE_RESET: undefined }],
    ['incorrect reset confirmation', { E2E_ALLOW_DATABASE_RESET: 'other_test' }],
    ['invalid PostgreSQL URL', { E2E_DATABASE_URL: 'https://example.test/barangay_booking_test' }],
  ])('rejects %s', (_label, overrides) => {
    expect(() => validateE2eConfiguration(validEnvironment(overrides))).toThrow();
  });

  it('rejects a target matching the application database, including loopback aliases', () => {
    expect(() => validateE2eConfiguration(validEnvironment({
      DATABASE_URL: 'postgresql://app:secret@127.0.0.1:5432/barangay_booking_test?schema=public',
    }))).toThrow('The E2E database must be separate from DATABASE_URL');
  });

  it('accepts a separately named disposable database and never returns credential fields', () => {
    const result = validateE2eConfiguration(validEnvironment({
      DATABASE_URL: 'postgresql://app:secret@127.0.0.1:5432/barangay_booking?schema=public',
    }));
    expect(result).toEqual({ databaseUrl, databaseName });
  });

  it('rejects a mismatched live database identity', () => {
    expect(() => assertE2eDatabaseIdentity('barangay_booking', databaseName)).toThrow('Connected PostgreSQL database');
  });

  it('does not initialize the E2E app or reach cleanup when configuration is invalid', async () => {
    const cleanup = jest.fn().mockResolvedValue(undefined);
    const initializeApplication = jest.fn(async () => cleanup());

    await expect(withValidatedE2eConfiguration(
      validEnvironment({ NODE_ENV: 'development' }),
      initializeApplication,
    )).rejects.toThrow('E2E tests require NODE_ENV=test');
    expect(initializeApplication).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('does not invoke destructive cleanup when live identity verification fails', async () => {
    const cleanup = jest.fn().mockResolvedValue(undefined);
    await expect(runOnlyAfterDatabaseIdentity(databaseName, async () => 'barangay_booking', cleanup)).rejects.toThrow();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('invokes cleanup after the live identity matches', async () => {
    const cleanup = jest.fn().mockResolvedValue('cleared');
    await expect(runOnlyAfterDatabaseIdentity(databaseName, async () => databaseName, cleanup)).resolves.toBe('cleared');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
