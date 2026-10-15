import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { StaffPrincipal } from './auth.types';

export const ROLES_KEY = 'staff_roles';
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentStaff = createParamDecorator((_data: unknown, context: ExecutionContext): StaffPrincipal => {
  return context.switchToHttp().getRequest<{ staff: StaffPrincipal }>().staff;
});

export const CurrentSession = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  return context.switchToHttp().getRequest<{ sessionId: string }>().sessionId;
});

export const CurrentCsrfToken = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  return context.switchToHttp().getRequest<{ csrfToken: string }>().csrfToken;
});
