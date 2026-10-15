import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StaffRole } from '@prisma/client';
import { ROLES_KEY } from '../auth.decorators';
import { StaffPrincipal } from '../auth.types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<StaffRole[]>(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!roles?.length) return true;
    const staff = context.switchToHttp().getRequest<{ staff?: StaffPrincipal }>().staff;
    if (!staff || !roles.includes(staff.role)) throw new ForbiddenException('This staff role cannot perform this action');
    return true;
  }
}
