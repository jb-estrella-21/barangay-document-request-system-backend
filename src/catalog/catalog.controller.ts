import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { StaffRole } from '@prisma/client';
import { CurrentStaff, Roles } from '../common/auth.decorators';
import { StaffPrincipal } from '../common/auth.types';
import { CsrfGuard } from '../common/guards/csrf.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { StaffSessionGuard } from '../common/guards/staff-session.guard';
import { CatalogService } from './catalog.service';
import { CreateDocumentTypeDto, UpdateDocumentTypeDto } from './catalog.dto';
import { ApiJsonResponse, ApiProblemResponses, ApiStaffCsrfHeaders, schemas } from '../common/openapi';

@ApiTags('staff document types')
@ApiCookieAuth()
@Controller('staff/document-types')
@UseGuards(StaffSessionGuard, CsrfGuard, RolesGuard)
@Roles(StaffRole.ADMINISTRATOR)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @ApiOperation({ summary: 'List document types, including inactive types', description: 'Administrator only. Returns the current version of every type, including inactive types.' })
  @ApiJsonResponse(200, 'Document type catalog.', schemas.staffDocumentTypes)
  @ApiProblemResponses({ status: 401, description: 'Staff authentication is required.' }, { status: 403, description: 'Administrator role required.' }, { status: 429, description: 'Global rate limit exceeded.' }, { status: 500, description: 'Unexpected API failure.' })
  list() { return this.catalog.staffList(); }

  @Post()
  @ApiOperation({ summary: 'Create a document type and initial immutable version', description: 'Administrator only. The body supplies the launch definition; no document types or official requirements are seeded.' })
  @ApiStaffCsrfHeaders()
  @ApiBody({ type: CreateDocumentTypeDto })
  @ApiJsonResponse(201, 'Document type created with version 1.', schemas.staffDocumentType)
  @ApiProblemResponses({ status: 400, description: 'Invalid catalog definition.' }, { status: 401, description: 'Staff authentication is required.' }, { status: 403, description: 'Administrator role or CSRF verification failed.' }, { status: 409, description: 'The slug already exists.' }, { status: 413, description: 'Request body exceeds 100 KB.' }, { status: 429, description: 'Global rate limit exceeded.' }, { status: 500, description: 'Unexpected API failure.' })
  create(@CurrentStaff() staff: StaffPrincipal, @Body() dto: CreateDocumentTypeDto) { return this.catalog.create(staff.id, dto); }

  @Patch(':id')
  @ApiOperation({ summary: 'Create a new version of a document type definition', description: 'Administrator only. Existing requests remain pinned to the version used at submission.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiStaffCsrfHeaders()
  @ApiBody({ type: UpdateDocumentTypeDto })
  @ApiJsonResponse(200, 'New immutable version created and made current.', schemas.staffDocumentType)
  @ApiProblemResponses({ status: 400, description: 'No update fields or invalid catalog definition.' }, { status: 401, description: 'Staff authentication is required.' }, { status: 403, description: 'Administrator role or CSRF verification failed.' }, { status: 404, description: 'Document type not found.' }, { status: 409, description: 'Another administrator updated the type concurrently.' }, { status: 413, description: 'Request body exceeds 100 KB.' }, { status: 429, description: 'Global rate limit exceeded.' }, { status: 500, description: 'Unexpected API failure.' })
  update(@CurrentStaff() staff: StaffPrincipal, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateDocumentTypeDto) { return this.catalog.update(staff.id, id, dto); }

  @Post(':id/activate')
  @ApiOperation({ summary: 'Activate a document type', description: 'Administrator only. Makes the type available for new public submissions.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiStaffCsrfHeaders()
  @ApiJsonResponse(201, 'Activation state.', { type: 'object', required: ['id', 'isActive'], properties: { id: { type: 'string', format: 'uuid' }, isActive: { type: 'boolean' } } })
  @ApiProblemResponses({ status: 401, description: 'Staff authentication is required.' }, { status: 403, description: 'Administrator role or CSRF verification failed.' }, { status: 404, description: 'Document type not found.' }, { status: 413, description: 'Request body exceeds 100 KB.' }, { status: 429, description: 'Global rate limit exceeded.' }, { status: 500, description: 'Unexpected API failure.' })
  activate(@CurrentStaff() staff: StaffPrincipal, @Param('id', new ParseUUIDPipe()) id: string) { return this.catalog.setActive(staff.id, id, true); }

  @Post(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate a document type', description: 'Administrator only. Blocks new submissions while preserving existing requests and their pinned versions.' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiStaffCsrfHeaders()
  @ApiJsonResponse(201, 'Activation state.', { type: 'object', required: ['id', 'isActive'], properties: { id: { type: 'string', format: 'uuid' }, isActive: { type: 'boolean' } } })
  @ApiProblemResponses({ status: 401, description: 'Staff authentication is required.' }, { status: 403, description: 'Administrator role or CSRF verification failed.' }, { status: 404, description: 'Document type not found.' }, { status: 413, description: 'Request body exceeds 100 KB.' }, { status: 429, description: 'Global rate limit exceeded.' }, { status: 500, description: 'Unexpected API failure.' })
  deactivate(@CurrentStaff() staff: StaffPrincipal, @Param('id', new ParseUUIDPipe()) id: string) { return this.catalog.setActive(staff.id, id, false); }
}
