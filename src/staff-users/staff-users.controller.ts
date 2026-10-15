import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { StaffRole } from '@prisma/client';
import { CurrentStaff, Roles } from '../common/auth.decorators';
import { StaffPrincipal } from '../common/auth.types';
import { CsrfGuard } from '../common/guards/csrf.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { StaffSessionGuard } from '../common/guards/staff-session.guard';
import { CreateStaffUserDto, UpdateStaffUserDto } from './staff-users.dto';
import { StaffUsersService } from './staff-users.service';
import { ApiJsonResponse, ApiProblemResponses, ApiStaffCsrfHeaders, schemas } from '../common/openapi';

@ApiTags('staff accounts')
@ApiCookieAuth()
@Controller('staff/users')
@UseGuards(StaffSessionGuard, CsrfGuard, RolesGuard)
@Roles(StaffRole.ADMINISTRATOR)
export class StaffUsersController {
  constructor(private readonly users: StaffUsersService) {}

  @Get()
  @ApiOperation({ summary: 'List staff accounts', description: 'Administrator only. Password hashes and session data are never returned.' })
  @ApiJsonResponse(200, 'Safe staff account summaries.', schemas.staffList)
  @ApiProblemResponses({ status: 401, description: 'Staff authentication is required.' }, { status: 403, description: 'Administrator role required.' }, { status: 429, description: 'Global rate limit exceeded.' }, { status: 500, description: 'Unexpected API failure.' })
  list() { return this.users.list(); }

  @Post()
  @ApiOperation({ summary: 'Create staff account and issue a one-time temporary password', description: 'Administrator only. The temporary password must be changed at first sign-in.' })
  @ApiStaffCsrfHeaders()
  @ApiBody({ type: CreateStaffUserDto })
  @ApiJsonResponse(201, 'Staff account created; the temporary password is returned once and must be changed at first sign-in.', schemas.createStaff)
  @ApiProblemResponses({ status: 400, description: 'Invalid account body.' }, { status: 401, description: 'Staff authentication is required.' }, { status: 403, description: 'Administrator role or CSRF verification failed.' }, { status: 409, description: 'Username already exists.' }, { status: 413, description: 'Request body exceeds 100 KB.' }, { status: 429, description: 'Global rate limit exceeded.' }, { status: 500, description: 'Unexpected API failure.' })
  create(@CurrentStaff() staff: StaffPrincipal, @Body() dto: CreateStaffUserDto) { return this.users.create(staff.id, dto); }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a staff account role or active state', description: 'Administrator only. Disabling an account or changing its role revokes its active sessions. The last active administrator cannot be disabled or demoted.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiStaffCsrfHeaders()
  @ApiBody({ type: UpdateStaffUserDto })
  @ApiJsonResponse(200, 'Updated safe staff account summary.', schemas.safeStaff)
  @ApiProblemResponses({ status: 400, description: 'No update fields, attempted self-disable/demotion, or attempted removal of the last active administrator.' }, { status: 401, description: 'Staff authentication is required.' }, { status: 403, description: 'Administrator role or CSRF verification failed.' }, { status: 404, description: 'Staff account not found.' }, { status: 413, description: 'Request body exceeds 100 KB.' }, { status: 429, description: 'Global rate limit exceeded.' }, { status: 500, description: 'Unexpected API failure.' })
  update(@CurrentStaff() staff: StaffPrincipal, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateStaffUserDto) { return this.users.update(staff.id, id, dto); }

  @Post(':id/reset-password')
  @ApiOperation({ summary: 'Reset a staff password', description: 'Administrator only. Returns a one-time temporary password, requires a password change at next sign-in, and revokes all active sessions for the target account.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiStaffCsrfHeaders()
  @ApiJsonResponse(201, 'Temporary password issued.', schemas.resetPassword)
  @ApiProblemResponses({ status: 401, description: 'Staff authentication is required.' }, { status: 403, description: 'Administrator role or CSRF verification failed.' }, { status: 404, description: 'Staff account not found.' }, { status: 413, description: 'Request body exceeds 100 KB.' }, { status: 429, description: 'Global rate limit exceeded.' }, { status: 500, description: 'Unexpected API failure.' })
  resetPassword(@CurrentStaff() staff: StaffPrincipal, @Param('id', new ParseUUIDPipe()) id: string) { return this.users.resetPassword(staff.id, id); }
}
