import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { StaffAuthModule } from '../staff-auth/staff-auth.module';
import { StaffUsersController } from './staff-users.controller';
import { StaffUsersService } from './staff-users.service';

@Module({ imports: [AuditModule, StaffAuthModule], controllers: [StaffUsersController], providers: [StaffUsersService] })
export class StaffUsersModule {}
