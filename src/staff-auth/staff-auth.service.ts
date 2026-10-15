import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StaffUser } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../database/prisma.service';
import { AppEnvironment } from '../config/validate-env';
import { csrfTokenForSession, randomToken, sha256 } from '../common/crypto.util';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class StaffAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppEnvironment, true>,
    private readonly audit: AuditService,
  ) {}

  async login(usernameValue: string, password: string) {
    const username = usernameValue.trim().toLowerCase();
    const staff = await this.prisma.staffUser.findUnique({ where: { username } });
    if (!staff) {
      await argon2.hash(password, { type: argon2.argon2id });
      throw new UnauthorizedException('Invalid username or password');
    }
    const matches = await argon2.verify(staff.passwordHash, password).catch(() => false);
    if (!matches || !staff.isActive) throw new UnauthorizedException('Invalid username or password');

    const sessionToken = randomToken(32);
    const csrfToken = csrfTokenForSession(sessionToken);
    const expiresAt = new Date(Date.now() + this.config.get('SESSION_TTL_HOURS', { infer: true }) * 60 * 60 * 1000);
    await this.prisma.$transaction(async (tx) => {
      await tx.staffSession.deleteMany({ where: { expiresAt: { lte: new Date() } } });
      await tx.staffSession.create({
        data: {
          staffUserId: staff.id,
          tokenHash: sha256(sessionToken),
          csrfTokenHash: sha256(csrfToken),
          expiresAt,
        },
      });
    });
    return { sessionToken, csrfToken, expiresAt, staff: safeStaff(staff) };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.staffSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async changePassword(staffId: string, sessionId: string, currentPassword: string, newPassword: string): Promise<void> {
    if (currentPassword === newPassword) throw new BadRequestException('The new password must differ from the current password');
    const staff = await this.prisma.staffUser.findUnique({ where: { id: staffId } });
    if (!staff || !staff.isActive || !(await argon2.verify(staff.passwordHash, currentPassword).catch(() => false))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction([
      this.prisma.staffUser.update({ where: { id: staffId }, data: { passwordHash, mustChangePassword: false } }),
      this.prisma.staffSession.updateMany({ where: { staffUserId: staffId, id: { not: sessionId }, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }

  async issueTemporaryPassword(staffId: string, actorId: string) {
    const temporaryPassword = randomToken(24);
    const passwordHash = await argon2.hash(temporaryPassword, { type: argon2.argon2id });
    await this.prisma.$transaction(async (tx) => {
      const staff = await tx.staffUser.findUnique({ where: { id: staffId } });
      if (!staff) throw new NotFoundException('Staff account not found');
      await tx.staffUser.update({ where: { id: staffId }, data: { passwordHash, mustChangePassword: true } });
      await tx.staffSession.updateMany({ where: { staffUserId: staffId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, {
        actorId,
        action: 'STAFF_PASSWORD_RESET',
        targetType: 'staff_user',
        targetId: staffId,
        after: { mustChangePassword: true },
      });
    });
    return temporaryPassword;
  }
}

export function safeStaff(staff: Pick<StaffUser, 'id' | 'username' | 'role' | 'isActive' | 'mustChangePassword'>) {
  return { id: staff.id, username: staff.username, role: staff.role, isActive: staff.isActive, mustChangePassword: staff.mustChangePassword };
}
