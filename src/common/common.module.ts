import { Global, Module } from '@nestjs/common';
import { CsrfGuard } from './guards/csrf.guard';
import { RolesGuard } from './guards/roles.guard';
import { StaffSessionGuard } from './guards/staff-session.guard';

@Global()
@Module({ providers: [StaffSessionGuard, RolesGuard, CsrfGuard], exports: [StaffSessionGuard, RolesGuard, CsrfGuard] })
export class CommonModule {}
