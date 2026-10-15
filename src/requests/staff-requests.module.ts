import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { StaffRequestsController } from './staff-requests.controller';
import { StaffRequestsService } from './staff-requests.service';

@Module({ imports: [AuditModule], controllers: [StaffRequestsController], providers: [StaffRequestsService] })
export class StaffRequestsModule {}
