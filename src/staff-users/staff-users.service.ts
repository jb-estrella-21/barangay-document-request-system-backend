import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuditService } from '../audit/audit.service';
import { randomToken } from '../common/crypto.util';
import { PrismaService } from '../database/prisma.service';
import { safeStaff } from '../staff-auth/staff-auth.service';
import { StaffAuthService } from '../staff-auth/staff-auth.service';
import { CreateStaffUserDto, UpdateStaffUserDto } from './staff-users.dto';
import { acquireAdministratorInvariantLock } from './admin-invariant-lock';

@Injectable()
export class StaffUsersService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly auth: StaffAuthService) {}

  async list() {
    const users = await this.prisma.staffUser.findMany({ orderBy: [{ username: 'asc' }] });
    return users.map(safeStaff);
  }

  async create(actorId: string, dto: CreateStaffUserDto) {
    const username = dto.username.trim().toLowerCase();
    const temporaryPassword = randomToken(24);
    const passwordHash = await argon2.hash(temporaryPassword, { type: argon2.argon2id });
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        if (dto.role === StaffRole.ADMINISTRATOR) await acquireAdministratorInvariantLock(tx);
        const created = await tx.staffUser.create({
          data: { username, role: dto.role, passwordHash, mustChangePassword: true, createdById: actorId },
        });
        await this.audit.record(tx, { actorId, action: 'STAFF_CREATED', targetType: 'staff_user', targetId: created.id, after: { username, role: created.role, isActive: created.isActive } });
        return created;
      });
      return { staff: safeStaff(user), temporaryPassword };
    } catch (error) {
      if (isUniqueConflict(error)) throw new ConflictException('A staff account with this username already exists');
      throw error;
    }
  }

  async createFirstAdministrator(usernameValue: string, passwordHash: string) {
    const username = usernameValue.trim().toLowerCase();
    return this.prisma.$transaction(async (tx) => {
      await acquireAdministratorInvariantLock(tx);
      const existing = await tx.staffUser.count({ where: { role: StaffRole.ADMINISTRATOR } });
      if (existing) throw new Error('An administrator already exists; bootstrap is only for the first administrator');
      return tx.staffUser.create({ data: { username, passwordHash, role: StaffRole.ADMINISTRATOR } });
    });
  }

  async update(actorId: string, id: string, dto: UpdateStaffUserDto) {
    if (!Object.keys(dto).length) throw new BadRequestException('At least one account field is required');
    return this.prisma.$transaction(async (tx) => {
      await acquireAdministratorInvariantLock(tx);
      const current = await tx.staffUser.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Staff account not found');
      const nextRole = dto.role ?? current.role;
      const nextActive = dto.isActive ?? current.isActive;
      if (current.id === actorId && (!nextActive || nextRole !== StaffRole.ADMINISTRATOR)) throw new BadRequestException('Administrators cannot disable or demote their own account');
      if (current.role === StaffRole.ADMINISTRATOR && current.isActive && (!nextActive || nextRole !== StaffRole.ADMINISTRATOR)) {
        const otherAdmins = await tx.staffUser.count({ where: { id: { not: id }, role: StaffRole.ADMINISTRATOR, isActive: true } });
        if (otherAdmins < 1) throw new BadRequestException('The last active administrator cannot be disabled or demoted');
      }
      const updated = await tx.staffUser.update({ where: { id }, data: { role: nextRole, isActive: nextActive } });
      if (!nextActive || nextRole !== current.role) {
        await tx.staffSession.updateMany({ where: { staffUserId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await this.audit.record(tx, {
        actorId, action: 'STAFF_UPDATED', targetType: 'staff_user', targetId: id,
        before: { role: current.role, isActive: current.isActive }, after: { role: updated.role, isActive: updated.isActive },
      });
      return safeStaff(updated);
    });
  }

  async resetPassword(actorId: string, id: string) {
    const temporaryPassword = await this.auth.issueTemporaryPassword(id, actorId);
    return { staffId: id, temporaryPassword, mustChangePassword: true };
  }
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'P2002';
}
