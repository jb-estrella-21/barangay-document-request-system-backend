import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { StaffRole } from '@prisma/client';
import { Roles } from '../common/auth.decorators';
import { CsrfGuard } from '../common/guards/csrf.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { StaffSessionGuard } from '../common/guards/staff-session.guard';
import { AuditService } from './audit.service';
import { ApiJsonResponse, ApiProblemResponses, schemas } from '../common/openapi';

class AuditQuery {
  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page.' })
  @IsOptional() @IsString() cursor?: string;
  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @ApiPropertyOptional({ description: 'Exact action name filter.' })
  @IsOptional() @IsString() action?: string;
  @ApiPropertyOptional({ description: 'Actor identifier filter.' })
  @IsOptional() @IsString() actorId?: string;
}

@ApiTags('staff audit')
@ApiCookieAuth()
@Controller('staff/audit-events')
@UseGuards(StaffSessionGuard, CsrfGuard, RolesGuard)
@Roles(StaffRole.ADMINISTRATOR)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'List audit events', description: 'Administrator only. Returns audit entries in stable newest-first order with actor summary and opaque cursor pagination.' })
  @ApiJsonResponse(200, 'Audit event page.', schemas.page(schemas.auditEvent))
  @ApiProblemResponses({ status: 400, description: 'Invalid cursor or query.' }, { status: 401, description: 'Staff authentication is required.' }, { status: 403, description: 'Administrator role required.' }, { status: 429, description: 'Global rate limit exceeded.' }, { status: 500, description: 'Unexpected API failure.' })
  list(@Query() query: AuditQuery) { return this.audit.list(query); }
}
