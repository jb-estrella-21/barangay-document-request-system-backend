import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { StaffAuthController } from './staff-auth.controller';
import { StaffAuthService } from './staff-auth.service';

@Module({ imports: [AuditModule], controllers: [StaffAuthController], providers: [StaffAuthService], exports: [StaffAuthService] })
export class StaffAuthModule {}
