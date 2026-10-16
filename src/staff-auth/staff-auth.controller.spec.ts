import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AppEnvironment } from '../config/validate-env';
import { StaffAuthController } from './staff-auth.controller';
import { StaffAuthService } from './staff-auth.service';

describe('StaffAuthController login origin policy', () => {
  const expiresAt = new Date('2030-01-01T00:00:00.000Z');
  const auth = {
    login: jest.fn().mockResolvedValue({
      sessionToken: 'session-token',
      csrfToken: 'csrf-token',
      expiresAt,
      staff: { id: 'staff-id', username: 'staff', role: 'ADMINISTRATOR', isActive: true, mustChangePassword: false },
    }),
  } as unknown as StaffAuthService;
  const config = {
    get: jest.fn((key: string) => ({
      CORS_ORIGINS: ['https://staff.example'],
      COOKIE_SECURE: true,
      COOKIE_SAME_SITE: 'lax',
      SESSION_COOKIE_NAME: 'staff_session',
    })[key]),
  } as unknown as ConfigService<AppEnvironment, true>;
  const controller = new StaffAuthController(auth, config);
  const response = { cookie: jest.fn() } as unknown as Response;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a supplied unconfigured origin before checking credentials', async () => {
    await expect(controller.login({ username: 'staff', password: 'password' }, 'https://evil.example', response))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(auth.login).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('allows configured browser origins and clients that omit Origin', async () => {
    await expect(controller.login({ username: 'staff', password: 'password' }, 'https://staff.example', response))
      .resolves.toMatchObject({ csrfToken: 'csrf-token' });
    await expect(controller.login({ username: 'staff', password: 'password' }, undefined, response))
      .resolves.toMatchObject({ csrfToken: 'csrf-token' });
    expect(auth.login).toHaveBeenCalledTimes(2);
    expect(response.cookie).toHaveBeenCalledTimes(2);
  });
});
